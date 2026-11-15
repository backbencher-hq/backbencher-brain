/**
 * perl LANE — THE WALL CENSUS.  (lane-owned instrument)
 *
 * WHAT IT READS: the lane's own committed arm log — the whole-population `--dump` of
 * `script/m14/incoming-gate.ts perl pl,pm,t,pod,perl 0 --dump` on the FARM root
 * (`BB_CORPUS_ROOT=$PWD/.corpus`).  It reads NOTHING else, so it is reproducible by
 * anyone who has the log, and it cannot disagree with the arm without the disagreement
 * being visible.
 *
 * WHY A SEPARATE INSTRUMENT AND NOT A HAND COUNT: the fleet's rule is that a wall is a
 * COUNTED class, and a hand count is not a count.  This file prints the classes, their
 * counts, and the SUM, and the sum is asserted against the arm's own TABLE 1 numbers,
 * so a class that loses a row is a failure of this instrument, not a quiet drift.
 *
 * THE CONTROLS IT RUNS (a census that cannot fail is a census that proves nothing):
 *
 *   C1  THE DUMP IS THE WHOLE NON-RESOLVED SET.  The arm's TABLE 1 says how many edges
 *       are not resolved (amb + unresolved + causeOK).  The dump's row count must equal
 *       it EXACTLY, and the log must carry NO `DUMP\tBOUND\tREACHED` marker (a truncated
 *       dump is a PREFIX, never a sample — the javascript lane measured the class-share
 *       bias of a prefix at 3.7x).
 *   C2  EVERY PER-TYPE COUNT RECONCILES.  For each type, the dump's rows by outcome must
 *       equal the arm's TABLE 1 columns (amb(decl) = ambDeclOnly + ambBoth, amb(kind) =
 *       ambBoth, unresolved, causeOK), and the closure
 *       `resolved + amb + unresolved + causeOK == edges` must hold.
 *   C3  THE CLASS COUNTS SUM TO THE WALL.  Every wall class is printed with its count and
 *       the classes of one wall sum to that wall's size exactly.
 *
 * THE SHAPE VOCABULARY, and why it is a shape and not a meaning: a perl target is
 * spelled by the analyzer as either a BARE leaf (`plan`, `croak`, `md5_hex`, `Base`) or a
 * DOTTED `owner.member` (`Controller.index`, `Spec.catdir`, `EventEmitter.constructor`).
 * The shape is read from the target STRING — never from source text, and never with a
 * regex (this lane's contract forbids regex literals in the ANALYZER; this instrument is
 * outside the analyzer, but it uses the same character-class discipline so the two
 * agree on what an identifier is).
 */

import { readFileSync } from "node:fs"

const LOG = process.argv[2] ?? "validation/m14/fixtures/perl/arm-whole-2026-10-20.log"

// ── TABLE 1, READ OUT OF THE LOG THIS INSTRUMENT IS GIVEN ─────────────────────
//
// THE HAND-TRANSCRIBED CONSTANT WAS REMOVED, AND THE CONTROL IS WHY.  This table used to be
// transcribed by hand, and when the arm changed (the lane's cause-channel fix, 2026-10-20) the
// transcription went stale: the census read the NEW dump against the OLD table and C2/C3 FIRED
// with nine failures — which is the control working exactly as it is meant to, and the only
// reason the drift was caught before a number was quoted.
//
// A transcribed constant is a SECOND INSTRUMENT that has to be re-made by hand every time the
// first one moves, and the only thing that catches the drift is a control that fails.  So the
// table is now READ from the log, which makes the dump and the table the SAME MEASUREMENT, and
// C2 asks the question it was named for: does the dump reconcile to the table, row for row and
// column for column, with the closure exact?
//
// THE INDEPENDENT CHECK IS NOT LOST, IT MOVED.  The lane's other instrument,
// `production-view.mts`, imports the ARBITER's own `classifyEdge` and REBUILDS the table from
// the dump — so "the table and the dump agree" is still checked against something that did not
// come from the gate's printing of itself.  Two instruments, one gate, and the pair disagreeing
// is what a reader needs to be able to see.
const TABLE1_COLUMNS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL",
] as const

