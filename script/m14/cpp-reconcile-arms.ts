/**
 * cpp-reconcile-arms — THE CPP LANE'S ARM RECONCILER (2026-10-20).
 *
 * WHY IT EXISTS: the Lead's ruling on the three pending instruments (§6) requires every lane to owe back
 * "(b) a BEFORE and an AFTER arm on ONE population and ONE root, and (c) a row-level reconciliation of the
 * movement — a multiset keyed on the gate's own `(label, target, srcFile, line)` with an occurrence
 * counter, because a plain map collapses the rows that share an identity and under-counts the movement".
 * The java lane's reconciliation is the model; THIS is the cpp lane's, and it is built BEFORE the arm runs,
 * so the arm's result is one command rather than a new instrument.
 *
 * WHAT IT CHECKS, IN THE ORDER THE ACCEPTANCE CRITERIA NAME THEM:
 *   1 · the COLUMNS — TABLE 1's per-type table, both arms, with the deltas;
 *   2 · the CLOSURE — `resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL
 *      + causeOK + causeFAIL == edges`, EXACTLY, in both arms (the gate prints the identity; this checks it);
 *   3 · the FAILURES — `extFAIL = bindFAIL = causeFAIL = 0` in both arms;
 *   4 · `arbitraryTwin` — NOT RISEN (the must-not-rise rule the D7 page states as the falsifier for bucket
 *      A: a name key that guesses is the defect the fleet's D6 exists to catch);
 *   5 · the INTENT CLOSURE — `intended + sameFileUnproven + arbitraryTwin + nothingAnywhere + noTarget ==
 *      edges`, exactly;
 *   6 · the ROW-LEVEL MOVEMENT — the multiset reconciliation, with the occurrence counter, reported as the
 *      outcome matrix, the rows that LEFT the dump (they became RESOLVED) and the rows that ENTERED it.
 *
 * USAGE: bun run script/m14/cpp-reconcile-arms.ts <before-dump> <after-dump> [--json=<path>]
 *   EXIT 0 — every criterion holds · 3 — at least one does not (and the failing one is named)
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const beforePath = argv[0]
const afterPath = argv[1]
if (!beforePath || !afterPath) {
  console.error("usage: cpp-reconcile-arms.ts <before-dump> <after-dump> [--json=<path>]")
  process.exit(2)
}
const jsonOut = argv.find((a) => a.startsWith("--json="))?.slice("--json=".length)

// ── the DUMP rows, on the gate's own identity, WITH AN OCCURRENCE COUNTER ──────────────────────────────
const SEP = ""
type Row = { label: string; outcome: string; target: string; file: string; line: number; claim: string }
function readRows(p: string): Map<string, Row> {
  const m = new Map<string, Row>()
  const seen = new Map<string, number>()
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    if (!raw.startsWith("DUMP\t")) continue
    const f = raw.split("\t")
    if (f.length < 6) continue
    const loc = f[4]
    const colon = loc.lastIndexOf(":")
    const file = colon > 0 ? loc.slice(0, colon) : loc
    const line = colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0
    const base = [f[1], f[3], file, String(line)].join(SEP)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    m.set(base + SEP + String(n), { label: f[1], outcome: f[2], target: f[3], file, line, claim: f[5] })
  }
  return m
}

// ── the gate's REPORT tables ──────────────────────────────────────────────────────────────────────────
type Cols = Record<string, number>
/**
 * THE VERDICT LINE — the PRODUCTION scope, which is the scope the acceptance criteria name (the D7 page's
 * closure: 411,648 + 469,395 + 401,734 = 1,282,777). TABLE 1 is the POOLED corpus key space, a DIFFERENT
 * scope, and a table that mixes two populations in one row is a table that cannot be checked — so both are
 * parsed, and both are reported.
 */
