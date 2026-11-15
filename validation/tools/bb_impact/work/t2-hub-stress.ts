// Alternating phase probe on the hub: handler, component, engine walk and the
// counting walk, interleaved, to locate any wall-time outlier by phase.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/work/t2-hub-stress.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { computeImpact, countImpactDependents, IMPACT_WALK_TIME_CEILING_MS, IMPACT_CALL_DEADLINE_MS, IMPACT_REL_TYPES } = await import(path.join(ROOT, "src/lsp/impact.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const SYMBOL = "getRawInstance"
const rootRow = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(pid, SYMBOL) as { id: string }
const walk = { direction: "callers" as const, maxDepth: 5, relationshipTypes: [...IMPACT_REL_TYPES], timeBudgetMs: IMPACT_WALK_TIME_CEILING_MS }
const rows: any[] = []
const t = async (phase: string, fn: () => unknown | Promise<unknown>) => {
  const t0 = performance.now()
  let v: any
  try { v = await fn() } catch (e) { v = { error: String((e as Error).message).slice(0, 120) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ phase, ms, value: v })
  console.log(`${phase}: ${ms} ms`)
}
for (let i = 0; i < 4; i++) {
  await t(`handler-${i}`, async () => {
    const r = await handlers.bb_impact({ symbol: SYMBOL }, ctx)
    const p = JSON.parse(String(r.content[0].text))
    return { shown: p.shownCount, total: p.totalCountIfKnown, skipped: p.countVerification.skipped, walkExhausted: p.traversal.walkTimeExhausted }
  })
  await t(`component-${i}`, async () => { const p = await computeImpact(raw, pid, SYMBOL); return { shown: p.shownCount, total: p.totalCountIfKnown, skipped: p.countVerification.skipped } })
  await t(`engine-${i}`, async () => { const r = await graphTraversal(pid, SYMBOL, walk); return { callers: r.callers.length, exhausted: r.summary.timeBudgetExhausted } })
  await t(`count-${i}`, async () => {
    const c = countImpactDependents(raw, pid, rootRow.id, { maxDepth: 5, relationshipTypes: [...IMPACT_REL_TYPES], timeCeilingMs: Math.min(4000, IMPACT_CALL_DEADLINE_MS - 1000) })
    return { total: c.total, rowsScanned: c.rowsScanned, expansions: c.expansions, timedOut: c.timedOut, failed: c.failed, skipped: c.skipped }
  })
}
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), walkCeiling: IMPACT_WALK_TIME_CEILING_MS, callDeadline: IMPACT_CALL_DEADLINE_MS, rows }, null, 2) + "\n")
console.log("STRESS_DONE")
