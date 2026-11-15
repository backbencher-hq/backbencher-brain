// bb_tests/bb_patterns/probes/probe-l8-framework-threshold.ts
// What did the framework-branch fix actually change on real repositories?
//
// The fix is one line: the framework branch now applies `confidenceThreshold`
// like the other three rules did. A framework finding carries confidence 0.6, so
// the fix can only REMOVE framework findings, and only at a threshold above 0.6.
//
// That is the argument. This measures whether it holds, on every complete
// repository in the data directory, at the thresholds a caller can actually ask
// for. The claim "it only removes them, and only above 0.6" is the kind of thing
// that is true until it is measured, and the removal is user-visible: a project
// that reported a framework at 0.7 now reports none.

import path from "node:path"
import { createRequire } from "node:module"
import { readdirSync } from "node:fs"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectIndexRules } = await import(path.join(REPO, "src/intelligence/patterns/rules.ts"))

const dir = path.join(process.env.BB_DATA_DIR, "projects")
const THRESHOLDS = [0, 0.5, 0.6, 0.61, 0.7, 0.9]

const pids = readdirSync(dir).filter((p) => {
  try {
    const db = new Database(path.join(dir, p, "brain.db"), { readonly: true, fileMustExist: true })
    const n = db.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(p) as { c: number }
    const s = db.prepare("SELECT status FROM brain_index_status WHERE project_id = ?").get(p) as { status: string } | undefined
    const fw = db.prepare(
      "SELECT COUNT(DISTINCT framework_type) c FROM brain_file WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown')",
    ).get(p) as { c: number }
    db.close()
    return n.c > 0 && s?.status === "complete"
  } catch { return false }
})

console.log(`thresholds: ${THRESHOLDS.join("  ")}`)
console.log(`repo         frameworks  ` + THRESHOLDS.map((t) => `t=${t}`.padStart(6)).join(""))

let rowsWithFrameworks = 0
for (const pid of pids.sort()) {
  const db = new Database(path.join(dir, pid, "brain.db"), { readonly: true, fileMustExist: true })
  const fwCount = db.prepare(
    "SELECT COUNT(DISTINCT framework_type) c FROM brain_file WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown')",
  ).get(pid) as { c: number }
  db.close()
  if (fwCount.c === 0) continue
  rowsWithFrameworks++

  const counts: number[] = []
  for (const t of THRESHOLDS) {
    const res = await detectIndexRules(pid as any, {
      confidenceThreshold: t, maxResults: 1000, includeFramework: true, includeAntiPatterns: true,
    })
    counts.push(res.filter((f: any) => f.type === "framework-detected").length)
  }
  console.log(`${pid.slice(0, 10)}  ${String(fwCount.c).padStart(9)}  ` + counts.map((c) => String(c).padStart(6)).join(""))

  // The claim, checked rather than argued: identical at and below 0.6, zero
  // above it, and nothing else about the answer changes.
  const atLow = counts.slice(0, 3)
  const consistentBelow = atLow.every((c) => c === atLow[0])
  const allZeroAbove = counts.slice(3).every((c) => c === 0)
  if (!consistentBelow || !allZeroAbove) {
    console.log(`   *** UNEXPECTED: counts ${JSON.stringify(counts)} — the claim "unchanged at or below 0.6, gone above" does not hold`)
    process.exitCode = 1
  }
}

if (rowsWithFrameworks === 0) {
  console.log("\nNo complete repository in this data directory has an analyzer-assigned framework_type,")
  console.log("so this probe measures nothing here. That is a COVERAGE gap in the corpus, not a pass:")
  console.log("the fix is unverified against real framework data and only the m65 fixture exercises it.")
  process.exit(2)
}

console.log(`\n${rowsWithFrameworks} repositories with framework data.`)
console.log("Every row should read: constant and non-zero at 0 / 0.5 / 0.6, then zero above.")
console.log("That is the whole user-visible effect of the fix — framework findings are dropped only")
console.log("when the caller asks for more confidence than 0.6, which is what the parameter promised.")
