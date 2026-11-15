import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const projectId = getProjectId(REPO)
await BrainDatabase.getRawInstance(projectId, { readonly: true })
await getUnifiedHealth(projectId, REPO, {})
const t0 = performance.now()
const r = await getUnifiedHealth(projectId, REPO, {})
console.log("wall", Math.round(performance.now() - t0), "reportTotal", r.timing.totalMs)
