/**
 * solidity-dump-classify — turn the fleet gate's OWN per-edge dump into the Solidity lane's D3 cause
 * table (ALL-OUT-OF-ALL §9.1 D3: every non-resolved edge in exactly one declared class, closure exact).
 *
 * WHY THIS EXISTS. `script/m14/incoming-gate.ts solidity sol <cap>` prints, per relationship type, the
 * counts of edges that did not resolve and edges that matched several declarations. A count is not a
 * cause: "uses unresolved 2,400" is not work until it is "N bare reads of function-scope bindings + K
 * Yul path-segment reads + …". This file does NOT walk the population again: it reads the dump the
 * gate itself emitted, so the rows ARE the gate's rows.
 *
 * MARKERS ARE JOINED, NOT GUESSED. The dump carries only `label · outcome · target · srcFile:line ·
 * claimKind`. The lane's causes are the analyzer's OWN metadata markers (`calleeKind` for calls — the
 * SOL-15 taxonomy; `isVariableReference` / `isYulPathSegment` / `isMemberReference` / `isYulVariableRead`
 * for uses; `isImport` for references; `reasonCode` / `externalBase` for extends/overrides). So each
 * distinct dumped file is re-analysed ONCE through the PRODUCTION entry (`parseFile`) WITH the project
 * index the arm ran with, and every dump row is joined by `label + target + line`. The JOIN RATE is
 * printed and a miss is a CONTROL FAILURE, not a shrug — an unjoinable row would make its cause a guess.
 * A SAMPLED dump is refused: the arm indexed only the sample, so a rebuilt index is a different
 * project view and the table would describe a configuration no arm ran.
 *
 * THE CONTROL (three assertions, all printed):
 *   A. TABLE PARITY — per type: dumped rows == edges − resolved; dumped unresolved == TABLE 1
 *      unresolved; dumped ambiguous == TABLE 1 amb(decl); dumped claims == extOK+ext?+extFAIL; dumped
 *      bindings == bindOK+bind?+bindFAIL; dumped causes == causeOK+causeFAIL.
 *   B. JOIN — every dumped row joins exactly one analysed edge; misses printed as 0.
 *   C. CLOSURE — `population == TOTAL == resolved + classified + claims + bindings + causes`, and
 *      `sum(class rows) == classified`, `unclassified-label rows == 0`.
 *
 * `BB_DUMP_LIMIT` smaller than the population truncates the dump and every assertion fails: the tool
 * exits 3 rather than print a class table over a cut population (the lead's carry-over #2).
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   BB_DUMP_LIMIT=1000000 bun run script/m14/incoming-gate.ts solidity sol 0 --dump > dump.txt
 *   bun run script/m14/solidity-dump-classify.ts <dump-file> [--json]
 *
 * EXIT: 0 classified · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { createReadStream, readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, SOLIDITY_DECLARATION_SPEC } from "../../src/ast/project-index"
import { resolveWasmAsset } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")
if (!FILE) {
  console.error("usage: bun run script/m14/solidity-dump-classify.ts <dump-file> [--json]")
  process.exit(2)
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]
const KNOWN_TYPES = new Set<string>(ALL_TYPES)
const CLAIM_OUTCOMES = new Set(["externalVerified", "externalRefuted", "externalUnverified"])
const BINDING_OUTCOMES = new Set(["bindingVerified", "bindingRefuted", "bindingUnverified"])
const CAUSE_OUTCOMES = new Set(["causeVerified", "causeRefuted", "causeUnverified", "causeOK", "causeFAIL"])
const UNRESOLVED_OUTCOMES = new Set(["unresolved", "externalRefuted", "bindingRefuted"])
const AMBIGUOUS_OUTCOMES = new Set(["ambDeclOnly", "ambBoth"])

interface Table1 {
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
  unresolved: number; extOK: number; extUnknown: number; extFAIL: number
  bindOK: number; bindUnknown: number; bindFAIL: number; causeOK: number; causeFAIL: number
}

// ── pass 1: stream the dump; collect rows + TABLE 1 + intent twin ─────────────────────────────
type DumpRow = { label: string; outcome: string; target: string; src: string; line: number }
const rows: DumpRow[] = []
const table1 = new Map<string, Table1>()
const byOutcome = new Map<string, Map<string, number>>()
const dumped = new Map<string, number>()
/** SOL-W8 — claim/binding/cause rows are their OWN columns in TABLE 1, so the parity check must
 *  account for them per type: with a claim kind in play, `dumped rows == edges − resolved` is no
 *  longer the identity — `dumped + claims + bindings + causes == edges − resolved` is. */
