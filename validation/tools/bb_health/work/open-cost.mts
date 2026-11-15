// Split the default-call latency into "database open" and "report work".
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const projectId = getProjectId(REPO)
const out: any[] = []
for (let i = 0; i < 3; i++) {
  const t0 = process.hrtime.bigint()
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const openMs = Number(process.hrtime.bigint() - t0) / 1e6
  const t1 = process.hrtime.bigint()
  const r = await getUnifiedHealth(projectId, REPO, {})
  const providerMs = Number(process.hrtime.bigint() - t1) / 1e6
  out.push({ openMs: Math.round(openMs), providerMs: Math.round(providerMs), reportTotalMs: r.timing.totalMs, aggregatesMs: r.timing.aggregatesMs, freshnessMs: r.timing.freshnessMs })
}
console.log(JSON.stringify(out, null, 2))
