// Dump the orphan engine's findings for one tier, for order-vs-set comparisons between
// two physical copies of the same bytes (e.g. with and without the covering index).
import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { detectOrphans } from "../../../../src/intelligence/patterns/orphans"
import { BrainDatabase } from "../../../../src/brain/database"
const [projectDir, outPath] = process.argv.slice(2)
if (!projectDir || !outPath) { console.error("usage: orphans-dump.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)
const report = await detectOrphans(projectId as any, { minConfidence: 0, maxResults: 5000 } as any)
const findings = report.findings.map((f: any) => ({ type: f.type, file: f.location?.file, line: f.location?.line, symbol: f.location?.symbol, confidence: f.confidence, severity: f.severity, description: f.description, evidence: f.evidence, limitations: f.limitations }))
writeFileSync(outPath, JSON.stringify({ findings, summary: report.summary }, null, 1) + "\n")
BrainDatabase.closeAll()
