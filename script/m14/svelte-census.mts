// SVELTE CENSUS — the lane's own relationship-ontology instrument.
//
// WHAT THIS IS FOR. Per relationship type it answers, over a DERIVED population and
// through the PRODUCTION path (`ASTEngine.parseFile`, not a bare `analyze`):
//
//   fires         how many edges, in how many files
//   resolved      whether each endpoint binds to a symbol declared in the file, to an
//                 import binding, to a `module:item` import edge, or to nothing
//   confident     the confidence and evidenceClass distribution, and the share of edges
//                 BELOW 0.7, which the honesty contract §4 makes a heuristic that must
//                 be countable rather than a vibe
//   R7            empty names, unknown symbol kinds, and placeholder-literal endpoints
//
// WHY IT WALKS BOTH CORPORA. `shadcn-svelte` is this lane's assigned corpus and it
// contains ZERO class declarations, so `extends`, `implements` and `overrides` cannot be
// adjudicated on it: `implements` reads 0 on 1,878 files and 1 on the svelte compiler
// suite's 4,561. A verdict that only holds at one corpus is not a verdict, so the union
// is the default and each corpus is also reported separately.
//
// WHY THE PRODUCTION PATH, AND WHAT IT COSTS TO GET WRONG. Every script-side fact comes
// from the SFC seam `ASTEngine.parseFile` builds at engine.ts:1592-1620 — it pre-parses
// each `<script>` body with the JS/TS/TSX grammar and passes the trees as
// `context.sfcScriptTrees`. Calling `analyze(root, content, file)` with no context skips
// the whole script half: `scriptTrees.length === 0` at real-svelte-analyzer.ts:694.
// MEASURED: `script/m14/firing-check-v2.mjs` does exactly that, and reports SVELTE at
// 3/10 with imports[] 0 on 200 real files while the same 200 files through this path give
// 7/10 and the whole corpus gives 9/10. The 3/10 is a correct number about the wrong
// population, which is the shape the honesty contract calls the most dangerous one.
//
// NO REGEX ANYWHERE (master rule 1). Node types, field names, Set membership, `includes`
// on literal strings, and explicit char walks. Nothing here matches source text to decide
// a relationship — the one place a literal test appears, the `module:item` endpoint split,
// is a String method rather than a pattern.
//
//   bun script/m14/svelte-census.mts
//   ONLY=svelte bun script/m14/svelte-census.mts          # one corpus
//   OUT=/tmp/x.json bun script/m14/svelte-census.mts        # machine-readable

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const ONLY = process.env.ONLY || ""
const MAXBYTES = 512 * 1024

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

