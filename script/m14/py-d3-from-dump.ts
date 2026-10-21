/**
 * PY-D3-FROM-DUMP — D3 classification built on the GATE'S OWN per-edge verdicts.
 *
 * WHY THIS REPLACES THE FIRST CLASSIFIER. `py-resolution-classify.ts` re-implemented the gate's
 * per-edge loop around `classifyEdge` and therefore did NOT reproduce the gate's outcome model:
 * the GATE applies the owner-channel verdict (and the claim/outcome routing that goes with it)
 * inside `incoming-gate.ts`, not inside `classifyEdge`. Measured at HEAD before this instrument:
 * classifier resolved 443,833 vs gate 498,311 (−54,478), ambiguity 549,666 vs 462,840 (+86,826),
 * unresolved 182,456 vs 214,804 (−32,348) — while extOK/ext? agreed exactly. The cause shares it
 * reported are therefore NOT reproducible at HEAD, and D3 cannot rest on them.
 *
 * THE RULE THIS INSTRUMENT FOLLOWS: an edge's OUTCOME is never recomputed here — it is READ from
 * the gate's `--dump` (one TSV row per NON-RESOLVED edge: label · outcome · target · srcFile:line ·
 * claimKind). Only the CAUSE ATTRIBUTION is computed, by joining each dumped row to the analyzer's
 * own emitted edge (same file/line/label/target) and reading `metadata.reasonCode` / claim keys.
 * The join is a MULTISET match and its misses are reported and must be ZERO.
 *
 * HARD CONTROLS (exit 3 on any drift — a control that cannot fail proves nothing):
 *   A. per label: dump count(outcome=unresolved) == TABLE 1 `unresolved`;
 *      dump count(outcome starts "amb") == TABLE 1 `amb(decl)`; dump count(externalUnverified) == `ext?`;
 *      dump count(externalRefuted) == `extFAIL`; dump count(externalVerified) == `extOK`
 *      (the gate dumps EVERY outcome that is not literally "resolved", so verified claims are rows too —
 *      total dump rows must equal edges − resolved).
 *   B. TABLE 1 closure per label: resolved+amb+unresolved+extOK+ext?+extFAIL == edges; and the
 *      column sums equal the printed TOTAL row.
 *   C. every dumped row receives exactly one cause; unclassified == 0; join misses == 0;
 *      claim-unverifiable rows per label == TABLE 1 `ext?` (buckets equal the gate's claim column).
 *
 * Usage: bun run script/m14/py-d3-from-dump.ts --gate-log .tmp-py/cap0-noindex-dump.log [--out x.json]
 * Exit: 0 = controls pass and closure holds; 3 = instrument drift (a control failed).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const LOG = argOf("--gate-log")
const OUT = argOf("--out")
if (!LOG) {
  console.error("usage: bun run script/m14/py-d3-from-dump.ts --gate-log <gate log with --dump> [--out json]")
  process.exit(2)
}
const raw = readFileSync(LOG, "utf8")
// THE NUL IS NOT STRIPPED. It is `BINDING_SEP` — the family's separator for a local-binding
// target (`<caller>\u0000<binding>`) — and it is the ONLY thing that makes a binding target
// distinguishable from a bare name. The first version of this instrument stripped the NUL
// (copied from the no-index arm, where no binding row existed), which silently collapsed
// `main\u0000model` into `mainmodel`: on the PRODUCTION population (13,217 binding rows) the
// target no longer joined the analyzer's edge, and the join would have reported misses on rows
// that are perfectly joinable. The NUL is kept, and the join key uses it.
const text = raw

// ── TABLE 1 ─────────────────────────────────────────────────────────────────────────────────
// THE PRODUCTION TABLE 1 HAS FIFTEEN COLUMNS, not ten: `edges resolved collRes amb(decl)
// amb(kind) unresolved extOK ext? extFAIL bindOK bind? bindFAIL causeOK causeFAIL`. The ten-column
// shape is the NO-INDEX arm's. This instrument now reads BOTH, because the depth campaign's
// question is asked of the production population and a classifier that cannot read the table it
// is asked about is not a classifier.
//
// THE COLUMN COUNT IS DISCOVERED, NOT ASSUMED: the first matching label line decides the shape
// for the whole table, and a line with a different column count is SKIPPED rather than read
// wrongly. `tableCols` is reported in the output, so the reader knows which arm was read.
type Row = {
  edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
  unresolved: number; extOK: number; extUnv: number; extFail: number
  bindOK: number; bindUnv: number; bindFail: number; causeOK: number; causeFail: number
}
const LABELS = ["calls","uses","contains","imports","references","exports","extends","implements","overrides","instantiates","decorates","renders","mixes_in","part_of"]
const NUM15 = "(\\d+)".repeat(15)
const table = new Map<string, Row>()
const tableOrder: string[] = []
let totalRow: Row | null = null
let tableCols = 0
const parseRow = (nums: string[]): Row => ({
  edges: +nums[0]!, resolved: +nums[1]!, collRes: +nums[2]!, ambDecl: +nums[3]!, ambKind: +nums[4]!,
  unresolved: +nums[5]!, extOK: +nums[6]!, extUnv: +nums[7]!, extFail: +nums[8]!,
  bindOK: nums.length > 9 ? +nums[9]! : 0, bindUnv: nums.length > 10 ? +nums[10]! : 0,
  bindFail: nums.length > 11 ? +nums[11]! : 0, causeOK: nums.length > 12 ? +nums[12]! : 0,
  causeFail: nums.length > 13 ? +nums[13]! : 0,
})
for (const line of text.split("\n")) {
  const m = line.match(new RegExp(`^(${LABELS.join("|")})\\s+${NUM15}\\s*$`))
  if (!m) continue
  const label = m[1]!
  const nums = m.slice(2) as string[]
  if (tableCols === 0) tableCols = nums.length
  if (nums.length !== tableCols) continue
  if (!table.has(label)) tableOrder.push(label)
  table.set(label, parseRow(nums))
}
for (const line of text.split("\n")) {
  const m = line.match(new RegExp(`^TOTAL\\s+${NUM15}\\s*$`))
  if (!m) continue
  const nums = m.slice(1) as string[]
  if (tableCols === 0) tableCols = nums.length
  if (nums.length !== tableCols) continue
  totalRow = parseRow(nums)
  break
}
if (table.size === 0 || totalRow === null) {
  console.error("CONTROL FAILED: TABLE 1 (or its TOTAL row) not found in the gate log — this must be a --dump run of the gate")
  process.exit(3)
}

// ── DUMP ROWS ───────────────────────────────────────────────────────────────────────────────
type DumpRow = { label: string; outcome: string; target: string; file: string; line: number; claim: string }
const rows: DumpRow[] = []
for (const line of text.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const parts = line.split("\t")
  if (parts.length < 6) continue
  const spec = parts[4] ?? ""
  const colon = spec.lastIndexOf(":")
  const file = colon > 0 ? spec.slice(0, colon) : spec
  const lineNo = colon > 0 ? Number(spec.slice(colon + 1)) : 0
  rows.push({ label: parts[1]!, outcome: parts[2]!, target: parts[3]!, file, line: Number.isFinite(lineNo) ? lineNo : 0, claim: parts[5] ?? "-" })
}

// ── CONTROL A/B ─────────────────────────────────────────────────────────────────────────────
const problems: string[] = []
const perLabelDump = new Map<string, { amb: number; unres: number; extUnv: number; extFail: number; extOk: number; bindOk: number; bindUnv: number; bindFail: number; causeOk: number; causeFail: number }>()
for (const r of rows) {
  let d = perLabelDump.get(r.label)
  if (!d) { d = { amb: 0, unres: 0, extUnv: 0, extFail: 0, extOk: 0, bindOk: 0, bindUnv: 0, bindFail: 0, causeOk: 0, causeFail: 0 }; perLabelDump.set(r.label, d) }
  if (r.outcome === "unresolved") d.unres++
  else if (r.outcome.startsWith("amb")) d.amb++
  else if (r.outcome === "externalUnverified") d.extUnv++
  else if (r.outcome === "externalRefuted") d.extFail++
  else if (r.outcome === "externalVerified") d.extOk++
  else if (r.outcome === "bindingVerified") d.bindOk++
  else if (r.outcome === "bindingUnverified") d.bindUnv++
  else if (r.outcome === "bindingRefuted") d.bindFail++
  else if (r.outcome === "causeDeclared") d.causeOk++
  else if (r.outcome === "causeRefuted") d.causeFail++
  else problems.push(`unknown outcome "${r.outcome}" on ${r.label} ${r.file}:${r.line}`)
}
for (const [label, row] of table) {
  const d = perLabelDump.get(label) ?? { amb: 0, unres: 0, extUnv: 0, extFail: 0, extOk: 0, bindOk: 0, bindUnv: 0, bindFail: 0, causeOk: 0, causeFail: 0 }
  if (d.amb !== row.ambDecl) problems.push(`CONTROL A: ${label} dump amb=${d.amb} != TABLE amb=${row.ambDecl}`)
  if (d.unres !== row.unresolved) problems.push(`CONTROL A: ${label} dump unresolved=${d.unres} != TABLE unresolved=${row.unresolved}`)
  if (d.extUnv !== row.extUnv) problems.push(`CONTROL A: ${label} dump ext?=${d.extUnv} != TABLE ext?=${row.extUnv}`)
  if (d.extFail !== row.extFail) problems.push(`CONTROL A: ${label} dump extFAIL=${d.extFail} != TABLE extFAIL=${row.extFail}`)
  if (d.extOk !== row.extOK) problems.push(`CONTROL A: ${label} dump externalVerified=${d.extOk} != TABLE extOK=${row.extOK}`)
  if (d.bindOk !== row.bindOK) problems.push(`CONTROL A: ${label} dump bindingVerified=${d.bindOk} != TABLE bindOK=${row.bindOK}`)
  if (d.bindUnv !== row.bindUnv) problems.push(`CONTROL A: ${label} dump bindingUnverified=${d.bindUnv} != TABLE bind?=${row.bindUnv}`)
  if (d.bindFail !== row.bindFail) problems.push(`CONTROL A: ${label} dump bindingRefuted=${d.bindFail} != TABLE bindFAIL=${row.bindFail}`)
  if (d.causeOk !== row.causeOK) problems.push(`CONTROL A: ${label} dump causeDeclared=${d.causeOk} != TABLE causeOK=${row.causeOK}`)
  if (d.causeFail !== row.causeFail) problems.push(`CONTROL A: ${label} dump causeRefuted=${d.causeFail} != TABLE causeFAIL=${row.causeFail}`)
  // THE CLOSURE NOW SPANS EVERY COLUMN THE GATE PRINTS, so a row in a column the classifier
  // does not understand cannot hide in the difference between the two sums.
  const sum = row.resolved + row.ambDecl + row.unresolved + row.extOK + row.extUnv + row.extFail
    + row.bindOK + row.bindUnv + row.bindFail + row.causeOK + row.causeFail
  if (sum !== row.edges) problems.push(`CONTROL B: ${label} closure ${sum} != edges ${row.edges}`)
}
const colSum = (k: keyof Row) => [...table.values()].reduce((a, r) => a + (r[k] as number), 0)
for (const k of ["edges","resolved","collRes","ambDecl","ambKind","unresolved","extOK","extUnv","extFail","bindOK","bindUnv","bindFail","causeOK","causeFail"] as const) {
  if (colSum(k) !== (totalRow[k] as number)) problems.push(`CONTROL B: column ${k} sum ${colSum(k)} != TOTAL ${totalRow[k]}`)
}
if (problems.length > 0) {
  console.error("CONTROL FAILED (exit 3) — the dump and the TABLE are not the same run/scope:")
  for (const p of problems.slice(0, 25)) console.error("  " + p)
  process.exit(3)
}

// ── CAUSE ATTRIBUTION: join dump rows to the analyzer's own edges (metadata only) ──────────
const BUILTINS: Set<string> = (() => {
  try {
    const out = execFileSync("python3", ["-c", "import builtins, json; print(json.dumps(sorted(dir(builtins))))"], { encoding: "utf8", timeout: 10_000 })
    return new Set<string>(JSON.parse(out))
  } catch { return new Set<string>() }
})()
const DYNAMIC = new Set(["dispatch-on-receiver", "dispatch-on-parameter", "member-read", "first-parent-guess"])
type Meta = Record<string, any>
const wanted = new Map<string, number>() // file -> count of dump rows
for (const r of rows) wanted.set(r.file, (wanted.get(r.file) ?? 0) + 1)
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
// ONE POOL ROOT FOR THE JOIN, deliberately: the join needs the analyzer's METADATA (reasonCode,
// module, claim keys) per emitted edge, which is a per-file fact — it does NOT need production's
// resolution scope (the outcomes come from the dump, never from this parse). Passing each file's
// repo spawns and disposes a worker pool per repository (~40-60 s each at fleet load), which made
// the first run's join dominate the wall time. A single root keeps one pool alive for the walk.
const POOL_ROOT = CR
/** Multiset of analyzer edges per dump join key, built only for files that have dumped rows. */
const edgePool = new Map<string, Meta[]>()
const key = (label: string, file: string, line: number, target: string) => `${label}\u0000${file}\u0000${line}\u0000${target}`
let parsed = 0
let parseFailed = 0
// THE JOIN PARSES DIRECTLY, IN PROCESS, with ONE parser and the production analyzer — the same
// analyzer the gate runs, so the metadata is the same; the pool is not needed because nothing here
// is resolved or scoped (outcomes come from the dump). A pool call per file spawned a worker pool
// per repository (~40-60 s each) and dominated wall time for no information.
const parser = await ASTEngine.getParser("python")
const analyzer = new RealPythonAnalyzer()
for (const file of wanted.keys()) {
  let r: any
  try {
    const content = readFileSync(file, "utf8")
    const tree = (parser as any).parse(content)
    if (!tree) { parseFailed++; continue }
    r = analyzer.analyze(tree.rootNode, content, file)
    parsed++
  } catch { parseFailed++; continue }
  if (!r) { parseFailed++; continue }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!table.has(label)) continue
    const line = Number(rel?.line_number ?? 0)
    const k = key(label, file, line, String(rel?.target ?? ""))
    const arr = edgePool.get(k) ?? (edgePool.set(k, []) ? edgePool.get(k)! : [])
    arr.push((rel?.metadata ?? {}) as Meta)
  }
}

