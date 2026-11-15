// Floor measurements for the hub: how long is ONE uninterruptible statement on
// either walk, and what does a tiny clock bound actually buy? Read-only index.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/work/t2-hub-floors.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { countImpactDependents, IMPACT_REL_TYPES } = await import(path.join(ROOT, "src/lsp/impact.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const SYMBOL = "getRawInstance"
const rootRow = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(pid, SYMBOL) as { id: string }
const rows: any[] = []
const time = async (label: string, fn: () => unknown | Promise<unknown>) => {
  const t0 = performance.now()
  let value: any
  try { value = await fn() } catch (e) { value = { error: String((e as Error).message).slice(0, 160) } }
  rows.push({ label, ms: Number((performance.now() - t0).toFixed(1)), value })
  console.log(`${label}: ${rows[rows.length - 1].ms} ms ${JSON.stringify(value).slice(0, 220)}`)
}
const kinds = [...IMPACT_REL_TYPES]

// Engine walk with tiny clocks: how long is the first/only statement?
for (const budget of [1, 300, 600, 1000, 1500, 2500]) {
  await time(`engine-timeBudget-${budget}`, () => graphTraversal(pid, SYMBOL, { direction: "callers", maxDepth: 5, relationshipTypes: kinds, timeBudgetMs: budget }).then((r: any) => ({ callers: r.callers.length, timeBudgetExhausted: r.summary.timeBudgetExhausted, reason: r.summary.truncationReason, totalCallers: r.summary.totalCallers, callersIfUncapped: r.summary.callersIfUncapped })))
}
// Count walk with tiny clocks: how long is the level-0 statement?
for (const ceiling of [1, 300, 600, 1000, 1500, 2500]) {
  await time(`count-timeCeiling-${ceiling}`, () => {
    const c = countImpactDependents(raw, pid, rootRow.id, { maxDepth: 5, relationshipTypes: kinds, timeCeilingMs: ceiling })
    return { total: c.total, direct: c.direct, rowsScanned: c.rowsScanned, expansions: c.expansions, timedOut: c.timedOut, hitScanCeiling: c.hitScanCeiling }
  })
}
// A default count walk, to see the level breakdown cost.
await time("count-default", () => { const c = countImpactDependents(raw, pid, rootRow.id, { maxDepth: 5, relationshipTypes: kinds }); return { total: c.total, rowsScanned: c.rowsScanned, expansions: c.expansions, timedOut: c.timedOut } })
// Engine walk without a clock.
await time("engine-no-clock", () => graphTraversal(pid, SYMBOL, { direction: "callers", maxDepth: 5, relationshipTypes: kinds }).then((r: any) => ({ callers: r.callers.length, reason: r.summary.truncationReason })))

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), symbol: SYMBOL, rows }, null, 2) + "\n")
console.log("FLOORS_DONE")
