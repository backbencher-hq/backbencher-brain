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

let failures = 0
function check(label: string, value: boolean, detail = ""): void {
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
  check("CLI and direct handler display one item", (cli.match(/orphaned_function/g) ?? []).length <= 1 && (mcpText.match(/orphaned_function/g) ?? []).length <= 1)
} catch (error) {
  check("P3 verifier session", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname((await import("../../src/brain/database")).BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
console.log(failures === 0 ? "\nPATTERNS P3: PASS" : `\nPATTERNS P3: ${failures} FAILURES`)
process.exit(failures ? 1 : 0)
