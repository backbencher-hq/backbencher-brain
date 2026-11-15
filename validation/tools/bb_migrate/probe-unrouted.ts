import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { generateMigrationPlans } from "../../../src/intelligence/migration/migration-engine"
import { CrossLanguageMigrationAssistant as MA } from "../../../src/ast/cross-language-migration-assistant"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const id = process.argv[2]!
const target = process.argv[3]!
const projectId = process.argv[4]!
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const symbol = raw.prepare("SELECT s.id, s.name, s.symbol_type, f.language, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.id=?").get(projectId, id) as any
const result = await generateMigrationPlans(projectId, { symbolNames: [], symbolIds: [id], targetLanguage: target })
const plan = result.plans[0]
console.log(JSON.stringify({ symbol, hasRoute: MA.hasMigrationRoute(String(symbol.language), target), plan: plan && { name: plan.componentName, source: plan.sourceLanguage, target: plan.targetLanguage, dependencies: plan.dependencies, inferred: plan.inferredDependencies, provenance: plan.dependencyProvenance, risk: plan.riskAssessment, effort: plan.effortEstimateHours } }, null, 1))
