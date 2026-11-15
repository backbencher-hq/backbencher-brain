// Reproduce the Lead's T2 hub breach for bb_impact and break the wall time down.
// Same protocol: BB_DATA_DIR=<repo>/.bb-data, BB_NO_AUTO_REFRESH=1, in-process
// handler calls, 1 warm-up + 3 measured runs. Byte-read-only opens; index bytes
// and mtime recorded before/after.
import { statSync } from "node:fs"
import path from "node:path"
import { writeFileSync } from "node:fs"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/work/t2-hub-breakdown.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { computeImpact, countImpactDependents, IMPACT_BUDGET, IMPACT_REL_TYPES } = await import(path.join(ROOT, "src/lsp/impact.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

const pid = getProjectId(ROOT)
const dbPath = path.join(ROOT, ".bb-data/projects", pid, "brain.db")
const snapshot = () => ({ bytes: statSync(dbPath).size, mtimeMs: statSync(dbPath).mtimeMs })
const before = snapshot()
const load = (await import("node:os")).loadavg()

const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const SYMBOL = "getRawInstance"
const rows: any[] = []
const time = async (label: string, fn: () => unknown | Promise<unknown>) => {
  const t0 = performance.now()
  let value: any
  try { value = await fn() } catch (e) { value = { error: String((e as Error).message).slice(0, 200) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value })
  console.log(`${label}: ${ms} ms`)
}

// The engine walk as computeImpact passes it.
const walk = { direction: "callers" as const, maxDepth: IMPACT_BUDGET.maxDepth, relationshipTypes: [...IMPACT_REL_TYPES] }
const rootRow = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(pid, SYMBOL) as { id: string } | undefined

// Handler: 1 warm-up + 3 measured, exactly like the Lead's harness.
const handlerRuns: number[] = []
let handledPayload: any = null
const callHandler = async () => {
  const t0 = performance.now()
  const r = await handlers.bb_impact({ symbol: SYMBOL }, ctx)
  const ms = performance.now() - t0
  if (r.isError) throw new Error(String(r.content[0].text).slice(0, 300))
  const text = String(r.content[0].text)
  handledPayload = JSON.parse(text)
  return { ms: Number(ms.toFixed(1)), outputBytes: Buffer.byteLength(text, "utf8") }
}
await callHandler()
let outputBytes = 0
for (let i = 0; i < 3; i++) { const r = await callHandler(); handlerRuns.push(r.ms); outputBytes = r.outputBytes }
const sorted = [...handlerRuns].sort((a, b) => a - b)
const p50 = sorted[Math.max(0, Math.ceil(0.5 * sorted.length) - 1)]!
const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!
console.log(`handler runs: ${handlerRuns.join(", ")} p50=${p50} p95=${p95} outputBytes=${outputBytes}`)

const pickCounts = (p: any) => ({
  shownCount: p?.shownCount,
  totalCountIfKnown: p?.totalCountIfKnown,
  directCount: p?.directCount,
  truncated: p?.truncated,
  truncationReason: p?.truncationReason,
  depthReached: p?.traversal?.depthReached,
  engineTruncated: p?.traversal?.engineTruncated,
  engineTruncationReason: p?.traversal?.engineTruncationReason,
  countVerification: p?.countVerification,
  budget: p?.budget,
  reproducible: p?.reproducible,
  cascade: p?.cascade,
  impactRows: p?.impact?.length,
})

// Component and its two halves, warm + 3 measured each.
await time("engine-walk-warm", () => graphTraversal(pid, SYMBOL, walk).then((r: any) => ({ callers: r.callers.length, truncated: r.summary.truncated, reason: r.summary.truncationReason, timeBudgetExhausted: r.summary.timeBudgetExhausted, totalCallers: r.summary.totalCallers, callersIfUncapped: r.summary.callersIfUncapped })))
for (let i = 0; i < 3; i++) await time(`engine-walk-${i + 1}`, () => graphTraversal(pid, SYMBOL, walk).then((r: any) => ({ callers: r.callers.length, truncated: r.summary.truncated, reason: r.summary.truncationReason })))
if (rootRow) {
  await time("count-walk-warm", () => countImpactDependents(raw, pid, rootRow.id, { maxDepth: IMPACT_BUDGET.maxDepth, relationshipTypes: [...IMPACT_REL_TYPES] }).then((c) => ({ total: c.total, direct: c.direct, rowsScanned: c.rowsScanned, expansions: c.expansions, hitScanCeiling: c.hitScanCeiling, timedOut: c.timedOut, failed: c.failed })))
  for (let i = 0; i < 3; i++) await time(`count-walk-${i + 1}`, () => countImpactDependents(raw, pid, rootRow.id, { maxDepth: IMPACT_BUDGET.maxDepth, relationshipTypes: [...IMPACT_REL_TYPES] }).then((c) => ({ total: c.total, rowsScanned: c.rowsScanned, timedOut: c.timedOut, hitScanCeiling: c.hitScanCeiling })))
}
await time("computeImpact-warm", () => computeImpact(raw, pid, SYMBOL).then((r) => pickCounts(r)))
for (let i = 0; i < 3; i++) await time(`computeImpact-${i + 1}`, () => computeImpact(raw, pid, SYMBOL).then((r) => ({ shown: r.shownCount, truncated: r.truncated })))
await time("manual-json-stringify", () => Buffer.byteLength(JSON.stringify(handledPayload), "utf8"))

const after = snapshot()
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  protocol: "in-process handler calls, 1 warm-up + 3 measured, BB_NO_AUTO_REFRESH=1, byte-read-only",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/t2-hub-breakdown.ts",
  symbol: SYMBOL,
  projectId: pid,
  dbPath,
  loadAverage: load,
  dbBefore: before,
  dbAfter: after,
  dbUnchanged: before.bytes === after.bytes && before.mtimeMs === after.mtimeMs,
  handlerRunsMs: handlerRuns,
  handlerP50Ms: p50,
  handlerP95Ms: p95,
  outputBytes,
  payload: pickCounts(handledPayload),
  rows,
}, null, 2) + "\n")
console.log(`DB_UNCHANGED:${before.bytes === after.bytes && before.mtimeMs === after.mtimeMs}`)
console.log("HUB_BREAKDOWN_DONE")
