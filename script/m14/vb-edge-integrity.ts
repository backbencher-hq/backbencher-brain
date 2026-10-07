/**
 * VB EDGE INTEGRITY — the questions the six-question audit has to answer with a
 * number, on every relationship the analyzer emits.
 *
 * WHAT THIS IS FOR. `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 asks six
 * questions per already-emitted type, and four of them are integrity questions:
 *
 *   4 LABELLED   the right type, not a neighbour
 *   5 RESOLVED   both endpoints bind to real symbols
 *   6 CONFIDENT  evidenceClass and confidence are right; under 0.7 is a heuristic
 *   and the definition-of-done adds: no unknown symbols, no empty names, no
 *   placeholder-literal edge endpoints (standing rule R7)
 *
 * A per-type edge count answers none of them. This does, per type, over the whole
 * corpus through production `parseFile`:
 *
 *   DUPLICATES      the same (source, target, type, line) emitted more than once
 *                   in one file. A graph carrying the same row twice is a graph
 *                   whose degree counts are wrong, and `bb_impact` counts degrees.
 *   CONTRACT LITERALS  endpoints that are this lane's OWN naming contract rather
 *                   than a name in the file (`constructor`, `operator`), with the
 *                   DUPLICATE count for each — a type with two public
 *                   constructors publishes two identical `Type -> constructor`
 *                   rows, which is the R7 hazard in the exact place R7 names.
 *   ENUM MEMBERS    `exports` edges whose target is an enum member. The family's
 *                   exports ruling is that an export names an IMPORTABLE UNIT and
 *                   membership rides `contains`; an enum member is a type-owned
 *                   member, so this is the class where an `exports` edge would be
 *                   a departure from the ruling rather than an application of it.
 *                   The count decides whether it needs disclosing.
 *   LHS WRITES      deliberately NOT counted here. `real-csharp-analyzer.ts:2824`
 *                   excludes an assignment's left side from `uses` (`isLhsWrite`)
 *                   because a field WRITE is not a field READ, and this lane does
 *                   not exclude it. The question needs the AST — whether the
 *                   access is the left operand of an `assignment_expression` — and
 *                   `parseFile` returns edges, not trees, so a text-line proxy
 *                   measured 2,044 "LHS writes" in a 120-file draw that were
 *                   mostly reads followed by an unrelated `=` elsewhere on the
 *                   line. That number was discarded rather than reported; the tree
 *                   measurement lives in `vb-uses-shape-probe.ts`.
 *   NAME-SHAPED     endpoints that are not a plausible name (a space, a paren, a
 *                   quote). This is the defect class the lane recorded for
 *                   `New AnimatedBlock()` being published as the literal string
 *                   `"New AnimatedBlock"`.
 *   EVIDENCE        per type, the (confidence, evidenceClass) distribution and the
 *                   share below the 0.7 honesty floor. The contract requires a
 *                   machine-readable reason code on every edge under it, so a
 *                   type with sub-floor edges and no evidence class is a contract
 *                   breach, not a style question.
 *   RESOLUTION      both endpoints resolving to a symbol the same file declares,
 *                   scored per type, because the honest denominator differs: an
 *                   `imports` target is a namespace this file will never declare.
 *
 * And ONE grammar hazard, measured rather than argued: `node.startIndex` and
 * `node.endIndex` from web-tree-sitter are BYTE offsets, while `node.text` is a
 * JS string indexed in UTF-16 code units. `spanKeywordBetween` and
 * `hasEndNamespace` slice `node.text` at `endIndex - startIndex`, so any
 * non-ASCII character earlier in the declaration shifts the slice. The grammar
 * admits Unicode identifiers, so this is reachable. The probe counts heritage
 * edges in files that contain a non-ASCII byte BEFORE the declaration's colon.
 *
 * CLI: npx tsx script/m14/vb-edge-integrity.ts [--sample N] [--workers 4] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const WORKERS = Math.max(1, parseInt(argOf("--workers", "4") ?? "4"))
const OUT = argOf("--out")
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
/** This lane's OWN naming contract. Neither string is written in any .vb file. */
const CONTRACT_LITERALS = new Set(["constructor", "operator"])
/** `ASTEngine.SymbolKind`'s own values (`src/ast/engine.ts:381`), read from the
 *  enum rather than from a list written here — the LUA-00 defect class, in a
 *  probe. A first version of this list spelled `EnumMember` as `enumMember` and
 *  reported 122 "kinds outside the product's set" in a 120-file draw, which was
 *  the PROBE being wrong about the product, not the product being wrong. */
