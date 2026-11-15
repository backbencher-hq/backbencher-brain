// T2 cost breakdown on the reference large index: separates the handler's own
// work (file map + freshness) from the canonical walk and the wire twin, and
// includes cheap CONTROL queries so a machine under heavy load cannot be mistaken
// for a slow tool. Read-only: BB_DATA_DIR=.bb-data, BB_NO_AUTO_REFRESH=1.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { computeImpact } = await import(path.join(ROOT, "src/lsp/impact.ts"))
const { handleImpactRequest } = await import(path.join(ROOT, "src/lsp/impact_request.ts"))

const pid = getProjectId(ROOT)
const h: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const raw: any = await (BrainDatabase as any).getRawInstance(pid)
const rows: any[] = []

async function timeIt(label: string, fn: () => unknown | Promise<unknown>) {
  const t0 = performance.now()
  let value: any
  try { value = await fn() } catch (e) { value = { error: String((e as Error).message).slice(0, 200) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value: typeof value === "object" ? value : String(value).slice(0, 160) })
  console.log(`${label}: ${ms} ms`)
  return value
}

const load = (await import("node:os")).loadavg()
console.log(`# load average: ${load.map((n) => n.toFixed(2)).join(", ")}`)

// ── CONTROL: cheap indexed reads on the same 3.4 GB index ───────────────────
await timeIt("control-count-files", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_file WHERE project_id = ?").get(pid))
await timeIt("control-count-symbols", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?").get(pid))
await timeIt("control-name-equality", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ? AND name = ?").get(pid, "computeImpact"))
await timeIt("control-file-map-scan", () => raw.prepare("SELECT id, path, COALESCE(relative_path,'') AS rel FROM brain_file WHERE project_id = ?").all(pid).length)

// ── handler's own pre/post work on a normal symbol ──────────────────────────
await timeIt("component-computeImpact", () => computeImpact(raw, pid, "computeImpact").then((r: any) => ({ shown: r.shownCount, total: r.totalCountIfKnown, truncated: r.truncated })))
await timeIt("wire-handleImpactRequest", () => handleImpactRequest(raw, pid, { schemaVersion: 1, symbol: "computeImpact" }).then((r: any) => ({ shown: r.shownCount, total: r.totalCountIfKnown, truncated: r.truncated })))
await timeIt("handler-full-call", async () => {
  const r = await h.bb_impact({ symbol: "computeImpact" }, ctx)
  const p = JSON.parse(String(r.content[0].text))
  return { shown: p.shownCount, total: p.totalCountIfKnown, truncated: p.truncated }
})
// repeat: warm
await timeIt("handler-full-call-warm2", async () => {
  const r = await h.bb_impact({ symbol: "computeImpact" }, ctx)
  const p = JSON.parse(String(r.content[0].text))
  return { shown: p.shownCount, total: p.totalCountIfKnown, truncated: p.truncated }
})

// ── a heavier hub, component only (no freshness/handler work) ───────────────
await timeIt("component-hub-named", () => computeImpact(raw, pid, "named").then((r: any) => ({ shown: r.shownCount, total: r.totalCountIfKnown, truncated: r.truncated })))

writeFileSync(path.join(OUT, "latency-t2-breakdown.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  subject: "workspace reference large index (.bb-data, 11,440 files / ~3.4 GB)",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-breakdown.ts",
  loadAverage: load,
  rows,
}, null, 2) + "\n")
console.log("BREAKDOWN_DONE")
