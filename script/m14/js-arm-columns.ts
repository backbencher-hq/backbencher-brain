/**
 * js-arm-columns — READ AN ARM LOG, AND COMPARE TWO OF THEM COLUMN BY COLUMN.
 *
 * The javascript lane's arms write a log whose tables are the arbiter's own (the gate's TABLE 1,
 * the BINDING INTENT table, the clause lines). A number in those tables is only comparable with a
 * number from the SAME population and the SAME instrument, so this reads the log's OWN header
 * (command, HEAD, analyzer digest, population, corpus root) beside every column it prints — and,
 * given two logs, prints the DELTA per column so a movement is a movement and not two numbers.
 *
 * IT READS; IT NEVER JUDGES. The arbiter's verdict line is quoted, not interpreted.
 *
 * USAGE
 *   bun run script/m14/js-arm-columns.ts <arm.log>
 *   bun run script/m14/js-arm-columns.ts <before.log> <after.log>
 */
import { readFileSync } from "node:fs"

const logs = process.argv.slice(2).filter((a) => !a.startsWith("--"))
if (logs.length === 0) {
  console.error("usage: bun run script/m14/js-arm-columns.ts <arm.log> [<before.log> <after.log>]")
  process.exit(2)
}

const TABLE1_COLS = [
  "edges", "resolved", "collRes", "amb(decl)", "amb(kind)", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
]
const INTENT_COLS = ["edges", "intended", "sameFileUnproven", "arbitraryTwin", "nothingAnywhere", "noTarget"]

type Arm = {
  path: string
  command: string
  head: string
  analyzer: string
  population: string
  corpusRoot: string
  projectIndex: string
  parseFailures: string
  table1: number[]
  intent: number[]
  closure: string
  clause4: string
  verdict: string
  selfTest: string
  separator: string
}

function grab(text: string, re: RegExp): string {
  const m = text.match(re)
  return m ? m[0].trim() : "(not found)"
}

function numbers(line: string): number[] {
  return (line.match(/-?\d+/g) ?? []).map(Number)
}

function readArm(path: string): Arm {
  const text = readFileSync(path, "utf8")
  const lines = text.split("\n")
  // TABLE 1's TOTAL row is the FIRST row that starts with `TOTAL` and carries the full column set
  // (14 numbers); the BINDING INTENT table's TOTAL row is the first one AFTER that table's header.
  const table1Line = lines.find((l) => /^TOTAL\s+\d+/.test(l) && numbers(l).length >= 10) ?? ""
  const intentIdx = lines.findIndex((l) => l.includes("BINDING INTENT"))
  const intentLine = intentIdx >= 0 ? (lines.slice(intentIdx).find((l) => /^\s*TOTAL\s+\d+/.test(l)) ?? "") : ""
  return {
    path,
    command: grab(text, /^\$ .*$/m),
    head: grab(text, /^# HEAD: .*$/m),
    analyzer: grab(text, /^# analyzer sha256: .*$/m),
    population: grab(text, /^population: \d+ parsed of .*$/m),
    corpusRoot: grab(text, /^corpus root: .*$/m),
    projectIndex: grab(text, /^project index: .*$/m).slice(0, 120),
    parseFailures: grab(text, /^parse failures: .*$/m),
    table1: numbers(table1Line),
    intent: numbers(intentLine),
    closure: grab(text, /INTENT CLOSURE: .*$/m),
    clause4: grab(text, /^ *clause 4 .*$/m),
    verdict: grab(text, /^VERDICT: .*$/m).slice(0, 200),
    selfTest: grab(text, /^instrument self-test: .*$/m),
    separator: grab(text, /^separator tripwire: .*$/m),
  }
}

function printArm(a: Arm): void {
  console.log(`── ${a.path}`)
  console.log(`   command      : ${a.command}`)
  console.log(`   ${a.head}`)
  console.log(`   ${a.analyzer}`)
  console.log(`   ${a.corpusRoot}`)
  console.log(`   ${a.population}`)
  console.log(`   ${a.parseFailures}`)
  console.log(`   ${a.projectIndex}`)
  console.log(`   ${a.separator}`)
  console.log(`   TABLE 1 (the verdict's scope, per PROJECT):`)
  a.table1.forEach((v, i) => console.log(`     ${(TABLE1_COLS[i] ?? `col${i}`).padEnd(12)} ${String(v).padStart(10)}`))
  console.log(`   BINDING INTENT:`)
  a.intent.forEach((v, i) => console.log(`     ${(INTENT_COLS[i] ?? `col${i}`).padEnd(16)} ${String(v).padStart(10)}`))
  console.log(`   ${a.closure}`)
  console.log(`   ${a.clause4}`)
  console.log(`   ${a.selfTest}`)
  console.log(`   ${a.verdict}`)
  console.log("")
}

const arms = logs.map(readArm)
for (const a of arms) printArm(a)

if (arms.length >= 2) {
  const [before, after] = arms
  console.log("── THE MOVEMENT (after − before)")
  const delta = (x: number, y: number): string => {
    const d = y - x
    return d === 0 ? "±0" : (d > 0 ? `+${d}` : `${d}`)
  }
  console.log(`   population before : ${before.population}`)
  console.log(`   population after  : ${after.population}`)
  if (before.population !== after.population) {
    console.log("   ** THE POPULATIONS DIFFER — the two numbers are NOT a movement. **")
  }
  console.log(`   TABLE 1:`)
  before.table1.forEach((v, i) => {
    const w = after.table1[i]
    if (w === undefined) return
    console.log(`     ${(TABLE1_COLS[i] ?? `col${i}`).padEnd(12)} ${String(v).padStart(10)} -> ${String(w).padStart(10)}   ${delta(v, w)}`)
  })
  console.log(`   BINDING INTENT:`)
  before.intent.forEach((v, i) => {
    const w = after.intent[i]
    if (w === undefined) return
    console.log(`     ${(INTENT_COLS[i] ?? `col${i}`).padEnd(16)} ${String(v).padStart(10)} -> ${String(w).padStart(10)}   ${delta(v, w)}`)
  })
  const tBefore = before.table1[0] ?? 0
  const tAfter = after.table1[0] ?? 0
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)
  console.log(`   CLOSURE: the class sum must equal the edge count.`)
  console.log(`     before: sum ${sum(before.table1)} vs edges ${tBefore}`)
  console.log(`     after : sum ${sum(after.table1)} vs edges ${tAfter}`)
  const arbBefore = before.intent[INTENT_COLS.indexOf("arbitraryTwin")] ?? 0
  const arbAfter = after.intent[INTENT_COLS.indexOf("arbitraryTwin")] ?? 0
  console.log(`   arbitraryTwin: ${arbBefore} -> ${arbAfter} ${arbAfter > arbBefore ? "** ROSE — the D6 check FAILS **" : arbAfter === arbBefore ? "(UNCHANGED — not risen)" : "(FELL)"}`)
}
