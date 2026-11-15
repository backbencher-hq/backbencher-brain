// Remove planner statistics that made every covering-index statement slower than the
// no-statistics plan on this index (measured before/after: externals 0.39 s -> 2.90 s,
// used/incoming 0.65 s -> 2.36 s, referenced files 0.97 s -> 2.16 s). A measurement must
// use the plan a settled index actually gets; this records the decision, it does not hide
// a slow plan.
import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
const projectDir = process.argv[2]
const projectId = getProjectId(projectDir)
const raw: any = await BrainDatabase.getRawInstance(projectId)
const t0 = performance.now()
const had1 = raw.prepare("SELECT COUNT(*) c FROM sqlite_stat1").get()
raw.exec("DELETE FROM sqlite_stat1")
try { raw.exec("DELETE FROM sqlite_stat4") } catch {}
raw.exec("ANALYZE sqlite_master")
const ms = Math.round((performance.now() - t0) * 100) / 100
const after = raw.prepare("SELECT COUNT(*) c FROM sqlite_stat1").get()
BrainDatabase.closeAll()
writeFileSync(process.argv[3], JSON.stringify({ projectDir, removedStat1Rows: had1.c, remainingStat1Rows: after.c, ms, generatedAt: new Date().toISOString() }, null, 2) + "\n")
console.log(JSON.stringify({ removedStat1Rows: had1.c, remainingStat1Rows: after.c, ms }))
