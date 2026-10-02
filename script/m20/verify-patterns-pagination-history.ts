// M20.P3 — pagination, history, and transport parity.
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { PatternBrainTools } from "../../src/ast/tools"
import { getAnalysisHistory } from "../../src/intelligence/analysis/run-history"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { patternRelevantWorkingTreeChanges, patternSourceFingerprint } from "../../src/intelligence/patterns/evidence"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) passed++
  if (value) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-p3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
for (const [name, body] of [
  ["a.ts", "export function deadA() { return 1 }\nexport function deadB() { return 2 }\n"],
  ["b.ts", "export function deadC() { return 3 }\nexport function deadD() { return 4 }\n"],
] as const) writeFileSync(path.join(root, "src", name), body)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const engine = await PatternBrainTools.detectPatterns(projectId, { includeOrphaned: true, includeFramework: false, includeAntiPatterns: false, confidenceThreshold: 0, maxResults: 1 })
  check("engine display limit is exact", engine.patterns.length === 1, `displayed=${engine.patterns.length}`)
  check("engine exposes full scan count", engine.scan.findingsBeforeDisplayLimit >= 4, JSON.stringify(engine.scan))
  check("engine reports truncation", engine.scan.truncated, JSON.stringify(engine.scan))

  const handler = createToolHandlers().bb_patterns
  const recordedText = (await handler({ scope: "all", limit: 1, includeOrphaned: true, includeFramework: false, includeAntiPatterns: false, confidenceThreshold: 0, recordRun: true }, { projectPath: root, projectId } as any)).content[0].text
  check("handler records a run", recordedText.includes("recorded run"), recordedText.slice(0, 200))
  const history = await getAnalysisHistory(projectId, "patterns", 10)
  check("history has one completed run", history.runs.length === 1 && history.runs[0].status === "completed", JSON.stringify(history.runs))
  check("history finding count is full set, not display page", history.runs[0]?.findingCount >= 4, JSON.stringify(history.runs[0]))

  const bb = path.resolve("bin/bb")
  const cli = execFileSync("node", [bb, "tool", "bb_patterns", "--dir", root, "--args", JSON.stringify({ scope: "all", limit: 1, includeOrphaned: true, includeFramework: false, includeAntiPatterns: false, confidenceThreshold: 0 })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  const mcp = await createToolHandlers().bb_patterns({ scope: "all", limit: 1, includeOrphaned: true, includeFramework: false, includeAntiPatterns: false, confidenceThreshold: 0 }, { projectPath: root, projectId } as any)
  const mcpText = mcp.content[0].text
  check("CLI and direct handler both return a patterns response", cli.includes("patterns (") && mcpText.includes("patterns ("), `${cli.slice(0, 100)} | ${mcpText.slice(0, 100)}`)
  // Counted DISPLAY ROWS, not occurrences of the string "orphaned_function".
  // The previous form was `(cli.match(/orphaned_function/g) ?? []).length <= 1`,
  // which cannot tell a rendered finding from a rule name mentioned in a
  // summary line — so adding an honest "[scan: N finding(s) across
  // orphaned_function=M ...]" footer, which is the point of the fix, failed a
  // check whose actual intent is "limit=1 shows one finding". Row shape is the
  // thing being asserted: two leading spaces, then a [severity] tag.
  const findingRows = (text: string): number => text.split("\n").filter((l) => /^ {2}\[\w+\] /.test(l)).length
  check(
    "CLI and direct handler display one item",
    findingRows(cli) <= 1 && findingRows(mcpText) <= 1,
    `cliRows=${findingRows(cli)} mcpRows=${findingRows(mcpText)}`,
  )
  // [negative] The count line names the rule; the row count must still be the
  // page size, so a summary that mentions a type cannot inflate it.
  check(
    "the census line names rules without becoming a displayed finding",
    (cli.match(/\[scan: /g) ?? []).length <= 1 && findingRows(cli) <= 1,
    cli.slice(0, 200),
  )
} catch (error) {
  check("P3 verifier session", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname((await import("../../src/brain/database")).BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
const result = {
  issue: "M20.P3", code: "P3", milestone: "M20",
  status: failures === 0 && patternRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed: failures, negativeCases: 1,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: patternSourceFingerprint(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-patterns-pagination-history.ts",
  evidenceFile: "P3.json", generatedAt: new Date().toISOString(),
  workingTreeRelevantChanges: patternRelevantWorkingTreeChanges(path.resolve(".")),
  limitations: ["Fixture-level pagination/history/transport coverage; real-repository corpus coverage is owned by M20.X2.", "Embedding coverage is reported by health but is not required for this deterministic structural contract."]
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/P3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failures === 0 ? "\nPATTERNS P3: PASS" : `\nPATTERNS P3: ${failures} FAILURES`)
process.exit(failures ? 1 : 0)
