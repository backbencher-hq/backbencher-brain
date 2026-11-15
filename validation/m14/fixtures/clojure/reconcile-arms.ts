/**
 * CLOJURE LANE — THE ROW-LEVEL ARM RECONCILER.
 *
 * ## WHAT IT IS, AND WHY A PLAIN MAP IS NOT ENOUGH
 *
 * The gate's `--dump` prints one line per NON-RESOLVED edge, and its identity is
 * `(label, target, srcFile, line)`. **That identity is not unique.** The java lane measured
 * 91,379 rows of one dump sharing that identity, and a reconciler that keys on it with a plain
 * `Map` silently collapses them — the movement was under-counted by 89. This file therefore keys
 * on the identity PLUS an **occurrence counter**: the n-th row with a given identity is
 * `identity #n`, so two rows that share an identity are still two rows and the diff counts both.
 *
 * ## WHAT IT REPORTS
 *
 *   1. `ROWS IN BOTH DUMPS` — the outcome movement matrix, `old -> new`, over the shared rows.
 *      A row whose outcome changed from `unresolved` to `externalVerified` is a CLAIM that
 *      landed; `unresolved -> ambiguous` is a name-model answer that appeared.
 *   2. `ROWS THAT LEFT THE DUMP` — the dump carries only NON-RESOLVED rows, so a row present in
 *      BEFORE and absent in AFTER became RESOLVED. These are counted BY LABEL, because the
 *      label is the only thing that says which kind of resolution happened.
 *   3. `ROWS THAT ENTERED THE DUMP` — the converse: a row that used to be resolved and is not
 *      any more. **A non-zero number here is a REGRESSION and is reported as one.**
 *
 * ## THE IDENTITY IS THE GATE'S OWN
 *
 * The dump line is `DUMP<TAB>label<TAB>outcome<TAB>target<TAB>srcFile:line<TAB>claimKind<TAB>claimSpec`.
 * The location is split at the LAST colon, because a Windows path or a file whose own name
 * contains a colon would break a first-colon split; the gate prints an absolute path, and the
 * corpus holds no path with a colon in it, but the last-colon rule is the one that cannot break.
 *
 * ## USAGE
 *
 *   bun run validation/m14/fixtures/clojure/reconcile-arms.ts <before.dump> <after.dump> [--json out.json]
 *
 * Exit status 0 always: the reconciler REPORTS, it does not adjudicate. A row that entered the
 * dump is printed as `REGRESSION` so a reader cannot miss it, and the page that cites this
 * output is the place where it is dispositioned.
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const beforePath = argv.find((a) => !a.startsWith("--") && a.endsWith(".dump")) ?? argv[0]
const afterPath = argv.filter((a) => !a.startsWith("--") && a !== beforePath)[0]
const jsonIdx = argv.indexOf("--json")
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
if (!beforePath || !afterPath) {
  console.error("usage: reconcile-arms.ts <before.dump> <after.dump> [--json out.json]")
  process.exit(2)
}

const SEP = "\u0001"

type Row = { label: string; outcome: string; target: string; file: string; line: number; claim: string }
/** THE BOUND MARKER — the gate's own `DUMP\tBOUND\tREACHED\t<limit>` row, and this instrument's
 *  `DUMP\tBOUND\tCOMPLETE\t<count>` row. It is NOT a data row: it says whether the dump is the
 *  WHOLE non-resolved set or a truncated prefix, and a reconciler that cannot tell the two
 *  under-counts the movement and LOOKS COMPLETE. It is read, reported, and excluded from the row
 *  set — and its ABSENCE is reported too, because an unmarked dump is an unmarked dump. */
type Bound = { state: "COMPLETE" | "REACHED" | "ABSENT"; value: string }

/** Read one dump into a map keyed by the gate's identity PLUS an occurrence counter. */
function read(p: string): { rows: Map<string, Row>; bound: Bound } {
  const m = new Map<string, Row>()
  const seen = new Map<string, number>()
  let bound: Bound = { state: "ABSENT", value: "-" }
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    if (!raw.startsWith("DUMP\t")) continue
    const f = raw.split("\t")
    if (f.length < 6) continue
    if (f[1] === "BOUND") { bound = { state: f[2] as "COMPLETE" | "REACHED", value: f[3] ?? "-" }; continue }
    const loc = f[4] ?? ""
    const colon = loc.lastIndexOf(":")
    const file = colon > 0 ? loc.slice(0, colon) : loc
    const line = colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0
    const base = [f[1], f[3], file, String(line)].join(SEP)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    m.set(`${base}${SEP}#${n}`, { label: f[1]!, outcome: f[2]!, target: f[3]!, file, line, claim: f[5]! })
  }
  return { rows: m, bound }
}