const baseName = (p: string): string => p.split("/").pop() ?? p
const moduleOf = (target: string, md: Meta): string => {
  const colon = target.lastIndexOf(":")
  if (typeof md.module === "string" && md.module.length > 0) return md.module
  if (colon > 0) return target.slice(0, colon)
  return target.endsWith(":*") ? target.slice(0, -2) : target
}
const claimClass = (kind: string, outcome: string): string => {
  if (outcome === "externalVerified") return `claim-verified:${kind}`
  if (outcome === "externalUnverified") return `claim-unverifiable:${kind}`
  if (outcome.startsWith("amb")) return `claim-reported-ambiguous:${kind}`
  if (outcome === "externalRefuted") return `claim-REFUTED:${kind}`
  // THE BINDING AND CAUSE FAMILIES ARE NOT EXTERNAL CLAIMS. A verified binding is a claim the
  // arbiter checked against the SPELLING, and it lives in the gate's own bindOK column; a
  // declared cause is a statement of WHY a row could not reach its base, in the causeOK column.
  // Counting either in the external-claim buckets would make the claim columns read as if the
  // lane had published external claims it did not, so they get their own buckets and their own
  // closure lines. This is the SAME discipline the lane's other claim families already follow
  // (the `owner` claim's ambiguity disposition is reported, never charged).
  if (outcome === "bindingVerified") return `binding-verified:${kind}`
  if (outcome === "bindingUnverified") return `binding-unverifiable:${kind}`
  if (outcome === "bindingRefuted") return `binding-REFUTED:${kind}`
  if (outcome === "causeDeclared") return `cause-declared:${kind}`
  if (outcome === "causeRefuted") return `cause-REFUTED:${kind}`
  return `claim:${kind}:${outcome}`
}
const causeOf = (row: DumpRow, md: Meta): string => {
  // THE DUMP'S claimKind IS THE GATE'S OWN READING and is authoritative. A join can land on a
  // RESOLVED sibling with the same (label,line,target) that carries claim metadata the gate did
  // not read (claims are read only where the target names nothing), so the metadata claim keys are
  // NOT consulted here — that inversion would turn a claimless refusal into a claim class.
  if (row.claim !== "-") return claimClass(row.claim, row.outcome)
  const rc = String(md?.reasonCode ?? "")
  if (row.label === "imports") {
    const mod = moduleOf(row.target, md)
    if (mod.startsWith(".")) return "imports-relative"
    return "imports-module-item"
  }
  if (row.label === "exports") return "declared:export-residual"
  if (row.label === "decorates") {
    // The extFAIL fix (3072d4061) made DOTTED decorator targets CLAIMLESS BY DESIGN: the target is
    // a written chain and the arbiter reads its owner as the MODULE ROOT, which any same-named
    // project symbol refutes. So the claimless decorates rows are a NAMED class, not an absence:
    // `claimless-dotted` is the retired-claim cost, `claimless-bare` is a bare name the project
    // does not answer and no import binds.
    if (row.outcome.startsWith("amb")) return "decorates:claimless-ambiguous"
    return row.target.includes(".") ? "decorates:claimless-dotted" : "decorates:claimless-bare"
  }
  if (row.label === "contains") return `contains:${rc || "none"}`
  if (row.label === "extends") return rc ? `extends:${rc}` : "extends:third-party-base"
  if (row.label === "implements") return rc ? `implements:${rc}` : "implements:proof-refused"
  if (DYNAMIC.has(rc)) return `dynamic:${rc}`
  if (rc === "local-callee") return "local-callee-or-binding"
  if (rc === "annotation-type" || rc === "return-annotation" || rc === "instanceof-check" || rc === "local-binding-target" || rc === "inline-type-parameter" || rc === "virtual-registration" || rc === "stdlib-interface-marker") return `other:${rc}`
  if (rc === "external-member-call") return "refused-guard-route"
  const leaf = row.target.includes(":") ? row.target.slice(row.target.lastIndexOf(":") + 1) : row.target.slice(row.target.lastIndexOf(".") + 1)
  if (BUILTINS.has(leaf)) return "builtin-leaf"
  if (rc === "bare-name-callee") return "bare-name-callee"
  if (row.target.includes(":")) return "target:module-item"
  return rc ? `other:${rc}` : "unclassified:no-reason"
}