const claimByType = new Map<string, number>()
const bindingByType = new Map<string, number>()
const causeByType = new Map<string, number>()
const unclassifiedLabels = new Map<string, number>()
let dumpLines = 0
let malformed = 0
let claimRows = 0
let bindingRows = 0
let causeRows = 0
let unclassifiedOutcomeRows = 0
let table1Seen = false
let headerCols: string[] = []
let intentTwin: number | null = null
let intentHeader: string[] = []

const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  // BINDING INTENT table — detected FIRST (the TABLE 1 block consumes every later line).
  if (line.includes("sameFileUnproven") && line.includes("arbitraryTwin") && line.includes("intended") && line.trim().startsWith("type")) {
    intentHeader = line.trim().split(/\s+/)
    continue
  }
  if (intentHeader.length > 0 && line.trim().startsWith("TOTAL")) {
    const cols = line.trim().split(/\s+/)
    const i = intentHeader.indexOf("arbitraryTwin")
    if (i > 0 && cols[i] !== undefined && /^\d+$/.test(cols[i])) intentTwin = Number(cols[i])
    continue
  }
  if (line.startsWith("DUMP\t")) {
    dumpLines++
    const parts = line.split("\t")
    if (parts.length < 6) { malformed++; continue }
    const label = parts[1]
    const outcome = parts[2]
    const target = parts[3]
    const srcLine = parts[4] ?? ""
    if (!KNOWN_TYPES.has(label)) { unclassifiedLabels.set(label, (unclassifiedLabels.get(label) ?? 0) + 1); continue }
    if (CLAIM_OUTCOMES.has(outcome)) {
      claimRows++
      claimByType.set(label, (claimByType.get(label) ?? 0) + 1)
      continue
    }
    if (BINDING_OUTCOMES.has(outcome)) {
      bindingRows++
      bindingByType.set(label, (bindingByType.get(label) ?? 0) + 1)
      continue
    }
    if (CAUSE_OUTCOMES.has(outcome)) {
      causeRows++
      causeByType.set(label, (causeByType.get(label) ?? 0) + 1)
      continue
    }
    const isUnresolved = UNRESOLVED_OUTCOMES.has(outcome)
    const isAmbiguous = AMBIGUOUS_OUTCOMES.has(outcome)
    if (!isUnresolved && !isAmbiguous) { unclassifiedOutcomeRows++; continue }
    const cut = srcLine.lastIndexOf(":")
    const lineNo = cut > 0 ? Number(srcLine.slice(cut + 1)) : 0
    rows.push({ label, outcome, target, src: srcLine.slice(0, cut), line: lineNo })
    dumped.set(label, (dumped.get(label) ?? 0) + 1)
    if (!byOutcome.has(label)) byOutcome.set(label, new Map())
    const om = byOutcome.get(label)!
    om.set(outcome, (om.get(outcome) ?? 0) + 1)
    continue
  }
  if (line.includes("TABLE 1 — PER PROJECT")) { table1Seen = true; continue }
  if (table1Seen && headerCols.length === 0 && line.includes("type") && line.includes("edges") && line.includes("resolved")) {
    headerCols = line.trim().split(/\s+/)
    continue
  }
  if (table1Seen && headerCols.length > 0) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < headerCols.length) continue
    const t = cols[0]
    if (!KNOWN_TYPES.has(t)) continue
    const num = (name: string): number => {
      const i = headerCols.indexOf(name)
      return i >= 0 && cols[i] !== undefined ? Number(cols[i]) : 0
    }
    table1.set(t, {
      edges: num("edges"), resolved: num("resolved"), collRes: num("collRes"),
      ambDecl: num("amb(decl)"), ambKind: num("amb(kind)"), unresolved: num("unresolved"),
      extOK: num("extOK"), extUnknown: num("ext?"), extFAIL: num("extFAIL"),
      bindOK: num("bindOK"), bindUnknown: num("bind?"), bindFAIL: num("bindFAIL"),
      causeOK: num("causeOK"), causeFAIL: num("causeFAIL"),
    })
  }
}
if (!table1Seen || table1.size === 0) {
  console.error(`CONTROL DID NOT FIRE: no TABLE 1 in ${FILE} — not a gate dump, or a schema change.`)
  process.exit(3)
}

