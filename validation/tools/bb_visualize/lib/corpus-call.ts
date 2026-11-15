import path from "node:path"
const HERE = path.resolve(import.meta.dirname!, "..")
process.env.BB_DATA_DIR = path.join(HERE, "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"
const repo = process.argv[2]!
const args = JSON.parse(process.argv[3] ?? "{}")
const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
const { getProjectId } = await import("../../../../src/util/project-id")
const projectId = getProjectId(repo)
const handlers = createToolHandlers()
const before = process.memoryUsage()
const t0 = performance.now()
try {
  const result: any = await handlers.bb_visualize(args, { projectId, projectPath: repo } as any)
  const text = String(result.content?.[0]?.text ?? "")
  const after = process.memoryUsage()
  console.log(JSON.stringify({ ok: true, ms: Math.round(performance.now() - t0), bytes: text.length, isError: result.isError === true, rssBeforeMb: Math.round(before.rss/1048576), rssAfterMb: Math.round(after.rss/1048576), heapUsedMb: Math.round(after.heapUsed/1048576), errorText: result.isError ? text.slice(0,200) : undefined }))
} catch (e: any) {
  console.log(JSON.stringify({ ok: false, ms: Math.round(performance.now() - t0), error: e?.message ?? String(e) }))
}
