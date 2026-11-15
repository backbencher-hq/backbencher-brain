import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
process.env.BB_DATA_DIR = path.join(ROOT, ".bb-data")
process.env.BB_NO_AUTO_REFRESH = "1"
const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
const { getProjectId } = await import("../../../../src/util/project-id")
const projectId = getProjectId(ROOT)
const handlers = createToolHandlers()
const args = JSON.parse(process.argv[2] ?? "{}")
for (let run = 0; run < Number(process.argv[3] ?? 2); run++) {
  const t0 = performance.now()
  const result = await handlers.bb_visualize(args, { projectId, projectPath: ROOT } as any)
  console.log(`run ${run}: ${(performance.now() - t0).toFixed(0)} ms, ${String((result as any).content?.[0]?.text ?? "").length} bytes`)
}