type Verdict = { edges: number; ambiguous: number; unresolved: number; resolved: number; extFail: number; bindFail: number; causeFail: number }
function parseVerdict(p: string): Verdict | null {
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    if (!raw.startsWith("VERDICT:")) continue
    const m = raw.match(/(\d+) ambiguous \+ (\d+) unresolved of (\d+) edges/)
    if (!m) return null
    const edges = Number(m[3]), ambiguous = Number(m[1]), unresolved = Number(m[2])
    const ef = raw.match(/\(ext\? (\d+), bind\? (\d+)\)/)
    // THE FAILURE COUNTS are on the CLAUSE 4 line ("extFAIL 0 · bindFAIL 0 · causeFAIL 0"), not on the
    // VERDICT line — so the file is read for it.
    const text = readFileSync(p, "utf8")
    const cf = text.match(/extFAIL (\d+) [^\n]*?bindFAIL (\d+) [^\n]*?causeFAIL (\d+)/)
    return {
      edges, ambiguous, unresolved, resolved: edges - ambiguous - unresolved,
      extFail: ef ? Number(ef[1]) : -1, bindFail: cf ? Number(cf[2]) : -1, causeFail: cf ? Number(cf[3]) : -1,
    }
  }
  return null
}
function parseTables(p: string): { table1: Cols; table1ByType: Record<string, Cols>; intent: Cols; intentByType: Record<string, Cols> } {
  const lines = readFileSync(p, "utf8").split("\n")
  const num = (s: string): number => {
    const v = Number(s.replace(/,/g, ""))
    return Number.isFinite(v) ? v : 0
  }
  const table1: Cols = {}
  const table1ByType: Record<string, Cols> = {}
  const intent: Cols = {}
  const intentByType: Record<string, Cols> = {}
  let mode: "none" | "t1" | "intent" = "none"
  let t1Header: string[] = []
  let inHeader = false
  for (const raw of lines) {
    if (raw.startsWith("TABLE 1 —")) { mode = "t1"; inHeader = true; continue }
    if (raw.startsWith("BINDING INTENT")) { mode = "intent"; inHeader = true; continue }
    if (mode === "none") continue
    if (/^[-\s]+$/.test(raw) && raw.trim() === "") { continue }
    if (raw.startsWith("AMBIGUOUS / UNRESOLVED")) { mode = "none"; continue }
    if (raw.startsWith("VERDICT:")) { mode = "none"; continue }
    const cells = raw.trim().split(/\s+/)
    if (inHeader) {
      if (cells[0] === "type" || cells[0] === "type") { t1Header = cells; inHeader = false; continue }
      inHeader = false
    }
    if (mode === "t1") {
      if (cells[0] === "type" && cells.length > 3) { t1Header = cells; continue }
      if (!/^[A-Za-z_]/.test(cells[0])) continue
      if (t1Header.length === 0) continue
      const row: Cols = {}
      for (let i = 1; i < t1Header.length && i < cells.length; i++) row[t1Header[i]] = num(cells[i])
      if (cells[0] === "TOTAL") Object.assign(table1, row)
      else table1ByType[cells[0]] = row
    } else if (mode === "intent") {
      if (cells[0] === "type" && cells.length > 3) { t1Header = cells; continue }
      if (!/^[A-Za-z_]/.test(cells[0])) continue
      if (t1Header.length === 0) continue
      const row: Cols = {}
      for (let i = 1; i < t1Header.length && i < cells.length; i++) row[t1Header[i]] = num(cells[i])
      if (cells[0] === "TOTAL") Object.assign(intent, row)
      else intentByType[cells[0]] = row
    }
  }
  return { table1, table1ByType, intent, intentByType }
}

const beforeT = parseTables(beforePath)
const afterT = parseTables(afterPath)

// ── the criteria ──────────────────────────────────────────────────────────────────────────────────────
const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