type TableRow = Record<(typeof TABLE1_COLUMNS)[number], number>
const raw = readFileSync(LOG, "utf8")
const ARM_ROWS: Record<string, TableRow> = {}
let ARM_TOTAL: TableRow | null = null
{
  // A TABLE 1 row is a type name and EXACTLY fourteen numbers, in the gate's own column order.
  // The log's SECOND per-type table has five numbers, so it cannot match this shape — the
  // parser cannot pick up the wrong table by accident.
  const rowRe = /^([A-Za-z][a-zA-Z_]*)\s+((?:\d+\s+){13}\d+)\s*$/
  for (const line of raw.split("\n")) {
    const m = rowRe.exec(line)
    if (!m) continue
    const cols = m[2].trim().split(/\s+/).map(Number)
    const row = {} as TableRow
    TABLE1_COLUMNS.forEach((c, i) => { row[c] = cols[i] })
    if (m[1] === "TOTAL") ARM_TOTAL = row
    else ARM_ROWS[m[1]] = row
  }
  if (!ARM_TOTAL) {
    console.error(`NO TABLE 1 TOTAL row in ${LOG} — the census cannot reconcile a dump against a table it did not find.`)
    process.exit(1)
  }
  // THE GATE'S OWN CLOSURE, IN ITS OWN TERMS: `resolved + amb(decl) + unresolved +
  // bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = the edge
  // count, exactly`.  `ambKind` is a SUBSET of `ambDecl` and `collRes` is a SUBSET of
  // `resolved` — the gate says so in the table's own legend — so NEITHER may be added.
  const closure = TABLE1_COLUMNS.filter(c => c !== "edges" && c !== "ambKind" && c !== "collRes")
    .reduce((a, c) => a + ARM_TOTAL![c], 0)
  if (closure !== ARM_TOTAL.edges) {
    console.error(`TABLE 1's own closure is broken in ${LOG}: ${closure} != ${ARM_TOTAL.edges} edges.`)
    process.exit(1)
  }
  console.log(`TABLE 1 read from ${LOG}: ${Object.keys(ARM_ROWS).length} type(s), ${ARM_TOTAL.edges} edges, closure exact.`)
}

// THE COLUMN-FIRST VIEW THE REST OF THIS INSTRUMENT USES (`ARM.ambDecl[type]`), transposed from
// the parsed rows so the instrument's own body reads as it always did.
const ARM: Record<string, Record<string, number>> = {}
for (const c of TABLE1_COLUMNS) ARM[c] = {}
for (const [t, row] of Object.entries(ARM_ROWS)) for (const c of TABLE1_COLUMNS) ARM[c][t] = row[c]

type Row = { label: string; outcome: string; target: string; file: string; line: string }

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
}
function isIdentChar(c: string): boolean {
  return isIdentStart(c) || (c >= "0" && c <= "9")
}
/** The target's SHAPE, read from the string. `owner.member` is DOTTED; a bare leaf is BARE;
 *  anything else (a target that is not identifier-shaped, a target with more than one
 *  dot) is OTHER, and is counted as its own class rather than folded into BARE. */
function shapeOf(target: string): "BARE" | "DOTTED" | "OTHER" {
  const dot = target.indexOf(".")
  if (dot < 0) {
    if (target.length === 0) return "OTHER"
    for (const ch of target) if (!isIdentChar(ch)) return "OTHER"
    return isIdentStart(target[0]) ? "BARE" : "OTHER"
  }
  if (target.indexOf(".", dot + 1) >= 0) return "OTHER"
  const owner = target.slice(0, dot)
  const member = target.slice(dot + 1)
  if (owner.length === 0 || member.length === 0) return "OTHER"
  for (const ch of owner) if (!isIdentChar(ch)) return "OTHER"
  for (const ch of member) if (!isIdentChar(ch)) return "OTHER"
  if (!isIdentStart(owner[0]) || !isIdentStart(member[0])) return "OTHER"
  return "DOTTED"
}

const lines = raw.split("\n")
const rows: Row[] = []
let boundMarker = false
for (const line of lines) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f[1] === "BOUND") { boundMarker = true; continue }
  rows.push({ label: f[1], outcome: f[2], target: f[3], file: f[4], line: f[4].split(":").pop() ?? "" })
}

const failures: string[] = []
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg) }