let joinMiss = 0
let unclassified = 0
type ClassTally = { count: number; samples: string[] }
const classes = new Map<string, ClassTally>() // `${label}|${cause}` -> tally
const perLabelRefused = new Map<string, number>()
for (const row of rows) {
  perLabelRefused.set(row.label, (perLabelRefused.get(row.label) ?? 0) + 1)
  const k = key(row.label, row.file, row.line, row.target)
  const pool = edgePool.get(k)
  let md: Meta = {}
  if (pool && pool.length > 0) md = pool.shift()!
  else joinMiss++
  let cause = causeOf(row, md)
  if (cause.startsWith("unclassified")) unclassified++
  const ck = `${row.label}|${cause}`
  const t = classes.get(ck) ?? { count: 0, samples: [] }
  t.count++
  if (t.samples.length < 3) t.samples.push(`${path.relative(CR, row.file)}:${row.line} ${row.outcome} ${row.target}`)
  classes.set(ck, t)
}
const unverifiableByLabel = new Map<string, number>()
for (const [ck] of classes) {
  const [label, cause] = ck.split("|") as [string, string]
  if (cause.startsWith("claim-unverifiable")) {
    const t = classes.get(ck)!
    unverifiableByLabel.set(label, (unverifiableByLabel.get(label) ?? 0) + t.count)
  }
}

