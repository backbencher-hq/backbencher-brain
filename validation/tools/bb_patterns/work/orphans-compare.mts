import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { detectOrphans as current } from "../../../../src/intelligence/patterns/orphans"
import { detectOrphans as committed } from "../../../../src/intelligence/patterns/orphans-head"
import { BrainDatabase } from "../../../../src/brain/database"
const [projectDir, outPath] = process.argv.slice(2)
const projectId = getProjectId(projectDir)
const a = await current(projectId as any, { minConfidence: 0, maxResults: 100 } as any)
const b = await committed(projectId as any, { minConfidence: 0, maxResults: 100 } as any)
writeFileSync(outPath, JSON.stringify({ current: a.findings, committed: b.findings }, null, 1) + "\n")
BrainDatabase.closeAll()