const beforeRead = read(beforePath)
const afterRead = read(afterPath)
const before = beforeRead.rows
const after = afterRead.rows

const matrix = new Map<string, number>()
const leftByLabel = new Map<string, number>()
const enteredByLabel = new Map<string, number>()
const enteredRows: Row[] = []
const leftRows: Row[] = []
let leftDump = 0
let enteredDump = 0

for (const [k, b] of before) {
  const a = after.get(k)
  if (!a) {
    leftDump++
    leftByLabel.set(b.label, (leftByLabel.get(b.label) ?? 0) + 1)
    if (leftRows.length < 25) leftRows.push(b)
    continue
  }
  const kk = `${b.outcome} -> ${a.outcome}`
  matrix.set(kk, (matrix.get(kk) ?? 0) + 1)
}
for (const [k, a] of after) {
  if (before.has(k)) continue
  enteredDump++
  enteredByLabel.set(a.label, (enteredByLabel.get(a.label) ?? 0) + 1)
  if (enteredRows.length < 25) enteredRows.push(a)
}

const report = {
  before: { path: beforePath, rows: before.size },
  after: { path: afterPath, rows: after.size },
  sharedOutcomeMovement: Object.fromEntries([...matrix.entries()].sort((a, b) => b[1] - a[1])),
  leftTheDump: { count: leftDump, byLabel: Object.fromEntries([...leftByLabel.entries()].sort((a, b) => b[1] - a[1])), samples: leftRows },
  enteredTheDump: { count: enteredDump, byLabel: Object.fromEntries([...enteredByLabel.entries()].sort((a, b) => b[1] - a[1])), samples: enteredRows },
  identityRule: "(label, target, srcFile, line) + occurrence counter — the n-th row with one identity is #n",
  bound: { before: beforeRead.bound, after: afterRead.bound, bothComplete: beforeRead.bound.state === "COMPLETE" && afterRead.bound.state === "COMPLETE" },
}

console.log("=== CLOJURE ARM RECONCILIATION — row level, on the gate's own identity + an occurrence counter ===")
console.log(`before: ${beforePath}  rows ${before.size}`)
console.log(`after : ${afterPath}  rows ${after.size}`)
console.log(`identity: ${report.identityRule}`)
console.log(`dump bound: BEFORE ${beforeRead.bound.state} (${beforeRead.bound.value}) · AFTER ${afterRead.bound.state} (${afterRead.bound.value})`)
if (beforeRead.bound.state !== "COMPLETE" || afterRead.bound.state !== "COMPLETE") {
  console.log("  *** ONE OF THE DUMPS IS NOT THE WHOLE NON-RESOLVED SET — the movement below UNDER-COUNTS, and it would have looked complete. ***")
}
console.log("")
console.log("=== ROWS IN BOTH DUMPS: outcome movement ===")
for (const [k, v] of [...matrix.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(52)} ${v}`)
console.log("")
console.log(`=== ROWS THAT LEFT THE DUMP (they became RESOLVED): ${leftDump} ===`)
for (const [l, v] of [...leftByLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${l.padEnd(14)} ${v}`)
for (const r of leftRows) console.log(`      e.g. ${r.label} ${r.target} @ ${r.file}:${r.line}`)
console.log("")
console.log(`=== ROWS THAT ENTERED THE DUMP: ${enteredDump} ===`)
if (enteredDump === 0) console.log("  0 — no row that resolved before is unresolved now")
for (const [l, v] of [...enteredByLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${l.padEnd(14)} ${v}`)
for (const r of enteredRows) console.log(`      e.g. ${r.label} ${r.target} @ ${r.file}:${r.line}  (${r.outcome})`)
if (enteredDump > 0) console.log("  *** REGRESSION: rows entered the non-resolved dump. Disposition it, do not fold it. ***")

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")