// ── CONTROL C ─────────────────────────────────────────────────────────────────────────────
const cProblems: string[] = []
const refusedTotal = rows.length
const tableRefused = colSum("ambDecl") + colSum("unresolved") + colSum("extUnv") + colSum("extFail") + colSum("extOK")
  + colSum("bindOK") + colSum("bindUnv") + colSum("bindFail") + colSum("causeOK") + colSum("causeFail")
if (refusedTotal !== tableRefused) cProblems.push(`CONTROL C: dump rows ${refusedTotal} != amb+unresolved+ext?+extFAIL+extOK ${tableRefused}`)
if (refusedTotal !== totalRow.edges - totalRow.resolved) cProblems.push(`CONTROL C: dump rows ${refusedTotal} != edges-resolved ${totalRow.edges - totalRow.resolved}`)
// THE BINDING AND CAUSE COLUMNS ARE DUMPED ROWS TOO, so they are part of the refusal total and
// they are part of the claim bookkeeping. A binding row is NOT an external claim, so it must not
// be counted in the external claim buckets; it gets its own bucket and its own closure line.
const bindingRows = colSum("bindOK") + colSum("bindUnv") + colSum("bindFail")
const causeRows = colSum("causeOK") + colSum("causeFail")
const externalClaimRows = colSum("extOK") + colSum("extUnv") + colSum("extFail")
if (joinMiss !== 0) cProblems.push(`CONTROL C: ${joinMiss} dumped row(s) found NO analyzer edge (join miss — outcomes cannot be attributed)`)
if (unclassified !== 0) cProblems.push(`CONTROL C: ${unclassified} row(s) received no named cause`)
const classSum = [...classes.values()].reduce((a, t) => a + t.count, 0)
if (classSum !== rows.length) cProblems.push(`CONTROL C: cause rows ${classSum} != dump rows ${rows.length}`)
for (const [label, row] of table) {
  const u = unverifiableByLabel.get(label) ?? 0
  if (u !== row.extUnv) cProblems.push(`CONTROL C: ${label} claim-unverifiable rows ${u} != TABLE ext? ${row.extUnv}`)
}
// ── THE LEAD-SPECIFIED CLOSURE IDENTITY ─────────────────────────────────────────────────────
// population == TOTAL - resolved ; sum(label rows) == TOTAL ; claim buckets equal the gate's
// claim columns ; non-claim rows == amb(decl) + unresolved ; join/unclassified 0 or counted.
const bucket = { verified: 0, unverified: 0, refuted: 0, reported: 0, nonClaim: 0, reportedAmb: 0,
  bindVerified: 0, bindUnverified: 0, bindRefuted: 0, causeDeclared: 0, causeRefuted: 0 }