// ── pass 2: join each row to the analyzer's own edge (markers) ────────────────────────────────

/**
 * THE ARM'S CONFIGURATION IS PART OF THE ROW. Every recorded class on this lane was produced by an
 * INDEXED arm (`--index`), and this join used to re-analyse each file with NO project index. The
 * markers are not index-independent: `parseFile` without an index reports an inherited project
 * member call as `calleeKind: "external"`, and WITH the index the same row is
 * `crossFileInheritedMember`. The join key (label + target + line) is identical either way, so the
 * control — "every dumped row joins exactly one analysed edge" — passed while the CAUSE was read
 * from a different configuration than the run. MEASURED: `AccessControl.sol` `_msgSender` reads
 * `external` without the index and `crossFileInheritedMember` with it, and 1,849 `calls` rows were
 * charged to W3 (cross-file/unvendored) on the strength of a no-index re-analysis.
 *
 * THE INDEX IS REBUILT FROM THE POPULATION THE DUMP NAMES, because a whole-run arm's index IS the
 * repository's index. A SAMPLED dump cannot be reconstructed this way — the arm indexed a slice —
 * so this refuses instead of producing a table from a different project view.
 */
const POP = /population:\s+(\d+) parsed of (\d+) sampled \(corpus has (\d+) /;
let indexFiles = 0
let indexRepos = 0
let indexRefused: string | null = null
const dumpText = readFileSync(FILE, "utf8")
const pop = POP.exec(dumpText)
if (pop === null) {
  indexRefused = "the dump carries no population line — its index cannot be reconstructed"
} else if (pop[1] !== pop[3]) {
  indexRefused = `SAMPLEd dump (${pop[1]} of a corpus of ${pop[3]}): the arm indexed only the sample, and a rebuilt index would be a different project view`
}
const joinKey = (label: string, target: string, line: number) => `${label}\u0000${target}\u0000${line}`
const markIndex = new Map<string, any[]>()
/**
 * INDEX-ONLY LABEL FALLBACK. The fallback exists for a join that runs WITHOUT the index, where a
 * cross-file modifier application is published as `calls` (calleeKind `modifierInvocation`) while
 * the arm publishes `decorates`. Now that the join carries the arm's index, the fallback should
 * read ZERO — and it is kept as a measurable line rather than deleted, because a fallback that
 * starts firing again says the join and the arm have diverged. A `decorates` row may join a
 * `calls` row at the same target+line only when that row's own marker says `modifierInvocation`;
 * anything else is still a join miss and still fails the control.
 */
const anyIndex = new Map<string, Array<{ label: string; md: any }>>()
const files = [...new Set(rows.map((r) => r.src))].sort()
const repoOf = (abs: string) => path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
const repoFiles = new Map<string, string[]>()
for (const repoRoot of [...new Set(files.map(repoOf))].sort()) {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".sol")) out.push(p)
    }
  }
  walk(repoRoot)
  repoFiles.set(repoRoot, out.sort())
}
const indexes = new Map<string, any>()
if (indexRefused === null) {
  const wasm = resolveWasmAsset("tree-sitter-solidity.wasm")
  for (const [repoRoot, fsPaths] of repoFiles) {
    indexes.set(repoRoot, await buildProjectIndexStreaming(wasm, fsPaths, SOLIDITY_DECLARATION_SPEC))
    indexFiles += fsPaths.length
  }
  indexRepos = indexes.size
  if (pop !== null && indexFiles !== Number(pop[3])) {
    indexRefused = `rebuilt index covers ${indexFiles} file(s), the arm's corpus is ${pop[3]} — not the same project view`
    indexes.clear()
    indexFiles = 0
    indexRepos = 0
  }
}
if (indexRefused !== null) {
  console.error(`CONTROL DID NOT FIRE: ${indexRefused}.\nThe class table would be read from a DIFFERENT configuration than the arm; re-run the gate with --index over 0 (whole) and classify THAT dump.`)
  process.exit(3)
}
let reanalyzed = 0
let reanalyzeFailed = 0
let indexSuppliedMissing = 0
for (const abs of files) {
  const repoRoot = repoOf(abs)
  let result: any
  try {
    result = await parseFile(abs, repoRoot, { projectIndex: indexes.get(repoRoot), projectRoot: repoRoot } as any)
  } catch {
    reanalyzeFailed++
    continue
  }
  reanalyzed++
  for (const r of (result.relationships ?? []) as any[]) {
    const md = r.metadata ?? {}
    if (md.projectIndexSupplied !== true) indexSuppliedMissing++
    const label = String(r.type ?? "")
    const target = String(r.target ?? "")
    const line = Number(r.line_number ?? r.line ?? 0)
    const k = joinKey(label, target, line)
    const list = markIndex.get(k) ?? []
    list.push(r.metadata ?? {})
    markIndex.set(k, list)
    const ak = `${target}\u0000${line}`
    const anyList = anyIndex.get(ak) ?? []
    anyList.push({ label, md: r.metadata ?? {} })
    anyIndex.set(ak, anyList)
  }
}
const joinConsumed = new Map<string, number>()
const anyConsumed = new Map<string, number>()
let joinMisses = 0
let indexOnlyDecorates = 0
const joined: Array<{ row: DumpRow; md: any }> = []
for (const row of rows) {
  const k = joinKey(row.label, row.target, row.line)
  const used = joinConsumed.get(k) ?? 0
  const list = markIndex.get(k)
  if (!list || used >= list.length) {
    // The narrow index-only label fallback declared above.
    const ak = `${row.target}\u0000${row.line}`
    const anyUsed = anyConsumed.get(ak) ?? 0
    const candidates = anyIndex.get(ak) ?? []
    const candidate = candidates.slice(anyUsed).find((c) =>
      row.label === "decorates" && c.label === "calls" &&
      (c.md?.isModifierInvocation === true || c.md?.calleeKind === "modifierInvocation")
    )
    if (candidate) {
      anyConsumed.set(ak, anyUsed + 1)
      indexOnlyDecorates++
      joined.push({ row, md: { ...candidate.md, indexOnlyDecorate: true } })
      continue
    }
    joinMisses++
    joined.push({ row, md: null })
    continue
  }
  joinConsumed.set(k, used + 1)
  joined.push({ row, md: list[used] })
}

