/**
 * POWERSHELL — THE ROW-LEVEL RECONCILIATION.
 *
 * ## WHAT THIS IS FOR
 *
 * A lane's arm prints aggregate columns: edges, resolved, extOK, ext?, extFAIL. Those say HOW MUCH
 * moved and nothing about WHICH ROWS moved. The campaign's requirement is a reconciliation at the
 * ROW level, and the brief names the instrument: the gate's own
 * `(label, target, srcFile, line)` — **plus an occurrence counter**.
 *
 * **WHY THE COUNTER IS NOT OPTIONAL.** The key `(label, target, srcFile, line)` is NOT unique. The
 * fleet's own java dump had 91,379 rows sharing one such identity, and a plain map under-counted the
 * movement by 89 — because a map keeps ONE value per key and the LAST write wins, so N rows that
 * share a key are counted as 1. This tool therefore stores a COUNT per key, and reports a movement
 * as a DIFFERENCE OF COUNTS, never as the presence or absence of a key.
 *
 * **THE KEY SEPARATOR IS NUL (`\u0000`), not a space.** A target can contain a space — a quoted
 * PowerShell literal, a command argument with a space in it — and a space-separated key would then
 * be ambiguous, which is the same class of defect as a non-unique key.
 *
 * ## THE INPUT
 *
 * The gate's `--dump` rows, one TSV line each:
 *
 *   DUMP\t{label}\t{outcome}\t{target}\t{srcFile}:{line}\t{claimKind}\t{claimSpec}
 *
 * `--dump` is bounded by `BB_DUMP_LIMIT` (default 40), so a whole-population reconciliation must
 * raise it: `BB_DUMP_LIMIT=100000000`. **And the gate prints NO marker when the bound is reached**
 * (measured: `BB_DUMP_LIMIT` appears in `script/m14/incoming-gate.ts` at exactly three places — the
 * comment, the const, and the `bbDumped < BB_DUMP_LIMIT` guard — and no `console.log` mentions it,
 * although the gate's own header says "the bound is PRINTED when reached, so a short list is never
 * mistaken for the set"). So the completeness check is made HERE, from the gate's own TOTAL row:
 *
 *     dump rows  ==  edges - resolved
 *
 * for a complete dump, because the dump prints exactly the NON-RESOLVED rows
 * (`pc.outcome !== "resolved"`) and the TOTAL row prints `edges` and `resolved`. A mismatch is a
 * truncated dump, and a movement computed from a truncated dump is not a whole-set movement, so the
 * tool says so rather than reporting it as one.
 *
 * ## WHAT IT REPORTS
 *
 *   · the movement by OUTCOME (the aggregate the arm's table shows, recomputed from the rows);
 *   · the keys that APPEARED and DISAPPEARED, with their counts;
 *   · the keys whose COUNT changed, with both counts and the delta;
 *   · the keys that survived with a CHANGED OUTCOME — the rows that moved class rather than
 *     appearing or disappearing, which is the movement a key-presence diff cannot see at all.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/powershell/row-reconciliation.mts BEFORE.log AFTER.log
 *   npx tsx validation/m14/fixtures/powershell/row-reconciliation.mts BEFORE.log AFTER.log --out report.json
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const files = argv.filter((a) => !a.startsWith("--"))
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const SEP = String.fromCharCode(0)

type Row = {
  label: string
  outcome: string
  target: string
  srcFile: string
  line: string
  claimKind: string
  claimSpec: string
}

type Bucket = Map<string, { count: number; outcome: string }>

/** THE GATE'S OWN TOTAL ROW — the source of the completeness cross-check. */
function readTotalRow(path: string): { edges: number; resolved: number } | null {
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    if (!line.startsWith("TOTAL")) continue
    const t = line.trim().split(/\s+/)
    if (t.length < 3) continue
    const edges = Number(t[1].replace(/,/g, ""))
    const resolved = Number(t[2].replace(/,/g, ""))
    if (Number.isFinite(edges) && Number.isFinite(resolved)) return { edges, resolved }
  }
  return null
}

function readDump(path: string): { rows: Row[]; truncated: boolean; reason: string } {
  const text = readFileSync(path, "utf8")
  const rows: Row[] = []
  let truncated = false
  let reason = ""
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) {
      if (line.startsWith("DUMP")) {
        truncated = true
        reason = reason || "a DUMP line had fewer than 7 fields"
      }
      continue
    }
    const p = line.split("\t")
    if (p.length < 7) {
      truncated = true
      reason = reason || "a DUMP line had fewer than 7 fields"
      continue
    }
    const at = p[4]
    const colon = at.lastIndexOf(":")
    rows.push({
      label: p[1],
      outcome: p[2],
      target: p[3],
      srcFile: colon >= 0 ? at.slice(0, colon) : at,
      line: colon >= 0 ? at.slice(colon + 1) : "",
      claimKind: p[5],
      claimSpec: p[6],
    })
  }
  const total = readTotalRow(path)
  if (total) {
    const expected = total.edges - total.resolved
    if (expected !== rows.length) {
      truncated = true
      reason = reason ||
        `the dump holds ${rows.length} rows but the gate's TOTAL row says edges ${total.edges} - resolved ${total.resolved} = ${expected} non-resolved rows`
    }
  } else {
    truncated = true
    reason = reason || "no TOTAL row was found in the log, so completeness could not be cross-checked"
  }
  return { rows, truncated, reason }
}