for (const [ck, t] of classes) {
  const [, cause] = ck.split("|") as [string, string]
  if (cause.startsWith("claim-verified")) bucket.verified += t.count
  else if (cause.startsWith("claim-unverifiable")) bucket.unverified += t.count
  else if (cause.startsWith("claim-REFUTED")) bucket.refuted += t.count
  else if (cause.startsWith("binding-verified")) bucket.bindVerified += t.count
  else if (cause.startsWith("binding-unverifiable")) bucket.bindUnverified += t.count
  else if (cause.startsWith("binding-REFUTED")) bucket.bindRefuted += t.count
  else if (cause.startsWith("cause-declared")) bucket.causeDeclared += t.count
  else if (cause.startsWith("cause-REFUTED")) bucket.causeRefuted += t.count
  else if (cause.startsWith("claim-reported-ambiguous")) bucket.reported += t.count
  else if (cause.startsWith("claim-reported")) bucket.reported += t.count
  else bucket.nonClaim += t.count
}
const totalExtOK = colSum("extOK")
const totalExtUnv = colSum("extUnv")
const totalExtFail = colSum("extFail")
if (bucket.verified !== totalExtOK) cProblems.push(`CLOSURE: claim-verified rows ${bucket.verified} != TOTAL extOK ${totalExtOK}`)
if (bucket.unverified !== totalExtUnv) cProblems.push(`CLOSURE: claim-unverifiable rows ${bucket.unverified} != TOTAL ext? ${totalExtUnv}`)
if (bucket.refuted !== totalExtFail) cProblems.push(`CLOSURE: claim-REFUTED rows ${bucket.refuted} != TOTAL extFAIL ${totalExtFail}`)
const claimRows = bucket.verified + bucket.unverified + bucket.refuted
const reportedRows = bucket.reported
// EVERY dumped row is either claim-carrying (claimKind != "-") or not. Claim-carrying rows are
// the gate's own claim columns PLUS the reported-on-ambiguous class (the arbiter does not charge a
// claim on an ambiguous row, but the row still carries one); non-claim rows are therefore
// amb(decl)+unresolved MINUS that reported class.
const ambPlusUnres = colSum("ambDecl") + colSum("unresolved")
// THE THREE DISJOINT CLASSES OF A DUMPED ROW, and they must sum to the dump EXACTLY:
//   CHARGED CLAIMS        claimRows = verified + unverified + refuted     (the gate's extOK/ext?/extFAIL)
//   REPORTED-ON-AMBIGUOUS reportedRows                                     (a claim on an amb row, never charged)
//   NON-CLAIM             bucket.nonClaim = amb(decl)+unresolved − reportedRows
// The first version compared claimRows against extOK+ext?+extFAIL+reported (mixing class 1 with class 2)
// and omitted `reported` from the total, so it printed a FAIL for a population that closes exactly.
// Measured on the arm: 156,075 + 72,411 + 605,233 = 833,719 = dump rows. The check is fixed HERE rather
// than the numbers being massaged.
const expectedClaimRows = totalExtOK + totalExtUnv + totalExtFail
if (claimRows !== expectedClaimRows) cProblems.push(`CLOSURE: charged-claim rows ${claimRows} != extOK+ext?+extFAIL ${expectedClaimRows}`)
// THE BINDING AND CAUSE ROWS ARE DISJOINT FROM THE EXTERNAL CLAIM ROWS, so the grand total is
// four classes, not three, and the identity is checked over all four.
const bindingClaimRows = bucket.bindVerified + bucket.bindUnverified + bucket.bindRefuted
const causeClaimRows = bucket.causeDeclared + bucket.causeRefuted
if (bindingClaimRows !== bindingRows) cProblems.push(`CLOSURE: binding rows ${bindingClaimRows} != bindOK+bind?+bindFAIL ${bindingRows}`)
if (causeClaimRows !== causeRows) cProblems.push(`CLOSURE: cause rows ${causeClaimRows} != causeOK+causeFAIL ${causeRows}`)
if (claimRows + bindingClaimRows + causeClaimRows + reportedRows + bucket.nonClaim !== rows.length) {
  cProblems.push(`CLOSURE: charged claims ${claimRows} + binding ${bindingClaimRows} + cause ${causeClaimRows} + reported-on-ambiguous ${reportedRows} + non-claim ${bucket.nonClaim} != dumped rows ${rows.length}`)
}

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`py-d3-from-dump — outcomes READ FROM THE GATE'S OWN --dump, causes JOINED to analyzer metadata`)
console.log(`gate log: ${LOG}`)
console.log(`TABLE 1 column count read: ${tableCols} (10 = the no-index arm's shape · 15 = the production arm's shape)`)
console.log(`population (TABLE 1 TOTAL): ${totalRow.edges} edges · resolved ${totalRow.resolved} · collRes ${totalRow.collRes} · amb(decl) ${totalRow.ambDecl} · unresolved ${totalRow.unresolved} · extOK ${totalRow.extOK} · ext? ${totalRow.extUnv} · extFAIL ${totalRow.extFail}`)
console.log(`dump rows: ${rows.length} (non-resolved) · files parsed for the join: ${parsed} · parse failures: ${parseFailed}`)
console.log(`\nTABLE 1 CLOSURE — per label: resolved+amb+unresolved+extOK+ext?+extFAIL == edges`)
console.log(`${w("type", 12)}${w("edges", 10)}${w("closed", 8)}${w("resolved", 10)}${w("amb", 10)}${w("unres", 10)}${w("extOK", 9)}${w("ext?", 8)}${w("extFAIL", 8)}${w("refused", 9)}`)
for (const label of tableOrder) {
  const r = table.get(label)!
  const sum = r.resolved + r.ambDecl + r.unresolved + r.extOK + r.extUnv + r.extFail
  console.log(`${w(label, 12)}${w(r.edges, 10)}${w(sum === r.edges ? "yes" : "NO", 8)}${w(r.resolved, 10)}${w(r.ambDecl, 10)}${w(r.unresolved, 10)}${w(r.extOK, 9)}${w(r.extUnv, 8)}${w(r.extFail, 8)}${w(perLabelRefused.get(label) ?? 0, 9)}`)
}
{
  const totalClosed = totalRow.resolved + totalRow.ambDecl + totalRow.unresolved + totalRow.extOK + totalRow.extUnv + totalRow.extFail === totalRow.edges
  console.log(`${w("TOTAL", 12)}${w(totalRow.edges, 10)}${w(totalClosed ? "yes" : "NO", 8)}${w(totalRow.resolved,10)}${w(totalRow.ambDecl,10)}${w(totalRow.unresolved,10)}${w(totalRow.extOK,9)}${w(totalRow.extUnv,8)}${w(totalRow.extFail,8)}${w(refusedTotal,9)}`)
}