// ── classification: the analyzer's OWN markers first, spelling only as a NAMED fallback ──────
function classify(row: DumpRow, md: any): { family: string; declaredClass: string } {
  const t = row.target
  if (md === null) return { family: "join-miss", declaredClass: "JOIN-MISS (control failure)" }
  if (md.indexOnlyDecorate === true) return { family: "index-only-decorate", declaredClass: "W3-cross-file-modifier-target" }
  if (row.label === "imports") {
    return md.importPath === true || typeof md.importPath === "string"
      ? { family: "import-path", declaredClass: "W1-module-path-not-a-symbol" }
      : { family: "import-other", declaredClass: "W1-module-path-not-a-symbol" }
  }
  if (row.label === "calls") {
    const kind = typeof md.calleeKind === "string" ? md.calleeKind : "(none)"
    if (kind === "namespaceBuiltin") return { family: "language-namespace", declaredClass: "W2-language-namespace-builtin" }
    if (kind === "external") return { family: "external-target", declaredClass: "W3-cross-file-or-unvendored-target" }
    if (kind === "modifierInvocation") return { family: "modifier-invocation", declaredClass: "W4-declared-kind-not-in-run" }
    if (kind === "eventEmission") return { family: "event-emission", declaredClass: "W4-declared-kind-not-in-run" }
    if (kind === "errorRevert") return { family: "error-revert", declaredClass: "W4-declared-kind-not-in-run" }
    if (kind === "localFunction" || kind === "inheritedMember" || kind === "inFileTypeMember") {
      return { family: `in-file-${kind}`, declaredClass: "W5-in-file-name-not-a-declaration" }
    }
    return { family: `unlabelled-${kind}`, declaredClass: "W5-in-file-name-not-a-declaration" }
  }
  if (row.label === "uses") {
    if (md.isYulPathSegment === true) return { family: "yul-path-segment", declaredClass: "W6-yul-path-segment-read" }
    if (md.isYulVariableRead === true) return { family: "yul-variable-read", declaredClass: "W6-yul-path-segment-read" }
    if (md.isMemberReference === true) return { family: "member-reference", declaredClass: "W7-member-or-builtin-read" }
    if (md.isVariableReference === true) return { family: "variable-reference", declaredClass: "W8-function-scope-binding-read" }
    return { family: "unlabelled", declaredClass: "W8-function-scope-binding-read" }
  }
  if (row.label === "references") {
    if (md.isImport === true) return { family: "import-binding", declaredClass: "W9-import-binding-not-in-run" }
    return { family: "type-or-using", declaredClass: "W10-type-mention-not-in-run" }
  }
  if (row.label === "extends") {
    if (md.reasonCode === "base-not-declared-in-file" || md.kindUnresolved === true) {
      return { family: "base-not-declared-in-file", declaredClass: "W3-cross-file-or-unvendored-target" }
    }
    return { family: "other", declaredClass: "W3-cross-file-or-unvendored-target" }
  }
  if (row.label === "implements") {
    return { family: "interface-base", declaredClass: "W3-cross-file-or-unvendored-target" }
  }
  if (row.label === "overrides") {
    if (md.externalBase === true || md.reasonCode === "named-by-override-specifier" || md.reasonCode === "single-header-base") {
      return { family: "external-or-single-base", declaredClass: "W11-override-base-outside-run" }
    }
    return { family: "other", declaredClass: "W11-override-base-outside-run" }
  }
  if (row.label === "instantiates") {
    return { family: "constructed-contract", declaredClass: "W3-cross-file-or-unvendored-target" }
  }
  if (row.label === "exports") {
    return { family: "compilation-unit-surface", declaredClass: "W12-export-surface-not-a-declaration" }
  }
  if (row.label === "contains") {
    return { family: "declaration", declaredClass: "W13-contains-unresolved" }
  }
  void t
  return { family: "unknown-label", declaredClass: "W0-unknown" }
}

