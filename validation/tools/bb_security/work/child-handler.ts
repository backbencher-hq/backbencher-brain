// Fresh-process LIBRARY-door call of bb_security (createToolHandlers), which is
// the second public door after MCP stdio: no server gate, no argument
// validation. Used to observe what the handler itself does to a project with
// no index.
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import type { ToolContext } from "../../../../src/mcp/tools/shared"

const dir = process.argv[2]!
const dataDir = process.argv[3]!
const args = JSON.parse(process.argv[4] ?? "{}")
process.env.BB_DATA_DIR = dataDir
const projectId = getProjectId(dir)
const ctx: ToolContext = { projectPath: dir, projectId }
const handlers = createToolHandlers()
try {
  const result = await handlers.bb_security!(args, ctx)
  const text = (result.content ?? []).map((c: any) => c?.text ?? "").join("\n")
  console.log(JSON.stringify({ ok: true, isError: result.isError === true, textLength: text.length, textHead: text.slice(0, 400) }))
} catch (error: any) {
  console.log(JSON.stringify({ ok: false, isError: true, error: String(error?.message ?? error).slice(0, 600) }))
}