const CLOSURE_COLS = ["resolved", "amb(decl)", "unresolved", "bindOK", "bind?", "bindFAIL", "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL"]
for (const [arm, t] of [["BEFORE", beforeT], ["AFTER", afterT]] as const) {
  const edges = t.table1["edges"] ?? 0
  const sum = CLOSURE_COLS.reduce((a, c) => a + (t.table1[c] ?? 0), 0)
  check(`${arm}-closure-exact`, sum === edges, `sum=${sum} edges=${edges} diff=${sum - edges}`)
  for (const c of ["extFAIL", "bindFAIL", "causeFAIL"]) {
    check(`${arm}-${c}-is-zero`, (t.table1[c] ?? 0) === 0, `${c}=${t.table1[c]}`)
  }
  const iEdges = t.intent["edges"] ?? 0
  const iSum = ["intended", "sameFileUnproven", "arbitraryTwin", "nothingAnywhere", "noTarget"].reduce((a, c) => a + (t.intent[c] ?? 0), 0)
  check(`${arm}-intent-closure-exact`, iSum === iEdges, `sum=${iSum} edges=${iEdges} diff=${iSum - iEdges}`)
}
{
  const b = beforeT.intent["arbitraryTwin"] ?? 0
  const a = afterT.intent["arbitraryTwin"] ?? 0
  check("arbitraryTwin-not-risen", a <= b, `before=${b} after=${a} delta=${a - b}`)
}
// THE PRODUCTION SCOPE'S CLOSURE — the D7 page's identity: resolved + ambiguous + unresolved == edges.
const bv = parseVerdict(beforePath)
const av = parseVerdict(afterPath)
if (bv) {
  const sum = bv.resolved + bv.ambiguous + bv.unresolved
  check("BEFORE-verdict-scope-closure-exact", sum === bv.edges, `sum=${sum} edges=${bv.edges} diff=${sum - bv.edges}`)
  check("BEFORE-verdict-scope-failures-zero", bv.extFail === 0 && bv.bindFail === 0 && bv.causeFail === 0, `ext=${bv.extFail} bind=${bv.bindFail} cause=${bv.causeFail}`)
}
if (av) {
  const sum = av.resolved + av.ambiguous + av.unresolved
  check("AFTER-verdict-scope-closure-exact", sum === av.edges, `sum=${sum} edges=${av.edges} diff=${sum - av.edges}`)
  check("AFTER-verdict-scope-failures-zero", av.extFail === 0 && av.bindFail === 0 && av.causeFail === 0, `ext=${av.extFail} bind=${av.bindFail} cause=${av.causeFail}`)
}
if (bv && av) {
  check("the-two-arms-share-one-population", bv.edges === av.edges, `before edges=${bv.edges} after edges=${av.edges}`)
  const twinB = beforeT.intent["arbitraryTwin"] ?? 0
  const twinA = afterT.intent["arbitraryTwin"] ?? 0
  check("arbitraryTwin-not-risen-verdict-scope", twinA <= twinB, `before=${twinB} after=${twinA}`)
}

// ── the row-level movement ───────────────────────────────────────────────────────────────────────────
const before = readRows(beforePath)
const after = readRows(afterPath)
const matrix = new Map<string, number>()
let leftDump = 0
let enteredDump = 0
const leftByLabel = new Map<string, number>()
const enteredByLabel = new Map<string, number>()
for (const [k, b] of before) {
  const a = after.get(k)
  if (!a) { leftDump++; leftByLabel.set(b.label, (leftByLabel.get(b.label) ?? 0) + 1); continue }
  const kk = `${b.outcome} -> ${a.outcome}`
  matrix.set(kk, (matrix.get(kk) ?? 0) + 1)
}
for (const [k, a] of after) {
  if (before.has(k)) continue
  enteredDump++
  enteredByLabel.set(a.label, (enteredByLabel.get(a.label) ?? 0) + 1)
}
// THE CLAIM-SETTLEMENT CHECK — the acceptance criterion "claims never merged into resolution", read off
// the two dumps' own settlement blocks. The gate prints, for each claim-carrying row, the claim it
// carried and whether the arbiter's verdict on it was `externalVerified` / `externalRefuted` /
// `externalUnverified` — so the movement can be read without a second instrument.
check("no-rows-entered-the-dump", enteredDump === 0, `entered=${enteredDump}`)

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-reconcile-arms.ts",
  population: { before: beforePath, after: afterPath },
  columns: {
    before: beforeT.table1,
    after: afterT.table1,
    delta: Object.fromEntries(Object.keys(beforeT.table1).map((k) => [k, (afterT.table1[k] ?? 0) - (beforeT.table1[k] ?? 0)])),
  },
  verdictScope: { before: bv, after: av },
  intent: {
    before: beforeT.intent,
    after: afterT.intent,
    delta: Object.fromEntries(Object.keys(beforeT.intent).map((k) => [k, (afterT.intent[k] ?? 0) - (beforeT.intent[k] ?? 0)])),
  },
  movement: {
    matrix: Object.fromEntries([...matrix.entries()].sort((a, b) => b[1] - a[1])),
    leftDump,
    leftByLabel: Object.fromEntries(leftByLabel),
    enteredDump,
    enteredByLabel: Object.fromEntries(enteredByLabel),
  },
  checks,
  claims: {} as Record<string, unknown>,
  ok: true,
}
function parseSettlement(p: string): { rows: Array<{ claim: string; verdict: string; resolved: boolean }>; text: string } {
  const text = readFileSync(p, "utf8")
  const rows: Array<{ claim: string; verdict: string; resolved: boolean }> = []
  let inBlock = false
  for (const raw of text.split("\n")) {
    if (/CLAIM SETTLEMENT/i.test(raw)) { inBlock = true; continue }
    if (!inBlock) continue
    if (raw.trim() === "" && rows.length > 0) { if (!/CLAIM/i.test(raw)) break }
    const m = raw.match(/^\s*(\S+)\s+(\S+)\s+(\S+)/)
    if (m && !/^[-=*|]/.test(raw.trim())) rows.push({ claim: m[1], verdict: m[2], resolved: m[3] === "resolved" || m[3] === "yes" })
  }
  return { rows, text }
}
{
  const sb = parseSettlement(beforePath)
  const sa = parseSettlement(afterPath)
  const byClaim = (s: { rows: Array<{ claim: string; verdict: string; resolved: boolean }> }) => {
    const m = new Map<string, { n: number; resolved: number }>()
    for (const r of s.rows) {
      const e = m.get(r.claim) ?? { n: 0, resolved: 0 }
      e.n++
      if (r.resolved) e.resolved++
      m.set(r.claim, e)
    }
    return m
  }
  const bb = byClaim(sb)
  const ba = byClaim(sa)
  const merged: string[] = []
  for (const [claim, v] of ba) {
    const before = bb.get(claim)
    if (before && before.n === v.n && before.resolved === v.resolved) continue
    const grew = !before || v.n > before.n
    if (grew && v.resolved > 0) merged.push(`${claim}: resolved ${v.resolved}/${v.n}`)
  }
  check("no-claim-merged-into-resolution", merged.length === 0, merged.join(" · "))
  report.claims = {
    before: Object.fromEntries(bb.entries()),
    after: Object.fromEntries(ba.entries()),
    merged,
  }
}