const perType: Record<string, { unresolved: number; ambiguous: number; classes: Map<string, { family: string; declaredClass: string; unresolved: number; ambiguous: number; samples: string[] }> }> = {}
for (const { row, md } of joined) {
  const c = classify(row, md)
  const entry = perType[row.label] ?? (perType[row.label] = { unresolved: 0, ambiguous: 0, classes: new Map() })
  const isAmbiguous = AMBIGUOUS_OUTCOMES.has(row.outcome)
  if (isAmbiguous) entry.ambiguous++
  else entry.unresolved++
  const cls = entry.classes.get(c.declaredClass) ?? { family: c.family, declaredClass: c.declaredClass, unresolved: 0, ambiguous: 0, samples: [] }
  if (isAmbiguous) cls.ambiguous++
  else cls.unresolved++
  if (cls.samples.length < 4) cls.samples.push(`${row.src}:${row.line}: ${row.target} [${c.family}]`)
  entry.classes.set(c.declaredClass, cls)
}

// ── THE CONTROL ───────────────────────────────────────────────────────────────────────────────
const failures: string[] = []
let tableEdges = 0
let tableResolved = 0
const perTypeControl: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const tbl = table1.get(t)
  if (!tbl) continue
  tableEdges += tbl.edges
  tableResolved += tbl.resolved
  const outcomes = byOutcome.get(t) ?? new Map<string, number>()
  const d = dumped.get(t) ?? 0
  const unresolvedDumped = (outcomes.get("unresolved") ?? 0) + (outcomes.get("externalRefuted") ?? 0) + (outcomes.get("bindingRefuted") ?? 0)
  const ambDumped = (outcomes.get("ambDeclOnly") ?? 0) + (outcomes.get("ambBoth") ?? 0)
  const expected = Math.max(0, tbl.edges - tbl.resolved)
  const claimD = claimByType.get(t) ?? 0
  const bindD = bindingByType.get(t) ?? 0
  const causeD = causeByType.get(t) ?? 0
  perTypeControl[t] = {
    dumped: d, expected, unresolvedDumped, unresolvedExpected: tbl.unresolved,
    ambDumped, ambExpected: tbl.ambDecl,
    claimDumped: claimD, claimExpected: tbl.extOK + tbl.extUnknown + tbl.extFAIL,
    bindingDumped: bindD, bindingExpected: tbl.bindOK + tbl.bindUnknown + tbl.bindFAIL,
    causeDumped: causeD, causeExpected: tbl.causeOK + tbl.causeFAIL,
  }
  // THE IDENTITY, with claim columns in play: every non-resolved edge is classified OR carried by
  // its own claim/binding/cause column. Nothing is dropped and nothing is folded.
  if (d + claimD + bindD + causeD !== expected) {
    failures.push(`${t}: dumped ${d} + claims ${claimD} + bindings ${bindD} + causes ${causeD} != edges-resolved ${expected}`)
  }
  if (claimD !== tbl.extOK + tbl.extUnknown + tbl.extFAIL) failures.push(`${t}: claim rows ${claimD} != TABLE 1 claim columns`)
  if (bindD !== tbl.bindOK + tbl.bindUnknown + tbl.bindFAIL) failures.push(`${t}: binding rows ${bindD} != TABLE 1 bindOK+bind?+bindFAIL`)
  if (unresolvedDumped !== tbl.unresolved) failures.push(`${t}: dumped unresolved ${unresolvedDumped} != TABLE 1 unresolved ${tbl.unresolved}`)
  if (ambDumped !== tbl.ambDecl) failures.push(`${t}: dumped ambiguous ${ambDumped} != TABLE 1 amb(decl) ${tbl.ambDecl}`)
}
const tableClaim = [...table1.values()].reduce((a, r) => a + r.extOK + r.extUnknown + r.extFAIL, 0)
const tableBind = [...table1.values()].reduce((a, r) => a + r.bindOK + r.bindUnknown + r.bindFAIL, 0)
const tableCause = [...table1.values()].reduce((a, r) => a + r.causeOK + r.causeFAIL, 0)
if (claimRows !== tableClaim) failures.push(`claim rows dumped ${claimRows} != TABLE 1 ${tableClaim}`)
if (bindingRows !== tableBind) failures.push(`binding rows dumped ${bindingRows} != TABLE 1 ${tableBind}`)
if (causeRows !== tableCause) failures.push(`cause rows dumped ${causeRows} != TABLE 1 ${tableCause}`)
const unclassifiedLabelRows = [...unclassifiedLabels.values()].reduce((a, b) => a + b, 0)
if (unclassifiedLabels.size > 0) failures.push(`unclassified labels: ${[...unclassifiedLabels.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`)
if (unclassifiedOutcomeRows > 0) failures.push(`unclassified outcome rows: ${unclassifiedOutcomeRows}`)
if (malformed > 0) failures.push(`malformed DUMP rows: ${malformed}`)
if (reanalyzeFailed > 0) failures.push(`files that could not be re-analysed for the marker join: ${reanalyzeFailed}`)
if (indexSuppliedMissing > 0) failures.push(`edges without projectIndexSupplied in the join: ${indexSuppliedMissing} — the join did not run in the arm's configuration`)
if (joinMisses > 0) failures.push(`JOIN misses: ${joinMisses} of ${rows.length} dumped rows did not join to an analysed edge`)
if (dumpLines !== rows.length + claimRows + bindingRows + causeRows + unclassifiedOutcomeRows + unclassifiedLabelRows + malformed) {
  failures.push(`dump lines ${dumpLines} != classified ${rows.length}+claims ${claimRows}+bindings ${bindingRows}+causes ${causeRows}+unclassified ${unclassifiedOutcomeRows}+unclassifiedLabel ${unclassifiedLabelRows}+malformed ${malformed}`)
}
if (failures.length > 0) {
  if (JSON_OUT) {      console.log(JSON.stringify({ control: { ok: false, failures, join: { misses: joinMisses, indexOnlyDecorates, rows: rows.length }, perTypeControl }, perType: summarize(perType, true) }, null, 1))
  } else {
    console.error("CONTROL DID NOT FIRE: the dump is not the population TABLE 1 describes, or a row did not join.")
    for (const f of failures.slice(0, 25)) console.error("  " + f)
    console.error("")
    printClasses(perType)
  }
  process.exit(3)
}