console.log(`\nCAUSES OF THE ${refusedTotal} REFUSED ROWS (by label, then count) — every row one named class`)
const byLabel = new Map<string, Array<[string, ClassTally]>>()
for (const [ck, t] of classes) {
  const [label, cause] = ck.split("|") as [string, string]
  const arr = byLabel.get(label) ?? (byLabel.set(label, []) ? byLabel.get(label)! : [])
  arr.push([cause, t])
}
for (const label of tableOrder) {
  const arr = byLabel.get(label)
  if (!arr) continue
  arr.sort((a, b) => b[1].count - a[1].count)
  const total = arr.reduce((a, [, t]) => a + t.count, 0)
  console.log(`\n-- ${label}: ${total} refused`)
  for (const [cause, t] of arr) console.log(`   ${w(cause, 42)}${w(t.count, 8)}${((t.count / total) * 100).toFixed(1)}%`)
}

console.log(`\nCLOSURE IDENTITY (Lead-specified)`)
console.log(`  population (TABLE 1 TOTAL)                          ${totalRow.edges}`)
console.log(`  dump rows = population - resolved                   ${rows.length} == ${totalRow.edges - totalRow.resolved} ${rows.length === totalRow.edges - totalRow.resolved ? "OK" : "MISMATCH"}`)
console.log(`  sum(label rows) == population                       ${colSum("edges")} == ${totalRow.edges} ${colSum("edges") === totalRow.edges ? "OK" : "MISMATCH"}`)
console.log(`  CLAIM-externalVerified == extOK                     ${bucket.verified} == ${totalExtOK}`)
console.log(`  CLAIM-externalUnverified == ext?                    ${bucket.unverified} == ${totalExtUnv}`)
console.log(`  CLAIM-externalRefuted == extFAIL                    ${bucket.refuted} == ${totalExtFail}`)
console.log(`  CLAIM-reported-on-ambiguous rows (reported, not charged)  ${reportedRows}`)
console.log(`  charged claims == extOK + ext? + extFAIL            ${claimRows} == ${totalExtOK + totalExtUnv + totalExtFail}`)
console.log(`  non-claim rows == amb(decl)+unresolved-reported      ${bucket.nonClaim} == ${colSum("ambDecl") + colSum("unresolved") - reportedRows}`)
console.log(`  BINDING rows (own column, never an external claim)  ${bindingClaimRows} == bindOK+bind?+bindFAIL ${bindingRows}`)
console.log(`  CAUSE rows   (own column, never an external claim)  ${causeClaimRows} == causeOK+causeFAIL ${causeRows}`)
console.log(`  charged claims + reported-on-ambiguous + non-claim == dump rows  ${claimRows} + ${reportedRows} + ${bucket.nonClaim} == ${rows.length}`)
console.log(`  join misses / unclassified (must be 0)              ${joinMiss} / ${unclassified}`)