// ── C1: the dump is the WHOLE non-resolved set ──────────────────────────────────
const types = Object.keys(ARM_ROWS) as string[]
let expectedRows = 0
for (const t of types) expectedRows += ARM.ambDecl[t] + ARM.unresolved[t] + ARM.causeOK[t] + ARM.extQ[t] + ARM.bindQ[t] + ARM.extFAIL[t] + ARM.bindFAIL[t] + ARM.causeFAIL[t]
check(!boundMarker, "C1 FAIL: the log carries a DUMP BOUND marker — the dump is a PREFIX, not the set")
check(rows.length === expectedRows, `C1 FAIL: dump has ${rows.length} rows, the arm's non-resolved set is ${expectedRows}`)

// ── C2: per-type reconciliation against TABLE 1 ────────────────────────────────
const byType = new Map<string, Map<string, number>>()
for (const r of rows) {
  let m = byType.get(r.label)
  if (!m) byType.set(r.label, (m = new Map()))
  m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1)
}
for (const t of types) {
  const m = byType.get(t) ?? new Map<string, number>()
  const ambOnly = m.get("ambDeclOnly") ?? 0
  const ambBoth = m.get("ambBoth") ?? 0
  const unres = m.get("unresolved") ?? 0
  const cause = m.get("causeDeclared") ?? 0
  check(ambOnly + ambBoth === ARM.ambDecl[t], `C2 FAIL ${t}: amb ${ambOnly}+${ambBoth} != TABLE 1 ${ARM.ambDecl[t]}`)
  check(ambBoth === ARM.ambKind[t], `C2 FAIL ${t}: amb(kind) ${ambBoth} != TABLE 1 ${ARM.ambKind[t]}`)
  check(unres === ARM.unresolved[t], `C2 FAIL ${t}: unresolved ${unres} != TABLE 1 ${ARM.unresolved[t]}`)
  check(cause === ARM.causeOK[t], `C2 FAIL ${t}: causeOK ${cause} != TABLE 1 ${ARM.causeOK[t]}`)
  const closure = ARM.resolved[t] + ARM.ambDecl[t] + ARM.unresolved[t] + ARM.causeOK[t] + ARM.extOK[t] + ARM.extQ[t] + ARM.extFAIL[t] + ARM.bindOK[t] + ARM.bindQ[t] + ARM.bindFAIL[t] + ARM.causeFAIL[t]
  check(closure === ARM.edges[t], `C2 FAIL ${t}: closure ${closure} != edges ${ARM.edges[t]}`)
}

// ── C3: the wall classes sum to the wall ───────────────────────────────────────
const wallRows = rows.filter((r) => r.outcome === "unresolved" || r.outcome === "ambDeclOnly" || r.outcome === "ambBoth")
const causeRows = rows.filter((r) => r.outcome === "causeDeclared")

// THE WALL CLASSES.  A class is (type, shape, and — where the target spells it — the
// leaf's own role).  The names are the lane's, and each is a CLAIM ABOUT WHAT THE EDGE
// IS, not about what it should become.
type Class = { name: string; label: string; shape: string; n: number }
function classOf(r: Row): string {
  const shape = shapeOf(r.target)
  if (r.label === "extends") return `extends.${shape}`
  if (r.label === "overrides") return `overrides.${shape}`
  if (r.label === "instantiates") return `instantiates.${shape}`
  if (r.label === "references") return `references.${shape}`
  if (r.label === "uses") return `uses.${shape}`
  if (r.label === "calls") {
    // THE MAGIC CONSTRUCTOR: `__PACKAGE__->new` and `Class->new` publish a bare
    // `constructor` target when the analyzer cannot name the class.  That spelling is
    // ONE target with MANY edges, so it is a class of its own.
    if (r.target === "constructor") return "calls.constructor-bare"
    return `calls.${shape}`
  }
  return `${r.label}.${shape}`
}
const wallClasses = new Map<string, number>()
for (const r of wallRows) {
  const k = classOf(r)
  wallClasses.set(k, (wallClasses.get(k) ?? 0) + 1)
}
const causeClasses = new Map<string, number>()
for (const r of causeRows) {
  const k = `${r.label}.${shapeOf(r.target)}`
  causeClasses.set(k, (causeClasses.get(k) ?? 0) + 1)
}
const wallSum = [...wallClasses.values()].reduce((a, b) => a + b, 0)
const causeSum = [...causeClasses.values()].reduce((a, b) => a + b, 0)
check(wallSum === wallRows.length, "C3 FAIL: the wall classes do not sum to the wall")
check(causeSum === causeRows.length, "C3 FAIL: the cause classes do not sum to the causes")
// THE CLAUSE-1 RESIDUAL, DERIVED FROM THE TABLE THIS INSTRUMENT JUST READ: the edges that
// neither resolve nor carry a claim are amb(decl) + unresolved.  It was a transcribed
// constant once; it is derived now, for the reason given above the table parse.
const clause1Residual = ARM_TOTAL.ambDecl + ARM_TOTAL.unresolved
check(wallRows.length === clause1Residual, `C3 FAIL: the wall is ${wallRows.length}, the arm's clause-1 residual is ${clause1Residual}`)
check(causeRows.length === ARM_TOTAL.causeOK, `C3 FAIL: the causes are ${causeRows.length}, the arm's causeOK is ${ARM_TOTAL.causeOK}`)

