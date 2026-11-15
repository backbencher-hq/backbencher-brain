import { getProjectId } from "../../../../src/cli/index"
import { generateMigrationPlans } from "../../../../src/intelligence/migration/migration-engine"
import { BrainDatabase } from "../../../../src/brain/database"
const dir = "/home/ishaq2321/mcp/backbencher-brain/test/fixtures/polyglot"
const projectId = getProjectId(dir)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const symbol = raw.prepare("SELECT s.id id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.name='basePrice' LIMIT 1").get(projectId) as any
const result = await generateMigrationPlans(projectId, { symbolNames: ["basePrice"], symbolIds: [symbol.id], paths: [], targetLanguage: "python" })
console.log(JSON.stringify({ plans: result.plans.length, symbolIds: result.plans.map((p: any) => p.symbolId), unsupported: result.unsupported.length, truncation: result.truncation }))