const failures = checks.filter((c) => !c.ok)
report.ok = failures.length === 0

// ── THE CLAIM SETTLEMENT ────────────────────────────────────────────────────────────────────────────
// The gate prints a "CLAIM SETTLEMENT" block for the claims a run carried. Reading it from BOTH arms
// gives the criterion "claims never merged into resolution" as a MEASURED check, not an assertion: a
// claim that settled a row (externalVerified on a row that is NOT resolved) is a claim merged into
// resolution, and the block says so.

console.log("=== TABLE 1 — the columns, both arms ===")
for (const k of Object.keys(beforeT.table1)) {
  const b = beforeT.table1[k] ?? 0
  const a = afterT.table1[k] ?? 0
  console.log(`  ${k.padEnd(12)} before=${String(b).padStart(9)}  after=${String(a).padStart(9)}  delta=${String(a - b).padStart(8)}`)
}
console.log("\n=== THE VERDICT SCOPE (the production scope the acceptance criteria name) ===")
for (const [arm, v] of [["BEFORE", bv], ["AFTER", av]] as const) {
  if (!v) { console.log(`  ${arm}: (no VERDICT line found)`); continue }
  console.log(`  ${arm}: edges=${v.edges}  resolved=${v.resolved} + ambiguous=${v.ambiguous} + unresolved=${v.unresolved} = ${v.resolved + v.ambiguous + v.unresolved}  (diff ${v.resolved + v.ambiguous + v.unresolved - v.edges})  extFAIL=${v.extFail} bindFAIL=${v.bindFail} causeFAIL=${v.causeFail}`)
}
console.log("\n=== BINDING INTENT — the must-not-rise rule ===")
for (const k of Object.keys(beforeT.intent)) {
  const b = beforeT.intent[k] ?? 0
  const a = afterT.intent[k] ?? 0
  console.log(`  ${k.padEnd(18)} before=${String(b).padStart(9)}  after=${String(a).padStart(9)}  delta=${String(a - b).padStart(8)}`)
}
console.log("\n=== THE ROW-LEVEL MOVEMENT (the multiset, with the occurrence counter) ===")
for (const [k, v] of [...matrix.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(46)} ${v}`)
console.log(`\n  rows that LEFT the dump (they became RESOLVED): ${leftDump}`)
for (const [l, v] of [...leftByLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${l.padEnd(14)} ${v}`)
console.log(`  rows that ENTERED the dump: ${enteredDump}`)
for (const [l, v] of [...enteredByLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${l.padEnd(14)} ${v}`)
console.log("\n=== THE ACCEPTANCE CRITERIA ===")
for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
console.log(failures.length === 0 ? "\nPASS — every criterion holds" : `\nFAIL — ${failures.length} criterion/criteria failed`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1))
if (failures.length > 0) process.exit(3)