// ── THE TOP TARGETS PER CLASS, so a class is nameable ─────────────────────────
function topTargets(rs: Row[], n: number): string {
  const c = new Map<string, number>()
  for (const r of rs) c.set(r.target, (c.get(r.target) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(" · ")
}

console.log("perl LANE — WALL CENSUS")
console.log(`log: ${LOG}`)
console.log("")
console.log("CONTROLS")
console.log(`  C1 dump is the whole non-resolved set : ${rows.length} rows == ${expectedRows} expected · BOUND marker: ${boundMarker ? "PRESENT (FAIL)" : "absent"}`)
console.log(`  C2 per-type reconciliation             : ${failures.filter((f) => f.startsWith("C2")).length} failures`)
console.log(`  C3 wall classes sum to the wall        : ${wallSum} == ${wallRows.length} (clause-1 residual ${clause1Residual}) · cause classes ${causeSum} == ${causeRows.length} (causeOK ${ARM_TOTAL.causeOK})`)
console.log("")
console.log(`WALL 1 — CLAUSE 1: amb(decl) ${ARM_TOTAL.ambDecl} + unresolved ${ARM_TOTAL.unresolved} = ${clause1Residual} edges that neither resolve nor carry a claim`)
console.log("  class                        edges   top targets")
console.log("  ----------------------------  -----  --------------------------------------------------")
for (const [k, n] of [...wallClasses.entries()].sort((a, b) => b[1] - a[1])) {
  const rs = wallRows.filter((r) => classOf(r) === k)
  console.log(`  ${k.padEnd(28)}  ${String(n).padStart(5)}   ${topTargets(rs, 8)}`)
}
console.log(`  ${"TOTAL".padEnd(28)}  ${String(wallSum).padStart(5)}`)
console.log("")
const namedCauses = new Set(causeRows.map(r => {
  const dot = r.target.lastIndexOf(".")
  return dot > 0 ? r.target.slice(0, dot) : r.target
}))
console.log(`WALL 2 — CLAUSE 3: ${causeRows.length} edges carry a DECLARED CAUSE (baseBeyondRunScope) over ${namedCauses.size} named causes`)
console.log("  class                        edges   top targets")
console.log("  ----------------------------  -----  --------------------------------------------------")
for (const [k, n] of [...causeClasses.entries()].sort((a, b) => b[1] - a[1])) {
  const rs = causeRows.filter((r) => `${r.label}.${shapeOf(r.target)}` === k)
  console.log(`  ${k.padEnd(28)}  ${String(n).padStart(5)}   ${topTargets(rs, 8)}`)
}
console.log(`  ${"TOTAL".padEnd(28)}  ${String(causeSum).padStart(5)}`)

// THE PER-REPO VIEW — the population is 9 repositories, and a wall that is one
// repository's test harness is a different thing from a wall that is everywhere.
const byRepo = new Map<string, number>()
for (const r of wallRows) {
  const rel = r.file.replace(/^.*\/\.corpus\//, "")
  const repo = rel.split("/")[0]
  byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1)
}
console.log("")
console.log("WALL 1 BY REPOSITORY (the farm's 9 perl repos)")
for (const [k, n] of [...byRepo.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)}  ${String(n).padStart(5)}`)
}

console.log("")
if (failures.length) {
  console.log("CONTROL FAILURES:")
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
console.log("ALL CONTROLS PASS")