console.log(`\nCONTROLS`)
console.log(`  A (per-label dump-vs-TABLE: amb · unresolved · ext? · extFAIL · verified=0)   PASS`)
console.log(`  B (per-label closure and column sums vs TOTAL row)                            PASS`)
console.log(`  C (refused rows == amb+unresolved+ext?+extFAIL; join misses=0; unclassified=0; claim-unverifiable == ext?)  ${cProblems.length === 0 ? "PASS" : "FAIL"}`)
for (const p of cProblems.slice(0, 20)) console.log(`      ${p}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    gateLog: LOG,
    population: totalRow,
    tableCols,
    dumpRows: rows.length,
    parsed, parseFailed,
    perLabel: Object.fromEntries(tableOrder.map((l) => [l, { table: table.get(l), refused: perLabelRefused.get(l) ?? 0 }])),
    classes: Object.fromEntries([...classes.entries()].map(([k, t]) => [k, { count: t.count, samples: t.samples }])),
    controls: { a: true, b: true, c: cProblems.length === 0, cProblems },
    joinMiss, unclassified,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
if (cProblems.length > 0) process.exit(3)
console.log(`\nD3 CLOSURE HOLDS at the gate's own outcomes: ${refusedTotal} refused rows = ${closumSafe()} with every row in one named class.`)
function closumSafe(): string {
  return `amb ${colSum("ambDecl")} + unresolved ${colSum("unresolved")} + ext? ${colSum("extUnv")} + extFAIL ${colSum("extFail")}`
}