/** THE KEY — the gate's own identity — and THE COUNT. */
function bucket(rows: Row[]): Bucket {
  const m: Bucket = new Map()
  for (const r of rows) {
    const k = [r.label, r.target, r.srcFile, r.line].join(SEP)
    const cur = m.get(k)
    if (cur) cur.count += 1
    else m.set(k, { count: 1, outcome: r.outcome })
  }
  return m
}

function byOutcome(rows: Row[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1)
  return m
}

const [beforePath, afterPath] = files
if (!beforePath || !afterPath) {
  console.error("usage: row-reconciliation.mts BEFORE.log AFTER.log [--out report.json]")
  process.exit(2)
}

const before = readDump(beforePath)
const after = readDump(afterPath)

console.log(`BEFORE ${beforePath}: ${before.rows.length} dump rows`)
console.log(`AFTER  ${afterPath}: ${after.rows.length} dump rows`)
if (before.truncated) console.log(`*** BEFORE IS NOT A WHOLE SET: ${before.reason}`)
if (after.truncated) console.log(`*** AFTER  IS NOT A WHOLE SET: ${after.reason}`)
if (!before.truncated && !after.truncated) {
  console.log("both dumps cross-check against the gate's own TOTAL row: dump rows == edges - resolved. WHOLE SETS.")
}

const b = bucket(before.rows)
const a = bucket(after.rows)

const appeared: Array<[string, number, string]> = []
const disappeared: Array<[string, number, string]> = []
const countChanged: Array<[string, number, number, string, string]> = []
const outcomeChanged: Array<[string, number, string, string]> = []

for (const [k, v] of a) {
  const bv = b.get(k)
  if (!bv) appeared.push([k, v.count, v.outcome])
  else {
    if (bv.count !== v.count) countChanged.push([k, bv.count, v.count, bv.outcome, v.outcome])
    if (bv.outcome !== v.outcome) outcomeChanged.push([k, v.count, bv.outcome, v.outcome])
  }
}
for (const [k, v] of b) {
  if (!a.has(k)) disappeared.push([k, v.count, v.outcome])
}

console.log("")
console.log("=== MOVEMENT BY OUTCOME (recomputed from the rows, not from the arm's table) ===")
const bo = byOutcome(before.rows)
const ao = byOutcome(after.rows)
const outcomes = new Set([...bo.keys(), ...ao.keys()])
for (const o of [...outcomes].sort()) {
  const x = bo.get(o) ?? 0
  const y = ao.get(o) ?? 0
  const d = y - x
  console.log(`  ${o.padEnd(22)} ${String(x).padStart(8)} -> ${String(y).padStart(8)}  ${d >= 0 ? "+" : ""}${d}`)
}

const show = (k: string) => k.split(SEP).join(" | ")

console.log("")
console.log(`=== KEYS APPEARED (present after, absent before): ${appeared.length} ===`)
for (const [k, c, o] of appeared.slice(0, 40)) console.log(`  +${String(c).padStart(4)}x [${o}] ${show(k)}`)
if (appeared.length > 40) console.log(`  ... ${appeared.length - 40} more`)

console.log("")
console.log(`=== KEYS DISAPPEARED (present before, absent after): ${disappeared.length} ===`)
for (const [k, c, o] of disappeared.slice(0, 40)) console.log(`  -${String(c).padStart(4)}x [${o}] ${show(k)}`)
if (disappeared.length > 40) console.log(`  ... ${disappeared.length - 40} more`)

console.log("")
console.log(`=== KEYS WHOSE OCCURRENCE COUNT CHANGED: ${countChanged.length} ===`)
for (const [k, x, y, o1, o2] of countChanged.slice(0, 40)) {
  console.log(`  ${String(x).padStart(5)} -> ${String(y).padStart(5)} (${y - x >= 0 ? "+" : ""}${y - x})  [${o1} -> ${o2}]  ${show(k)}`)
}
if (countChanged.length > 40) console.log(`  ... ${countChanged.length - 40} more`)

console.log("")
console.log(`=== KEYS THAT SURVIVED WITH A CHANGED OUTCOME: ${outcomeChanged.length} ===`)
for (const [k, c, o1, o2] of outcomeChanged.slice(0, 40)) {
  console.log(`  ${String(c).padStart(5)}x  [${o1} -> ${o2}]  ${show(k)}`)
}
if (outcomeChanged.length > 40) console.log(`  ... ${outcomeChanged.length - 40} more`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    before: { path: beforePath, rows: before.rows.length, truncated: before.truncated, reason: before.reason, byOutcome: Object.fromEntries(bo) },
    after: { path: afterPath, rows: after.rows.length, truncated: after.truncated, reason: after.reason, byOutcome: Object.fromEntries(ao) },
    appeared, disappeared, countChanged, outcomeChanged,
  }, null, 1))
  console.log(`\nwrote ${OUT}`)
}
