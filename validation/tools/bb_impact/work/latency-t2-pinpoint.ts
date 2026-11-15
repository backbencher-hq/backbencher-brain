// Pinpoint where the T2 cost is: engine root resolution, the caller walk itself,
// or the name/candidate lookups computeImpact adds around it.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
const { computeImpact } = await import(path.join(ROOT, "src/lsp/impact.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid)
const rows: any[] = []
const KINDS = ["calls", "instantiates", "extends", "implements"]
const t = async (label: string, fn: () => any) => {
  const t0 = performance.now()
  let v: any
  try { v = await fn() } catch (e) { v = { error: String((e as Error).message).slice(0, 160) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value: v })
  console.log(`${label}: ${ms} ms ${JSON.stringify(v).slice(0, 200)}`)
}

const symbol = "computeImpact"
await t("root-exact-name-row", () => raw.prepare("SELECT s.id AS id, s.name AS name, s.symbol_type AS t, s.file_id AS f FROM brain_symbol s WHERE s.project_id = ? AND s.name = ? LIMIT 5").all(pid, symbol))
await t("count-rows-targeting-name", () => {
  const ids = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ?").all(pid, symbol).map((r: any) => r.id)
  let n = 0
  for (const id of ids) n += (raw.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ? AND target_symbol_id = ?").get(pid, id) as any).n
  return { copies: ids.length, rows: n }
})
await t("engine-depth-1", () => graphTraversal(pid, symbol, { direction: "callers", maxDepth: 1, relationshipTypes: KINDS }).then((r: any) => ({ callers: r.callers.length, truncated: r.summary.truncated, reason: r.summary.truncationReason, totalCallers: r.summary.totalCallers })))
await t("engine-depth-5", () => graphTraversal(pid, symbol, { direction: "callers", maxDepth: 5, relationshipTypes: KINDS }).then((r: any) => ({ callers: r.callers.length, truncated: r.summary.truncated, reason: r.summary.truncationReason, totalCallers: r.summary.totalCallers })))
await t("computeImpact", () => computeImpact(raw, pid, symbol).then((r: any) => ({ shown: r.shownCount, total: r.totalCountIfKnown, truncated: r.truncated })))
await t("engine-depth-5-second", () => graphTraversal(pid, symbol, { direction: "callers", maxDepth: 5, relationshipTypes: KINDS }).then((r: any) => ({ callers: r.callers.length, msNote: "repeat" })))

writeFileSync(path.join(OUT, "latency-t2-pinpoint.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  loadAverage: (await import("node:os")).loadavg(),
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-pinpoint.ts",
  rows,
}, null, 2) + "\n")
console.log("PINPOINT_DONE")