function summarize(perTypeMap: typeof perType, plain: boolean): any {
  const out: any = {}
  for (const [t, e] of Object.entries(perTypeMap)) {
    out[t] = {
      unresolved: e.unresolved,
      ambiguous: e.ambiguous,
      classes: [...e.classes.values()].sort((a, b) => (b.unresolved + b.ambiguous) - (a.unresolved + a.ambiguous)),
    }
    if (plain) out[t].classes = out[t].classes.map((c: any) => c.declaredClass)
  }
  return out
}
function printClasses(perTypeMap: typeof perType): void {
  for (const [t, e] of Object.entries(perTypeMap)) {
    console.log(`${t}: unresolved ${e.unresolved} · ambiguous ${e.ambiguous} — NAMED CLASSES`)
    for (const c of [...e.classes.values()].sort((a, b) => (b.unresolved + b.ambiguous) - (a.unresolved + a.ambiguous))) {
      console.log(`  ${c.declaredClass.padEnd(42)} unres ${String(c.unresolved).padStart(7)} · amb ${String(c.ambiguous).padStart(7)}`)
      for (const s of c.samples.slice(0, 3)) console.log(`      e.g. ${s}`)
    }
    console.log()
  }
}

const classTotals = new Map<string, number>()
for (const e of Object.values(perType)) for (const c of e.classes.values()) classTotals.set(c.declaredClass, (classTotals.get(c.declaredClass) ?? 0) + c.unresolved + c.ambiguous)
const sumClasses = [...classTotals.values()].reduce((a, b) => a + b, 0)
const classified = rows.length
const closureOk = sumClasses === classified

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-dump-classify.ts",
  dump: path.relative(ROOT, FILE),
  control: {
    ok: closureOk,
    perType: perTypeControl,
    join: { dumpedRows: rows.length, filesReanalyzed: reanalyzed, misses: joinMisses, indexOnlyDecorates },
    closure: {
      tableEdges, tableResolved, dumpedRows: classified, claimRows, bindingRows, causeRows,
      unclassifiedLabelRows, unclassifiedOutcomeRows, sumClassRows: sumClasses,
      populationIdentity: `${tableEdges} (TOTAL) == ${tableResolved} resolved + ${classified} classified + ${claimRows} claims + ${bindingRows} bindings + ${causeRows} causes`,
      classesSumToClassified: closureOk,
    },
  },
  arbitraryTwin: intentTwin,
  semantics:
    "classes are the analyzer's OWN metadata markers joined per row (calleeKind SOL-15; isVariableReference / isYulPathSegment / isMemberReference for uses; isImport for references; reasonCode/externalBase for extends/overrides), with the dump's spelling only as a named fallback. Claims/bindings/causes are their own columns and are NEVER folded into a class. W8 (function-scope binding read) is the lane's measured wall (SOL-FIX §1).",
  classTotals: Object.fromEntries([...classTotals.entries()].sort((a, b) => b[1] - a[1])),
  perType: summarize(perType, false),
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1))
} else {
  const w = (s: string | number, n: number) => String(s).padEnd(n)
  console.log(`solidity-dump-classify — ${path.relative(ROOT, FILE)}`)
  console.log(`control: PASS — table parity per type; join ${rows.length}/${rows.length} (${indexOnlyDecorates} index-only decorate fallback(s)); claims ${claimRows}, bindings ${bindingRows}, causes ${causeRows}, unclassified-label 0; index supplied on every joined edge`)
  console.log(`closure: population ${tableEdges} == resolved ${tableResolved} + classified ${classified} + claims ${claimRows} + bindings ${bindingRows} + causes ${causeRows}`)
  console.log(`classes: ${sumClasses} row(s) over ${classTotals.size} named class(es) — ${closureOk ? "equals" : "DOES NOT EQUAL"} classified ${classified}`)
  if (intentTwin !== null) console.log(`arbitraryTwin (intent table): ${intentTwin}`)
  console.log(`files re-analysed for the marker join: ${reanalyzed} · join misses: ${joinMisses}`)
  console.log(`index: REBUILT over ${indexFiles} file(s) / ${indexRepos} repo(s), supplied to every re-analysis (the arm's own configuration)`)
  console.log()
  printClasses(perType)
  console.log("CLASS TOTALS")
  console.log("-".repeat(72))
  for (const [k, v] of [...classTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 44)} ${String(v).padStart(8)}`)
}
process.exit(report.control.ok ? 0 : 3)
