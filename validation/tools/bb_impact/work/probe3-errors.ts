// Capture the exact refusal text for invalid bb_impact arguments.
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

const projectPath = path.join(ROOT, "validation/tools/bb_impact/work/fixtures/basic")
const ctx: any = { projectPath, projectId: getProjectId(projectPath) }
const h: any = createToolHandlers()
const argsList = [
  { symbol: "leaf", maxDepth: 99, nope: true },
  { symbol: "leaf", relationshipTypes: ["not_a_stored_kind"] },
  { symbol: "leaf", relationshipTypes: ["calls", 42, null] },
  { symbol: "leaf", relationshipTypes: "calls" },
  { symbol: "leaf", refresh: "yes" },
  { symbol: "leaf", limit: 5 },
  { symbol: "" },
  {},
]
for (const args of argsList) {
  const r = await h.bb_impact(args, ctx)
  console.log("ARGS", JSON.stringify(args), "=> isError:", r.isError === true, "| text:", String(r.content[0].text).replace(/\s+/g, " ").slice(0, 260))
}