const KNOWN_SYMBOL_KINDS = new Set([
  "function", "class", "interface", "method", "property", "variable", "constant",
  "module", "namespace", "type", "enum", "enum_member", "struct", "constructor",
  "event", "delegate", "table", "service", "resource", "object", "record", "macro",
  "trait", "impl", "actor", "union", "mixin", "import", "export",
])

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
console.log(`vb edge integrity — corpus ${CR}  admitted ${files.length}  drawn ${draw.length}  workers ${WORKERS}\n`)

type TypeStat = {
  edges: number
  duplicateRows: number
  duplicatePairs: Array<{ key: string; n: number }>
  contractSource: number
  contractTarget: number
  contractTargetDuplicates: Array<{ key: string; n: number }>
  enumMemberTarget: number
  notNameShaped: number
  notNameShapedSamples: string[]
  bracketedEndpoint: number
  bracketedSamples: string[]
  emptySource: number
  emptyTarget: number
  selfEdge: number
  noLine: number
  conf: Map<string, number>
  evidence: Map<string, number>
  subFloor: number
  subFloorNoEvidence: number
  resBoth: number
  resSourceOnly: number
  resTargetOnly: number
  resNeither: number
  sampleFiles: Set<string>
}
const stat = (): TypeStat => ({
  edges: 0, duplicateRows: 0, duplicatePairs: [], contractSource: 0, contractTarget: 0,
  contractTargetDuplicates: [], enumMemberTarget: 0, notNameShaped: 0,
  notNameShapedSamples: [], bracketedEndpoint: 0, bracketedSamples: [], emptySource: 0, emptyTarget: 0, selfEdge: 0, noLine: 0,
  conf: new Map(), evidence: new Map(), subFloor: 0, subFloorNoEvidence: 0,
  resBoth: 0, resSourceOnly: 0, resTargetOnly: 0, resNeither: 0, sampleFiles: new Set(),
})
const byType = new Map<Type, TypeStat>()
for (const t of ALL_TYPES) byType.set(t, stat())

let filesRead = 0, unknownKindSymbols = 0, emptyNameSymbols = 0, symbolsTotal = 0
const unknownKindSamples: string[] = []
const nonAsciiFiles = new Set<string>()
const nonAsciiHeritage = new Map<string, number>()

/** A plausible NAME endpoint: identifier characters and dots only. Anything with a
 *  space, a paren, a quote or a newline in it is expression TEXT. Unicode above
 *  127 is admitted because the grammar admits Unicode identifiers (repair 10). */
function isNameShaped(s: string): boolean {
  if (s.length === 0 || s.length > 200) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 46 || c > 127
    if (!ok) return false
  }
  return true
}

/**
 * VB's BRACKETED-IDENTIFIER ESCAPE, and why it is counted separately rather than
 * called a bad name.
 *
 * `Public Shared ReadOnly Property [Default]() As MySettings` is a real VB.NET
 * declaration: `[Default]` is how the language spells an identifier that collides
 * with a keyword, exactly as C#'s `@Default`. The analyzer publishes the name as
 * WRITTEN, so `contains MySettings -> [Default]` resolves against the symbol the
 * file declares and is internally consistent.
 *
 * It is still worth its own number rather than being folded into "name-shaped",
 * because a consumer that resolves an edge target by looking the name up in a
 * plain identifier table will not find `[Default]`, and because it is the only
 * endpoint shape in this lane that a reader has to be told about. It is NOT
 * expression text and it is NOT a placeholder, which is why it is not in either
 * bucket.
 */
function isBracketed(s: string): boolean {
  return s.startsWith("[") && s.endsWith("]") && s.length > 2
}

