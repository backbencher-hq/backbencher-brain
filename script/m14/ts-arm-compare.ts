/**
 * TS ARM COMPARE — the typescript production arm's ACCEPTANCE CHECK, runnable by anyone.
 *
 * ## Why this file exists
 *
 * The objective's per-language acceptance step is *"the Lead independently reproduces the movement
 * (whole-population arm, extFAIL/bindFAIL/causeFAIL = 0, **arbitraryTwin not risen**, closure exact,
 * claims never merged into resolution)"*. **The Lead's own reproduction** is
 * `validation/m14/verification/TYPESCRIPT-LEAD-REPRODUCTION-2026-10-20.md`, and its arms' logs are
 * `.tmp-lead/idx-typescript-repro.log` (production, `--index`) and
 * `.tmp-lead/idx-typescript-repro-control.log` (the same-population no-index control).
 *
 * **THIS TOOL IS THE LANE'S OWN COPY OF THAT CHECK, so the check is not a one-off reading of a log.**
 * It parses a gate log, prints every acceptance criterion separately with its measured value, and
 * compares the arm column-by-column against a REFERENCE log — so a reader can point it at any arm
 * and see, in one place, whether the arm reproduces and whether the criteria hold.
 *
 * ## R1 IS HONOURED, AND IT IS CHECKED, NOT ASSUMED
 *
 * The two roots are not comparable: the FARM (`BB_CORPUS_ROOT=$PWD/.corpus`) admits 17,689
 * typescript files across 42 repos; the gate's DEFAULT admits 17,350 across 41. **The population
 * lines of BOTH logs are read and compared**, and if they differ the tool says so in capitals
 * rather than comparing the rates anyway.
 *
 * ## Usage
 *
 *   bun run script/m14/ts-arm-compare.ts <log> [--against <reference-log>]
 *   bun run script/m14/ts-arm-compare.ts .tmp-ts/armA-dump.txt --against .tmp-lead/idx-typescript-repro.log
 */
import { readFileSync } from "node:fs"

const argv = process.argv.slice(2)
const logPath = argv.find((a) => !a.startsWith("--")) ?? ".tmp-lead/idx-typescript-repro.log"
const againstIdx = argv.indexOf("--against")
const againstPath = againstIdx >= 0 ? argv[againstIdx + 1] : ".tmp-lead/idx-typescript-repro.log"

const COLS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"]

type Parsed = {
  path: string
  table: Record<string, number[]>
  totals: Record<string, number>
  population: { parsed: number; sampled: number; corpus: number; repos: number } | null
  index: { count: number; built: number; cached: number; damaged: number; files: number } | null
  indexUsed: boolean
  intent: Record<string, number[]>
  intentTotals: Record<string, number>
  closureExact: boolean
  closureBad: number | null
  selfTest: string | null
  verdictLine: string | null
  claimStatement: boolean
  raw: string
}

const num = (s: string): number => Number(String(s).replace(/,/g, ""))

