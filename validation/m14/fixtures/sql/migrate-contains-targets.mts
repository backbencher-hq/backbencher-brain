/**
 * One-shot migration of the `contains` TARGET contract in this lane's fixtures.
 *
 * WHY IT EXISTS. The analyzer now emits `contains` targets as the member's qualified name
 * (`<fixture file>::<owner>.<member>`), so 5 of 16 fixtures failed on rows that pin the old bare
 * target. The brief's own words apply: a fixture that fails because the contract moved is
 * information about the contract, not an obstacle to route around.
 *
 * WHY IT IS A SCRIPT AND NOT 25 HAND EDITS. The new string is DERIVED from the old one by a rule
 * with no judgement in it, so deriving it 25 times by hand is 25 chances to introduce a typo that
 * silently stops matching. Every rewrite is checked against that rule, and an entry the rule cannot
 * rewrite is reported and left ALONE rather than approximated.
 *
 * THE FAILURE MODE THIS GUARDS. `forbidRelationships` is satisfied by the ABSENCE of a matching row.
 * A `forbid` row whose target stops matching is a forbid that can never fail — a silently deleted
 * assertion that still reads as coverage. So every `contains` entry in BOTH lists is migrated, and
 * the script prints both counts; a `forbid` count of 0 against a non-zero `expect` count would mean
 * assertions were dropped rather than moved.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const DIR = "validation/m14/fixtures/sql"
const { readdirSync } = await import("node:fs")

const isContains = (e: any): boolean => {
  const t = e?.type ?? e?.relationshipType
  return t === "contains" || t === "Contains" || t === "relation_contains"
}

let expectMoved = 0
let forbidMoved = 0
let countMoved = 0
const unmigrated: string[] = []

for (const f of readdirSync(DIR).filter((n) => n.endsWith(".expectation.json")).sort()) {
  const abs = path.join(DIR, f)
  const doc = JSON.parse(readFileSync(abs, "utf8"))
  const fixtureFile = String(doc.fixture ?? "").split("/").pop()
  if (!fixtureFile) {
    console.error(`SKIP ${f}: no \`fixture\` field`)
    continue
  }
  let touched = false

  for (const [key, counter] of [["expectRelationships", "expect"], ["forbidRelationships", "forbid"], ["expectRelationshipCount", "count"]] as const) {
    const rows = doc[key]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!isContains(row)) continue
      if (typeof row.target !== "string" || row.target.length === 0) continue
      if (row.target.includes("::")) continue // already qualified
      const from = row.from ?? row.source ?? row.fromSymbol
      if (typeof from !== "string" || from.length === 0) {
        unmigrated.push(`${f} ${key}: contains row with no \`from\` — ${JSON.stringify(row)}`)
        continue
      }
      if (from === row.target) {
        unmigrated.push(`${f} ${key}: contains self-edge — ${JSON.stringify(row)}`)
        continue
      }
      row.target = `${fixtureFile}::${from}.${row.target}`
      if (counter === "expect") expectMoved++
      else if (counter === "forbid") forbidMoved++
      else countMoved++
      touched = true
    }
  }

  if (touched) {
    writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`)
    console.log(`migrated ${f}`)
  }
}

console.log("")
console.log(`expect contains targets moved : ${expectMoved}`)
console.log(`forbid contains targets moved : ${forbidMoved}`)
console.log(`count contains targets moved  : ${countMoved}`)
if (unmigrated.length) {
  console.log("")
  console.log(`NOT MIGRATED (${unmigrated.length}) — these need a human:`)
  for (const u of unmigrated) console.log(`  ${u}`)
  process.exit(1)
}
if (forbidMoved === 0) {
  console.log("")
  console.log("NOTE: 0 forbid rows moved ON THIS RUN. The script is idempotent, so that is also what")
  console.log("      a second run prints after the first moved them — check the first run's count")
  console.log("      before concluding the lane's `forbid` assertions never pin a contains target.")
}