/** Per-file tally of a keyed group of edge rows, keyed under an explicit prefix. */
function bump(store: Map<string, Map<string, number>>, bucket: string, key: string): void {
  const per = store.get(bucket) ?? new Map<string, number>()
  per.set(key, (per.get(key) ?? 0) + 1)
  store.set(bucket, per)
}

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const label = `${f.repo}/${f.rel}`
    // A file with a non-ASCII byte anywhere: the offset hazard is about bytes
    // before a declaration, so the whole file is the conservative over-set.
    const hasNonAscii = /[^\x00-\x7F]/.test(f.text)
    if (hasNonAscii) nonAsciiFiles.add(label)
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    filesRead++
    const syms: any[] = r?.symbols ?? []
    symbolsTotal += syms.length
    const names = new Set<string>()
    const enumMembers = new Set<string>()
    const ownerKind = new Map<string, string>()
    for (const s of syms) {
      if (typeof s?.name === "string" && s.name.length > 0) names.add(s.name)
      else emptyNameSymbols++
      const k = String(s?.kind ?? "")
      if (!KNOWN_SYMBOL_KINDS.has(k)) {
        unknownKindSymbols++
        if (unknownKindSamples.length < 10) unknownKindSamples.push(`${k} "${s?.name}" in ${label}`)
      }
      if (k === "enumMember" || k === "enum_member") enumMembers.add(String(s?.name))
      if (typeof s?.ownerName === "string") ownerKind.set(s.name, String(s?.ownerKind ?? ""))
    }
    // Reads, for the LHS test: lines that begin with an assignment are not
    // enough — a member access can be the LHS on any line. The engine gives no
    // node, so the honest proxy is the SOURCE TEXT of the edge's line: a line
    // whose first occurrence of the target name is followed by `=` (not `==`,
    // `<=`, `>=`, `<>`) is a write. It is a PROXY and is labelled as one.
    const seen = new Map<string, Map<string, number>>()
    for (const x of r?.relationships ?? []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const s = byType.get(t)!
      s.edges++
      if (s.sampleFiles.size < 4) s.sampleFiles.add(label)
      const src = String(x?.source ?? "")
      const tgt = String(x?.target ?? "")
      const line = typeof x?.line_number === "number" ? x.line_number : 0
      const conf = typeof x?.confidence === "number" ? x.confidence : 1
      const ev = String(x?.metadata?.evidenceClass ?? "(none)")
      s.conf.set(String(conf), (s.conf.get(String(conf)) ?? 0) + 1)
      s.evidence.set(ev, (s.evidence.get(ev) ?? 0) + 1)
      if (conf < 0.7) {
        s.subFloor++
        if (ev === "(none)") s.subFloorNoEvidence++
      }
      if (!(line > 0)) s.noLine++
      if (src.length === 0) s.emptySource++
      if (tgt.length === 0) s.emptyTarget++
      if (src === tgt && t !== "contains") s.selfEdge++
      if (CONTRACT_LITERALS.has(src)) s.contractSource++
      if (CONTRACT_LITERALS.has(tgt)) {
        s.contractTarget++
        bump(seen, `lit${tgt}`, `${src}->${tgt}:${line}`)
      }
      if (t === "exports" && enumMembers.has(tgt)) s.enumMemberTarget++
      if (isBracketed(src) || isBracketed(tgt)) {
        s.bracketedEndpoint++
        if (s.bracketedSamples.length < 4) s.bracketedSamples.push(`${src} -> ${tgt} (${label}:${line})`)
      } else if (!isNameShaped(src) || !isNameShaped(tgt)) {
        s.notNameShaped++
        if (s.notNameShapedSamples.length < 4) s.notNameShapedSamples.push(`${src} -> ${tgt} (${label}:${line})`)
      }
      // duplicate rows within this file
      bump(seen, `dup${t}`, `${src} > ${tgt} [${t}] @${line}`)
      // resolution
      const sb = names.has(src) || src === "root"
      const tb = names.has(tgt)
      if (sb && tb) s.resBoth++
      else if (sb) s.resSourceOnly++
      else if (tb) s.resTargetOnly++
      else s.resNeither++
    }
    // Count duplicates once the file is complete. The bucket key carries its own
    // prefix and the type name is recovered by slicing THAT, never by slicing the
    // whole key — an earlier version sliced the last character off a bare
    // contract-literal bucket (`"constructor"` -> `"constructo"`) and looked the
    // result up in the type table, so a class with two public constructors threw
    // on `byType.get(...)` being undefined. That is the probe's own bug class:
    // the check that counts contract-literal duplicates was the check that
    // crashed on them.
    for (const [bucket, per] of seen) {
      const t = bucket.slice(3) as Type
      const s = byType.get(t)
      if (!s) continue
      if (bucket.startsWith("lit")) {
        for (const [key, n] of per) if (n > 1) s.contractTargetDuplicates.push({ key, n })
        continue
      }
      for (const [key, n] of per) {
        if (n > 1) {
          s.duplicateRows += n
          s.duplicatePairs.push({ key, n })
        }
      }
    }
    if (hasNonAscii) {
      for (const x of r?.relationships ?? []) {
        const t = String(x?.type ?? "").toLowerCase()
        if (t === "extends" || t === "implements") {
          nonAsciiHeritage.set(t, (nonAsciiHeritage.get(t) ?? 0) + 1)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// --------------------------------------------------------------------------- report
console.log(`files read through production parseFile: ${filesRead}`)
console.log(`symbols: ${symbolsTotal}   empty names: ${emptyNameSymbols}   kinds outside the product's set: ${unknownKindSymbols}`)
for (const u of unknownKindSamples) console.log(`    ${u}`)
console.log(`files containing a non-ASCII byte: ${nonAsciiFiles.size}`)
for (const [t, n] of [...nonAsciiHeritage].sort()) console.log(`    ${t} edges in non-ASCII files: ${n}`)

console.log(`\n${"type".padEnd(14)}${"edges".padStart(9)}${"dupRows".padStart(9)}${"litTgt".padStart(8)}${"litDup".padStart(8)}${"enumTgt".padStart(9)}${"brack".padStart(7)}${"badName".padStart(9)}${"noLine".padStart(8)}${"empty".padStart(7)}${"self".padStart(7)}  both%  sub<0.7  subNoEv`)
console.log("-".repeat(135))
const report: any = {}
for (const t of ALL_TYPES) {
  const s = byType.get(t)!
  const litDup = s.contractTargetDuplicates.reduce((a, b) => a + b.n, 0)
  const dupRows = s.duplicateRows
  const bothPct = s.edges === 0 ? "-" : `${((s.resBoth / s.edges) * 100).toFixed(1)}%`
  console.log(
    `${t.padEnd(14)}${String(s.edges).padStart(9)}${String(dupRows).padStart(9)}${String(s.contractTarget).padStart(8)}${String(litDup).padStart(8)}` +
    `${String(s.enumMemberTarget).padStart(9)}${String(s.bracketedEndpoint).padStart(7)}${String(s.notNameShaped).padStart(9)}${String(s.noLine).padStart(8)}` +
    `${String(s.emptySource + s.emptyTarget).padStart(7)}${String(s.selfEdge).padStart(7)}  ${bothPct.padStart(5)}  ${String(s.subFloor).padStart(6)}  ${String(s.subFloorNoEvidence).padStart(7)}`,
  )
  report[t] = {
    edges: s.edges,
    duplicateRows: dupRows,
    duplicatePairSamples: s.duplicatePairs.slice(0, 8),
    contractLiteralTargets: s.contractTarget,
    enumMemberTargets: s.enumMemberTarget,
    notNameShaped: s.notNameShaped,
    notNameShapedSamples: s.notNameShapedSamples,
    bracketedIdentifierEndpoints: s.bracketedEndpoint,
    bracketedSamples: s.bracketedSamples,
    emptyEndpoints: s.emptySource + s.emptyTarget,
    selfEdges: s.selfEdge,
    edgesWithoutPositiveLine: s.noLine,
    confidence: Object.fromEntries([...s.conf].sort((a, b) => Number(a[0]) - Number(b[0]))),
    evidenceClass: Object.fromEntries([...s.evidence].sort((a, b) => b[1] - a[1])),
    belowConfidenceFloor: s.subFloor,
    belowFloorWithoutEvidenceClass: s.subFloorNoEvidence,
    resolvedBothEnds: s.resBoth,
    resolvedSourceOnly: s.resSourceOnly,
    resolvedTargetOnly: s.resTargetOnly,
    resolvedNeither: s.resNeither,
    resolvedBothEndsPct: s.edges === 0 ? null : +((s.resBoth / s.edges) * 100).toFixed(2),
    sampleFiles: [...s.sampleFiles],
  }
}

console.log(`\nduplicate-row detail (same source/target/type/line emitted more than once in one file):`)
for (const t of ALL_TYPES) {
  const s = byType.get(t)!
  if (s.duplicateRows === 0) continue
  console.log(`  ${t}: ${s.duplicateRows} rows`)
  for (const d of s.duplicatePairs.slice(0, 6)) console.log(`      ${d.n}x  ${d.key}`)
}
console.log(`\nnot-name-shaped endpoints (expression TEXT published as a name):`)
for (const t of ALL_TYPES) {
  const s = byType.get(t)!
  if (s.notNameShaped === 0) continue
  console.log(`  ${t}: ${s.notNameShaped}`)
  for (const x of s.notNameShapedSamples) console.log(`      ${x}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, admitted: files.length, drawn: draw.length, workers: WORKERS,
    filesRead, symbols: symbolsTotal, emptyNameSymbols, unknownKindSymbols, unknownKindSamples,
    filesWithNonAscii: nonAsciiFiles.size, heritageInNonAsciiFiles: Object.fromEntries(nonAsciiHeritage),
    types: report,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exitCode = unknownKindSymbols + emptyNameSymbols === 0 ? 0 : 1