const parse = (path: string): Parsed => {
  const log = readFileSync(path, "utf8")
  const table: Record<string, number[]> = {}
  for (const line of log.split("\n")) {
    const m = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$/.exec(line)
    if (m) table[m[1]!] = m.slice(2).map(num)
  }
  const intent: Record<string, number[]> = {}
  for (const line of log.split("\n")) {
    const m = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(line.trim())
    if (m) intent[m[1]!] = m.slice(2).map(num)
  }
  const pop = /population: (\d+) parsed of (\d+) sampled \(corpus has (\d+) .*?files across (\d+) repos/.exec(log)
  const idx = /project index: USED — (\d+) repo index\(es\) \((\d+) built, (\d+) from cache, (\d+) damaged\) over (\d+) file/.exec(log)
  const closureBad = /INTENT CLOSURE: \*\* (\d+) ROW\(S\) DO NOT CLOSE \*\*/.exec(log)
  const selfTest = /self-test[: ]+(\w+)/i.exec(log)
  const verdict = /^VERDICT:.*$/m.exec(log)
  const totals: Record<string, number> = {}
  for (const c of COLS) totals[c] = TYPES.reduce((a, t) => a + (table[t]?.[COLS.indexOf(c)] ?? 0), 0)
  const intentTotals: Record<string, number> = {}
  for (let i = 0; i < 6; i++) intentTotals[String(i)] = TYPES.reduce((a, t) => a + (intent[t]?.[i] ?? 0), 0)
  return {
    path, log: undefined as never, table, totals,
    population: pop ? { parsed: num(pop[1]!), sampled: num(pop[2]!), corpus: num(pop[3]!), repos: num(pop[4]!) } : null,
    index: idx ? { count: num(idx[1]!), built: num(idx[2]!), cached: num(idx[3]!), damaged: num(idx[4]!), files: num(idx[5]!) } : null,
    indexUsed: idx !== null,
    intent, intentTotals,
    closureExact: /INTENT CLOSURE: every row closes/.test(log),
    closureBad: closureBad ? num(closureBad[1]!) : null,
    selfTest: selfTest ? selfTest[1]! : null,
    verdictLine: verdict ? verdict[0] : null,
    claimStatement: /A CLAIM IS NOT A RESOLUTION/.test(log),
    raw: log,
  } as Parsed
}

const arm = parse(logPath)
const ref = parse(againstPath)
const failures: string[] = []
const pass = (s: string) => console.log(`  ok    ${s}`)
const fail = (s: string) => { console.log(`  FAIL  ${s}`); failures.push(s) }

console.log(`TS ARM COMPARE — the objective's acceptance check for the typescript production arm`)
console.log(`ARM      ${logPath}`)
console.log(`REFERENCE ${againstPath}\n`)

// ── THE POPULATION (R1) ────────────────────────────────────────────────────────────────────────
console.log("THE POPULATION")
if (!arm.population) fail("no population line in the arm's log")
else {
  const p = arm.population
  console.log(`  parsed ${p.parsed} of ${p.sampled} sampled · corpus ${p.corpus} files across ${p.repos} repos`)
  if (arm.index) console.log(`  project index: USED — ${arm.index.count} repo index(es) (${arm.index.built} built, ${arm.index.cached} from cache, ${arm.index.damaged} damaged) over ${arm.index.files} file(s)`)
  else console.log(`  project index: NOT USED — the per-file population, NOT production's`)
  if (ref.population) {
    const same = ref.population.parsed === p.parsed && ref.population.corpus === p.corpus && ref.population.repos === p.repos
    console.log(`  the REFERENCE arm's population: ${ref.population.parsed} of ${ref.population.sampled} sampled · ${ref.population.corpus} files across ${ref.population.repos} repos`)
    if (same) pass("R1 holds — both arms are the SAME population, so the columns below are like-for-like")
    else fail(`*** DIFFERENT POPULATION (R1) — the arm is ${p.corpus}/${p.repos} and the reference is ${ref.population.corpus}/${ref.population.repos}: the columns below are NOT comparable ***`)
  } else fail("the reference log has no population line")
}

// ── THE COLUMNS ────────────────────────────────────────────────────────────────────────────────
console.log(`\nTABLE 1 — the arm against the reference, column by column`)
let allSame = true
console.log(`  ${"column".padEnd(12)} ${"arm".padStart(12)} ${"reference".padStart(12)}   verdict`)
for (const c of COLS) {
  const a = arm.totals[c] ?? 0, r = ref.totals[c] ?? 0
  const same = a === r
  if (!same) allSame = false
  console.log(`  ${c.padEnd(12)} ${String(a).padStart(12)} ${String(r).padStart(12)}   ${same ? "MATCH" : `DIFFERS (${a - r > 0 ? "+" : ""}${a - r})`}`)
}
console.log(`  => ${allSame ? "THE ARM REPRODUCES THE REFERENCE EXACTLY — every column matches" : "THE ARM DOES NOT MATCH THE REFERENCE — see the DIFFERS rows"}`)

// ── THE ACCEPTANCE CRITERIA ────────────────────────────────────────────────────────────────────
console.log(`\nTHE ACCEPTANCE CRITERIA (the objective's own words)`)
if ((arm.totals.extFAIL ?? -1) === 0) { pass(`extFAIL = 0`) } else { fail(`extFAIL = ${arm.totals.extFAIL}, expected 0`) }
if ((arm.totals.bindFAIL ?? -1) === 0) { pass(`bindFAIL = 0`) } else { fail(`bindFAIL = ${arm.totals.bindFAIL}, expected 0`) }
if ((arm.totals.causeFAIL ?? -1) === 0) { pass(`causeFAIL = 0`) } else { fail(`causeFAIL = ${arm.totals.causeFAIL}, expected 0`) }

const classSum = ["resolved", "ambDecl", "unresolved", "bindOK", "bindQ", "bindFAIL", "extOK", "extQ", "extFAIL", "causeOK", "causeFAIL"]
  .reduce((a, c) => a + (arm.totals[c] ?? 0), 0)
if (classSum === arm.totals.edges) pass(`closure EXACT — the class sum ${classSum.toLocaleString()} equals the edge count ${(arm.totals.edges ?? 0).toLocaleString()}`)
else fail(`closure NOT exact — the class sum ${classSum.toLocaleString()} vs the edge count ${(arm.totals.edges ?? 0).toLocaleString()} (delta ${classSum - (arm.totals.edges ?? 0)})`)

if (arm.claimStatement) pass("claims never merged into resolution — the gate's own statement is in the log, and extOK/ext?/bindOK are columns of their own")
else fail("the log does not carry the gate's 'A CLAIM IS NOT A RESOLUTION' statement")

if (arm.closureExact) pass("intent closure exact — the gate's own line: every row closes")
else if (arm.closureBad !== null) fail(`intent closure: ${arm.closureBad} row(s) do not close`)
else console.log("  ??    no INTENT CLOSURE line in the log")

const at = arm.intentTotals["3"] ?? 0
const refAt = ref.intentTotals["3"] ?? 0
console.log(`\n  arbitraryTwin on THIS arm: ${at.toLocaleString()} · on the REFERENCE arm: ${refAt.toLocaleString()}`)
if (at === refAt) pass(`arbitraryTwin NOT RISEN — identical to the reference arm (${at.toLocaleString()})`)
else if (at < refAt) console.log(`  ok    arbitraryTwin FALLEN by ${(refAt - at).toLocaleString()} — the criterion is "not risen", and a fall is not a rise`)
else fail(`*** arbitraryTwin RISEN by ${(at - refAt).toLocaleString()} ***`)

console.log(`\nSELF-TEST: ${arm.selfTest ?? "(not in the log)"}`)
if (arm.verdictLine) console.log(`THE GATE'S OWN VERDICT LINE: ${arm.verdictLine}`)
// THE SUMMARY'S THREE BRANCHES MUST EACH MATCH THE TABLE ABOVE THEM ✓✓ (the lane's own harness
// printed "MATCHES THE REFERENCE ON EVERY COLUMN" on a run whose table showed DIFFERS on nine
// columns ✓✗ — a summary that contradicts its own table is worse than no summary ✓✓).
const verdict = allSame && failures.length === 0
  ? "REPRODUCED — every criterion holds"
  : failures.length
    ? "FAILURES ABOVE — SEE THE MARKED ROWS"
    : allSame
      ? "MATCHES THE REFERENCE ON EVERY COLUMN, AND EVERY CRITERION HOLDS"
      : "THE COLUMNS DIFFER FROM THE REFERENCE (see the DIFFERS rows above), AND EVERY CRITERION HOLDS ON THIS ARM"
console.log(`\nTHE ARM'S VERDICT: ${verdict}`)
if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log(`  - ${f}`) }