/** The R7 placeholder classes (validation/m60/ledger.json standing rule R7). */
const PLACEHOLDER = new Set([
  "unknown", "anonymous", "<anonymous>", "TODO", "FIXME", "n/a", "None", "null", "undefined", "?", "",
])
/** SymbolKinds the standing rules forbid: never empty, never `unknown`. */
const FORBIDDEN_KIND_TOKENS = ["unknown", "", "undefined"]

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function* walk(n: any): Generator<any> {
  const stack: any[] = [n]
  while (stack.length > 0) {
    const m = stack.pop()!
    yield m
    for (let i = m.namedChildCount - 1; i >= 0; i--) {
      const c = m.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const repoDirs: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && !e.includes(ONLY)) continue
  const dir = join(CORPUS, e)
  try {
    if (statSync(dir).isDirectory()) repoDirs.push(dir)
  } catch {
    continue
  }
}

const eng: any = await import(`${REPO}/src/ast/engine.ts`)

type Bucket = {
  edges: number
  files: Set<string>
  srcLocal: number
  srcUnknown: number
  tgtLocal: number
  tgtImport: number
  tgtModuleItem: number
  tgtUnknown: number
  conf: Map<number, number>
  evidence: Map<string, number>
  lines: number
  linesOutOfFile: number
  unknownSamples: Set<string>
}
const perType = new Map<string, Bucket>()
const perRepo = new Map<string, { files: number; parsed: number; edges: number; byType: Map<string, number> }>()

function bucket(t: string): Bucket {
  let b = perType.get(t)
  if (!b) {
    b = {
      edges: 0, files: new Set<string>(), srcLocal: 0, srcUnknown: 0,
      tgtLocal: 0, tgtImport: 0, tgtModuleItem: 0, tgtUnknown: 0,
      conf: new Map(), evidence: new Map(), lines: 0, linesOutOfFile: 0, unknownSamples: new Set(),
    }
    perType.set(t, b)
  }
  return b
}

/**
 * The analyzer this run actually loaded, identified by digest rather than by path.
 *
 * A path is not an identity: REPO is a default, BB_REPO overrides it, and the
 * engine resolves its own parser wasm from a resolver that walks the FILESYSTEM
 * (engine.ts resolveWasm). So the two things that decide every number below --
 * which analyzer, and which grammar -- are both printed by digest.
 */
function analyzerIdentity(): string {
  const p = join(REPO, "src/ast/real-svelte-analyzer.ts")
  let body = ""
  try {
    body = readFileSync(p, "utf8")
  } catch {
    return `${p} (UNREADABLE — no analyzer was measured)`
  }
  const d = createHash("sha256").update(body).digest("hex").slice(0, 16)
  return `real-svelte-analyzer.ts sha256:${d} ${body.split("\n").length} lines`
}

const totals = {
  files: 0, parsed: 0, threw: 0, empty: 0, overBytes: 0,
  symbols: 0, relationships: 0,
  importsRows: 0, importsFiles: 0, importItems: 0, importModules: 0,
  exportsRows: 0, exportsFiles: 0,
  parseErrors: 0,
  // R7, symbols
  emptySymbolNames: 0, unknownSymbolKinds: 0, placeholderSymbolNames: 0,
  emptySymbolSamples: [] as string[],
  // R7, edges
  emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0,
  // confidence honesty
  heuristicEdges: 0, deterministicEdges: 0, edgesWithConfidence: 0, edgesWithoutConfidence: 0,
}
const importModules = new Set<string>()

for (const repoDir of repoDirs) {
  const repo = repoDir.slice(CORPUS.length + 1)
  const files: string[] = []
  svelteFiles(repoDir, files)
  files.sort()
  const row = perRepo.get(repo) ?? { files: files.length, parsed: 0, edges: 0, byType: new Map() }
  row.files = files.length
  perRepo.set(repo, row)

  for (const abs of files) {
    totals.files++
    let content: string
    try {
      if (statSync(abs).size > MAXBYTES) {
        totals.overBytes++
        continue
      }
      content = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (content.length === 0) {
      totals.empty++
      continue
    }
    const rel = `${repo}/${abs.slice(repoDir.length + 1)}`
    const lineCount = content.split("\n").length

    let res: any
    try {
      res = await eng.parseFile(abs, content)
    } catch {
      totals.threw++
      continue
    }
    totals.parsed++
    row.parsed++
    totals.parseErrors += (res.errors ?? []).length

    // ---- symbols, and the R7 rules that apply to them
    const symNames = new Set<string>()
    for (const s of res.symbols ?? []) {
      totals.symbols++
      const name = String(s.name ?? "")
      const kind = String(s.kind ?? "")
      if (name.length === 0) {
        totals.emptySymbolNames++
        if (totals.emptySymbolSamples.length < 8) totals.emptySymbolSamples.push(`${rel} kind=${kind}`)
      }
      if (PLACEHOLDER.has(name)) {
        totals.placeholderSymbolNames++
        if (totals.emptySymbolSamples.length < 8) totals.emptySymbolSamples.push(`${rel} placeholder name=${name}`)
      }
      if (FORBIDDEN_KIND_TOKENS.includes(kind.toLowerCase())) {
        totals.unknownSymbolKinds++
        if (totals.emptySymbolSamples.length < 8) totals.emptySymbolSamples.push(`${rel} kind=${kind} name=${name}`)
      }
      if (name) symNames.add(name)
    }

    // ---- the imports[] channel, reported separately from relationships
    const imps = res.imports ?? []
    totals.importsRows += imps.length
    if (imps.length) totals.importsFiles++
    for (const im of imps) {
      const items = (im.items ?? []).length
      totals.importItems += items
      if (im.module || im.source) importModules.add(String(im.module ?? im.source))
    }
    totals.exportsRows += (res.exports ?? []).length
    if ((res.exports ?? []).length) totals.exportsFiles++
    const importBindings = new Set<string>()
    for (const im of imps) for (const it of im.items ?? []) if (it && it !== "*") importBindings.add(String(it))

    // ---- relationships
    for (const r of res.relationships ?? []) {
      const t = String(r.relationshipType ?? r.type ?? "")
      if (!t) continue
      totals.relationships++
      row.edges++
      row.byType.set(t, (row.byType.get(t) ?? 0) + 1)
      const b = bucket(t)
      b.edges++
      b.files.add(rel)

      const conf = typeof r.confidence === "number" ? r.confidence : null
      if (conf === null) {
        totals.edgesWithoutConfidence++
      } else {
        totals.edgesWithConfidence++
        b.conf.set(conf, (b.conf.get(conf) ?? 0) + 1)
        if (conf < 0.7) totals.heuristicEdges++
        else totals.deterministicEdges++
      }
      const ev = String((r.metadata ?? {}).evidenceClass ?? "(none)")
      b.evidence.set(ev, (b.evidence.get(ev) ?? 0) + 1)

      const src = String(r.source ?? "")
      const tgt = String(r.target ?? "")
      if (src.length === 0) totals.emptySource++
      if (tgt.length === 0) totals.emptyTarget++
      if (PLACEHOLDER.has(src)) totals.placeholderSource++
      if (PLACEHOLDER.has(tgt)) totals.placeholderTarget++

      // A line_number must name a line that EXISTS in the file. This is the cheapest
      // label/coordinate check there is and it is the one that catches a seam offset
      // going wrong, which is this lane's most frequent defect class.
      if (typeof r.line_number === "number") {
        b.lines++
        if (r.line_number < 1 || r.line_number > lineCount) b.linesOutOfFile++
      }

      if (symNames.has(src)) b.srcLocal++
      else b.srcUnknown++
      if (symNames.has(tgt)) b.tgtLocal++
      else if (importBindings.has(tgt)) b.tgtImport++
      else {
        // The JS family's import-edge spelling is `module:item`, where the item half is
        // the bound name — so it resolves through the import binding, not as a literal.
        const c = tgt.lastIndexOf(":")
        const item = c > 0 ? tgt.slice(c + 1) : ""
        if (item.length > 0 && importBindings.has(item)) b.tgtModuleItem++
        else {
          b.tgtUnknown++
          if (b.unknownSamples.size < 6) b.unknownSamples.add(tgt)
        }
      }
    }
  }
}
totals.importModules = importModules.size

// ------------------------------------------------------------------- report
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`svelte-census  repo=${REPO}`)
console.log(`corpus=${CORPUS}${ONLY ? "  only=" + ONLY : ""}`)
// The ANALYZER population, declared next to the FILE population. A count over
// 6,439 files says nothing about WHICH analyzer read them, and this script's
// default REPO used to be a hard-coded absolute path to the main checkout -- so a
// run from a worktree printed a full, confident table describing a DIFFERENT
// lane's analyzer. MEASURED 2026-10-05: with the old default the analyzer under
// test was the main checkout's, 183 diff lines away from this branch's, including
// a /line/i regex this branch had replaced. Both populations are now printed.
console.log(`ANALYZER POPULATION: ${analyzerIdentity()}`)
console.log(`POPULATION (derived by readdir, not hand-listed): ${totals.files} .svelte files across ${repoDirs.length} repos`)
console.log(`  parsed ${totals.parsed}  threw ${totals.threw}  empty ${totals.empty}  over ${MAXBYTES}B ${totals.overBytes}`)
console.log(`  symbols ${totals.symbols}   relationships ${totals.relationships}   parseErrors ${totals.parseErrors}`)
console.log(`  imports[] channel: ${totals.importsRows} rows in ${totals.importsFiles} files, ${totals.importItems} bound items, ${totals.importModules} distinct modules`)
console.log(`  exports[] channel: ${totals.exportsRows} rows in ${totals.exportsFiles} files`)
console.log("")

console.log("PER TYPE")
console.log(w("type", 14) + w("edges", 9) + w("files", 8) + w("srcLoc", 9) + w("srcUnk", 9) + w("tgtLoc", 9) + w("tgtImp", 9) + w("tgtMI", 9) + w("tgtUnk", 9) + w("<0.7", 8) + "confidence / evidenceClass")
console.log("-".repeat(150))
const fired: string[] = []
for (const t of ALL_TYPES) {
  const b = perType.get(t)
  if (!b || b.edges === 0) {
    console.log(`${w(t, 14)}${w("0", 9)}${w("0", 8)}  — SILENT on this population`)
    continue
  }
  fired.push(t)
  let heur = 0
  for (const [c, n] of b.conf) if (c < 0.7) heur += n
  console.log(
    w(t, 14) + w(String(b.edges), 9) + w(String(b.files.size), 8) +
    w(String(b.srcLocal), 9) + w(String(b.srcUnknown), 9) +
    w(String(b.tgtLocal), 9) + w(String(b.tgtImport), 9) + w(String(b.tgtModuleItem), 9) + w(String(b.tgtUnknown), 9) +
    w(heur ? String(heur) : "-", 8) +
    [...b.conf.entries()].sort((x, y) => x[0] - y[0]).map(([c, n]) => `${c}:${n}`).join(" ") +
    "  | " + [...b.evidence.entries()].map(([k, v]) => `${k}:${v}`).join(" "),
  )
  if (b.lines) {
    console.log(`${w("", 14)}${w("", 9)}${w("", 8)}  line_number present on ${b.lines}, outside the file's ${""} on ${b.linesOutOfFile}`)
  }
  if (b.unknownSamples.size) {
    console.log(`${w("", 14)}  unresolved target samples: ${[...b.unknownSamples].join(" ")}`)
  }
}
console.log("-".repeat(150))
console.log(`RELATIONSHIP CHANNEL: ${fired.length}/10 -> ${fired.join(" ") || "(none)"}`)
console.log(`SILENT: ${ALL_TYPES.filter((t) => !fired.includes(t)).join(" ") || "(none)"}`)
console.log("")

console.log("CONFIDENCE HONESTY (M14 §4: below 0.7 is a heuristic and must be countable)")
console.log(`  edges carrying a confidence: ${totals.edgesWithConfidence}   without: ${totals.edgesWithoutConfidence}`)
console.log(`  heuristic (< 0.7): ${totals.heuristicEdges}   (${totals.edgesWithConfidence ? ((totals.heuristicEdges / totals.edgesWithConfidence) * 100).toFixed(2) : "0.00"}% of confident edges)`)
console.log(`  deterministic (>= 0.7): ${totals.deterministicEdges}`)
console.log("")

console.log("STANDING RULES")
console.log(`  empty symbol names:        ${totals.emptySymbolNames} ${totals.emptySymbolSamples.length ? `e.g. ${totals.emptySymbolSamples.join(" | ")}` : ""}`)
console.log(`  placeholder symbol names:  ${totals.placeholderSymbolNames}`)
console.log(`  unknown/empty SymbolKind:  ${totals.unknownSymbolKinds}`)
console.log(`  empty edge sources:        ${totals.emptySource}`)
console.log(`  empty edge targets:        ${totals.emptyTarget}`)
console.log(`  placeholder edge sources:  ${totals.placeholderSource}`)
console.log(`  placeholder edge targets:  ${totals.placeholderTarget}`)
console.log("")

console.log("PER REPO")
for (const [repo, row] of [...perRepo.entries()].sort()) {
  if (row.files === 0) continue
  const types = [...row.byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(" ")
  console.log(`  ${w(repo, 26)} files ${w(String(row.files), 6)} parsed ${w(String(row.parsed), 6)} edges ${w(String(row.edges), 8)} ${types}`)
}

if (process.env.OUT) {
  const json: any = { totals, perType: {}, perRepo: {} }
  for (const [t, b] of perType) {
    json.perType[t] = {
      edges: b.edges, files: b.files.size,
      srcLocal: b.srcLocal, srcUnknown: b.srcUnknown,
      tgtLocal: b.tgtLocal, tgtImport: b.tgtImport, tgtModuleItem: b.tgtModuleItem, tgtUnknown: b.tgtUnknown,
      conf: [...b.conf.entries()], evidence: [...b.evidence.entries()],
      lines: b.lines, linesOutOfFile: b.linesOutOfFile,
      unknownSamples: [...b.unknownSamples],
    }
  }
  for (const [r, row] of perRepo) json.perRepo[r] = { files: row.files, parsed: row.parsed, edges: row.edges, byType: [...row.byType.entries()] }
  writeFileSync(process.env.OUT, JSON.stringify(json, null, 1))
  console.log(`\nwrote ${process.env.OUT}`)
}