import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { detectIndexRules } from "../../../../src/intelligence/patterns/rules"
import { BrainDatabase } from "../../../../src/brain/database"
const [projectDir, outPath] = process.argv.slice(2)
const projectId = getProjectId(projectDir)
const r = await detectIndexRules(projectId as any, { confidenceThreshold: 0, maxResults: 1000, includeFramework: true, includeAntiPatterns: true } as any)
writeFileSync(outPath, JSON.stringify({ findings: r }, null, 1) + "\n")
BrainDatabase.closeAll()
