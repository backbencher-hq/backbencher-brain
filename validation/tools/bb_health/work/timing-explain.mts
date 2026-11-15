import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const projectId = getProjectId(REPO)
await BrainDatabase.getRawInstance(projectId, { readonly: true })
await getUnifiedHealth(projectId, REPO, {})
for (let i = 0; i < 3; i++) {
  const t0 = process.hrtime.bigint(); const d0 = Date.now()
  const r = await getUnifiedHealth(projectId, REPO, {})
  const t1 = process.hrtime.bigint(); const d1 = Date.now()
  console.log(JSON.stringify({ wallHrtime: Math.round(Number(t1 - t0) / 1e6), wallDate: d1 - d0, reportTotal: r.timing.totalMs, reportTimestampDelta: r.timestamp - d0 }))
}
