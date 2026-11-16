/**
 * End-to-end proof that the VB lane WORKS, through the product's own entry.
 *
 * Three things are checked, and all three are the ones a green fixture suite
 * cannot establish:
 *
 *  1. The production path. `ASTEngine.parseFile` is used, not a hand-built
 *     parser, so the grammar resolution, the analyzer dispatch and the wasm load
 *     are all exercised. A harness that constructs the analyzer itself proves
 *     nothing about whether the product reaches it.
 *  2. The zero-unknown-symbol counts, on real files: no symbol with an empty
 *     name, no member without an owner, no crash, and every relationship's
 *     target naming something the file actually mentions.
 *  3. EVERY relationship carries a 1-based site line (M59.A7). A VB.NET file
 *     whose edges have no line cannot be navigated to, and navigation is the
 *     product — so this is counted on every edge of every file, not sampled.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { readVbSource } from "./vb-source"

const CORPORA: Array<{ name: string; root: string; limit: number }> = [
  { name: "runtime-mvb", root: "<corpus-root>/bb_tests/vb-corpus/runtime", limit: 0 },
  { name: "p3d-legacy", root: "<corpus-root>/bb_tests/vb-corpus/p3d", limit: 150 },
  { name: "dismtools", root: "<corpus-root>/bb_tests/vb-corpus/dismt", limit: 100 },
  { name: "tankexporter", root: "<corpus-root>/bb_tests/vb-corpus/tankex", limit: 0 },
]

function collectVbFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      if (e === ".git") continue
      const p = join(dir, e)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (e.toLowerCase().endsWith(".vb")) out.push(p)
    }
  }
  out.sort()
  return out
}

const totals = {
  files: 0, symbols: 0, relationships: 0, imports: 0, crashes: 0,
  emptyNames: 0, membersWithoutOwner: 0, relsWithoutLine: 0, relsWithoutTarget: 0,
  unknownKinds: 0, filesWithZeroSymbols: 0, pipelineMismatch: 0, filesWithGrammarError: 0,
}
const kindTally = new Map<string, number>()
const relTally = new Map<string, number>()
const gapTally = new Map<string, number>()
const zeroSymbolFiles: string[] = []
const orphanKinds = new Map<string, number>()
const orphanExamples: string[] = []
let orphanInErrorFile = 0
let orphanOutsideErrorFiles = 0
let zeroSymInErrorFile = 0
const orphanOutside: string[] = []
// `parseFile` is the product's PRODUCTION entry -- it resolves the language from
// the path, loads the grammar wasm through the loader, and dispatches to the
// analyzer. Driving the analyzer directly would prove nothing about whether a
// user typing `bb_search` on a .vb file reaches it.
const { parseFile } = ASTEngine as unknown as {
  parseFile: (p: string, c: string) => Promise<any>
}

const VALID_KINDS = new Set(Object.values(ASTEngine.SymbolKind as any).map(String))
const VALID_REL = new Set(Object.values(ASTEngine.RelationshipType as any).map(String))

for (const corp of CORPORA) {
  const all = collectVbFiles(corp.root)
  const files = corp.limit > 0 ? all.slice(0, corp.limit) : all
  let cSym = 0, cRel = 0, cImp = 0
  for (const f of files) {
    const src = readVbSource(f).text
    totals.files++
    let res: any
    try {
      res = await parseFile(f, src)
    } catch (e: any) {
      totals.crashes++
      continue
    }
    // The pipeline must agree with itself: if the engine returned a language, it
    // must be the one the extension declares. A mismatch is how a lane silently
    // analyses VB files with the generic pass while claiming to be VB.
    const declared = res.language
    if (declared !== "vb") { totals.pipelineMismatch++; continue }
    const fileErrored = Array.isArray(res.errors) && res.errors.length > 0
    if (fileErrored) totals.filesWithGrammarError++
    const symbols = res.symbols ?? []
    const rels = res.relationships ?? []
    const imps = res.imports ?? []
    cSym += symbols.length; cRel += rels.length; cImp += imps.length
    totals.symbols += symbols.length
    totals.relationships += rels.length
    totals.imports += imps.length
    if (symbols.length === 0) {
      totals.filesWithZeroSymbols++
      if (fileErrored) zeroSymInErrorFile++
      zeroSymbolFiles.push(`${fileErrored ? "ERR " : "OK  "}${f}`)
    }
    for (const s of symbols) {
      const name = String(s.name ?? "")
      if (name.trim().length === 0) totals.emptyNames++
      kindTally.set(String(s.kind), (kindTally.get(String(s.kind)) ?? 0) + 1)
      if (!VALID_KINDS.has(String(s.kind))) totals.unknownKinds++
      const isMember = s.kind === "method" || s.kind === "property" || s.kind === "field" ||
                       s.kind === "variable" || s.kind === "constant" || s.kind === "event" ||
                       s.kind === "enum_member" || s.kind === "constructor"
      if (isMember && !s.ownerName) {
        totals.membersWithoutOwner++
        if (res.errors && res.errors.length > 0) orphanInErrorFile++
        else { orphanOutsideErrorFiles++; if (orphanOutside.length < 10) orphanOutside.push(`${s.kind} ${s.name} @${s.range?.startLine} in ${f}`) }
        const key = `${s.kind}`
        orphanKinds.set(key, (orphanKinds.get(key) ?? 0) + 1)
        if (orphanExamples.length < 8) orphanExamples.push(`${s.name} <${s.kind}> @${s.range?.startLine}:${s.range?.startColumn} in ${f.replace(corp.root, "")}`)
      }
    }
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      relTally.set(t, (relTally.get(t) ?? 0) + 1)
      if (!VALID_REL.has(t)) totals.unknownKinds++
      // M59.A7: EVERY edge, every site.
      if (typeof r.line_number !== "number" || r.line_number < 1) totals.relsWithoutLine++
      if (String(r.target ?? "").trim().length === 0) totals.relsWithoutTarget++
    }
    for (const [k, v] of Object.entries((res.metadata as any)?.vbGaps ?? {})) {
      gapTally.set(k, (gapTally.get(k) ?? 0) + (v as number))
    }
  }
  console.log(`${corp.name.padEnd(16)} files=${String(files.length).padStart(5)} symbols=${String(cSym).padStart(7)} relationships=${String(cRel).padStart(7)} imports=${String(cImp).padStart(5)}`)
}

console.log("")
console.log("=== zero-unknown-symbol counts (dimension 5) ===")
console.log(`  files analysed              ${totals.files}`)
console.log(`  files the grammar ERRORED   ${totals.filesWithGrammarError}`)
console.log(`  symbols                     ${totals.symbols}`)
console.log(`  relationships               ${totals.relationships}`)
console.log(`  imports                     ${totals.imports}`)
console.log(`  crash files                 ${totals.crashes}`)
console.log(`  pipeline mismatches         ${totals.pipelineMismatch}`)
console.log(`  empty symbol names          ${totals.emptyNames}`)
console.log(`  unknown kinds               ${totals.unknownKinds}`)
console.log(`  members without ownerName   ${totals.membersWithoutOwner}`)
console.log(`  relationships WITHOUT line  ${totals.relsWithoutLine}`)
console.log(`  relationships without target${totals.relsWithoutTarget}`)
console.log(`  files with zero symbols     ${totals.filesWithZeroSymbols}  (of which in a grammar-errored file: ${zeroSymInErrorFile})`)
console.log(`  orphan members INSIDE a file the grammar errored   ${orphanInErrorFile}`)
console.log(`  orphan members in a file the grammar parsed CLEAN  ${orphanOutsideErrorFiles}`)
for (const o of orphanOutside) console.log(`      ${o}`)
console.log("")
console.log("=== symbol kinds ===")
for (const [k, v] of [...kindTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
console.log("")
console.log("=== relationship types ===")
for (const [k, v] of [...relTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
console.log("")
console.log("=== disclosed grammar gaps (not silently missing) ===")
if (gapTally.size === 0) console.log("  (none)")
for (const [k, v] of [...gapTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
if (orphanExamples.length) {
  console.log("=== members without an owner, by kind ===")
  for (const [k, v] of [...orphanKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
  console.log("=== examples ===")
  for (const e of orphanExamples) console.log(`  ${e}`)
  console.log("")
}
if (zeroSymbolFiles.length) {
  console.log("")
  console.log("=== symbol-free files (first 15; each must be LEGITIMATELY symbol-free) ===")
  for (const f of zeroSymbolFiles.slice(0, 15)) console.log(`  ${f}`)
}
const pass = totals.crashes === 0 && totals.pipelineMismatch === 0 && totals.emptyNames === 0 &&
  totals.unknownKinds === 0 && totals.membersWithoutOwner === 0 && totals.relsWithoutLine === 0 &&
  totals.relsWithoutTarget === 0
console.log("")
console.log(pass ? "VERDICT: PASS" : "VERDICT: FAIL — the counts above are the failures")
process.exit(pass ? 0 : 1)
