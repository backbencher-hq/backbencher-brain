/**
 * ZIG WAVE 5 — the WIRING CHECK: does this lane's F5 audit still EXIST?
 *
 * Why this file exists, which is the most expensive lesson of the wave:
 *
 * On 2026-09-29 a merge deleted this lane's `references` oracle from the shared
 * differential **and** zig's compared-label set. The lane kept running, kept
 * writing "0 MISSING / 0 UNEXPLAINED" in its records, and nothing turned red —
 * because a DELETED gate and a PASSING gate are indistinguishable from outside.
 * The same thing happened again, twice, to work that was committed: two other
 * lanes' commits reverted these very lines, and the committed state lost them
 * while the working tree kept them, so `git show HEAD:…` and the file on disk
 * disagreed and neither reading was obviously the broken one.
 *
 * So the lane's own instrument now asks the question no gate was asking:
 * **is my half of the shared harness still wired?** Five imports, five calls, one
 * compared-label list, and the truth module must export all five. Every one of
 * those is a single grep, which is exactly why it was worth automating: the loss
 * was silent three times and would have been silent a fourth.
 *
 * It checks the file on DISK (which is what runs) and prints HEAD's state beside
 * it, because the failure mode this lane hit is precisely those two disagreeing.
 *
 * Usage: npx tsx script/m14/tmp/zigw-f5-wiring.ts
 */
import * as fs from "fs"
import { execSync } from "child_process"

const DIFF = "script/m14/differential.ts"
const TRUTH = "script/m14/zig-truth.ts"
const FIVE = ["deriveZigContainment", "deriveZigImports", "deriveZigInstantiation", "deriveZigExports", "deriveZigReferenceEdges"]
const LABELS = ["calls", "uses", "references", "imports", "instantiates", "exports", "contains"]

function head(file: string): string {
  try {
    return execSync(`git show HEAD:${file}`, { encoding: "utf8", maxBuffer: 1 << 28 })
  } catch {
    return ""
  }
}

function main(): void {
  const disk = fs.readFileSync(DIFF, "utf8")
  const diskTruth = fs.readFileSync(TRUTH, "utf8")
  const inHead = head(DIFF)
  const inHeadTruth = head(TRUTH)
  const problems: string[] = []

  if (!/from "\.\/zig-truth"/.test(disk)) {
    problems.push(`${DIFF} does not import the lane's truth module — the five truths must come from script/m14/zig-truth.ts, not be inlined here`)
  }
  for (const f of FIVE) {
    const calls = (disk.match(new RegExp(`for \\(const e of ${f}\\(root\\)\\)`, "g")) ?? []).length
    if (calls !== 1) problems.push(`${DIFF} calls ${f} ${calls} time(s) in its zig branch; expected exactly 1`)
    if (!diskTruth.includes(`export function ${f}`)) problems.push(`${TRUTH} does not export ${f}`)
    if (inHeadTruth && !inHeadTruth.includes(`export function ${f}`)) {
      problems.push(`HEAD:${TRUTH} has LOST ${f} — the working tree has it, so a commit from a stale snapshot would drop it`)
    }
  }
  const labelLine = disk.split("\n").find((l) => l.includes('lang === "zig" ? [')) ?? ""
  for (const lab of LABELS) {
    if (!labelLine.includes(`"${lab}"`)) problems.push(`zig's compared-label set is missing "${lab}"${labelLine ? "" : " (no zig label line found at all)"}`)
  }
  if (inHead) {
    const headCalls = (inHead.match(/for \(const e of deriveZig/g) ?? []).length
    const diskCalls = (disk.match(/for \(const e of deriveZig/g) ?? []).length
    if (headCalls < diskCalls) {
      problems.push(`HEAD:${DIFF} has ${headCalls} zig truth call(s) but the working tree has ${diskCalls} — committing from a stale snapshot loses the rest`)
    }
  }

  console.log("F5 wiring, on disk:")
  console.log(`  imports the lane truth module: ${/from "\.\/zig-truth"/.test(disk) ? "yes" : "NO"}`)
  for (const f of FIVE) console.log(`  calls ${f.padEnd(26)} ${(disk.match(new RegExp(`for \\(const e of ${f}\\(root\\)\\)`, "g")) ?? []).length}`)
  console.log(`  zig compared labels: ${LABELS.filter((l) => labelLine.includes(`"${l}"`)).join(", ")}`)
  console.log("\nverdict: " + (problems.length === 0
    ? "the lane's F5 audit is wired — calls, imports and the label set are all present"
    : `${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`))
  process.exit(problems.length === 0 ? 0 : 1)
}
main()
