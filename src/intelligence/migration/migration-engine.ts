import { CrossLanguageIntelligence } from "../../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../../ast/cross-language-migration-assistant"

export interface MigrationRequest {
  symbolNames: string[]
  targetLanguage: string
}

export interface MigrationPlanResult {
  targetLanguage: string
  plans: any[]
  dependencyOrder: string[]
  unsupported: Array<{ symbolName: string; reason: string }>
  methodology: { baseHours: number; relationshipHours: number; missingMappingHours: number; ordering: "dependency-first" }
  truncation: { truncated: boolean; requested: number; returned: number }
}

export async function generateMigrationPlans(projectId: string, request: MigrationRequest): Promise<MigrationPlanResult> {
  const names = [...new Set(request.symbolNames.map((name) => String(name).trim()).filter(Boolean))].slice(0, 100)
  const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId as any)
  const plans: any[] = []
  const unsupported: MigrationPlanResult["unsupported"] = []
  for (const symbolName of names) {
    const plan = await CrossLanguageMigrationAssistant.generateMigrationPlan(symbolName, request.targetLanguage, analysis)
    if (plan) plans.push(plan)
    else unsupported.push({ symbolName, reason: "symbol not found, same-language migration, or no supported mapping" })
  }
  const planNames = new Set(plans.map((plan) => plan.componentName))
  const dependencyOrder = [...plans].sort((a, b) => (a.dependencies?.length ?? 0) - (b.dependencies?.length ?? 0)).map((plan) => plan.componentName).filter((name, index, all) => all.indexOf(name) === index && planNames.has(name))
  const missingMappings = plans.reduce((total, plan) => total + (plan.dependencies ?? []).filter((dependency: any) => (dependency.confidence ?? 0) < 0.5).length, 0)
  const relationshipCount = plans.reduce((total, plan) => total + Math.max(0, ((plan.strategySteps ?? []).find((step: string) => step.includes("cross-boundary relationships"))?.match(/\d+/)?.[0] ? Number((plan.strategySteps ?? []).find((step: string) => step.includes("cross-boundary relationships"))?.match(/\d+/)?.[0]) : 0)), 0)
  return { targetLanguage: request.targetLanguage, plans, dependencyOrder, unsupported, methodology: { baseHours: plans.length * 4, relationshipHours: relationshipCount * 2, missingMappingHours: missingMappings * 6, ordering: "dependency-first" }, truncation: { truncated: request.symbolNames.length > names.length, requested: request.symbolNames.length, returned: names.length } }
}

export function formatMigrationPlans(result: MigrationPlanResult, format: "text" | "json" = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [`migration target: ${result.targetLanguage}`, `dependency order: ${result.dependencyOrder.join(" -> ") || "none"}`, `methodology: base=${result.methodology.baseHours}h relationships=${result.methodology.relationshipHours}h missing-mappings=${result.methodology.missingMappingHours}h`, `truncated: ${result.truncation.truncated} (${result.truncation.returned}/${result.truncation.requested})`]
  for (const plan of result.plans) lines.push(`\n${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}`, `effort=${plan.effortEstimateHours}h complexity=${plan.complexityScore}/10 risk=${plan.riskAssessment?.level}`, ...(plan.dependencies ?? []).map((dependency: any) => `  ${dependency.source} -> ${dependency.target} (${Math.round((dependency.confidence ?? 0) * 100)}%)`))
  if (result.unsupported.length) lines.push("\nunsupported:\n" + result.unsupported.map((item) => `  ${item.symbolName}: ${item.reason}`).join("\n"))
  return lines.join("\n")
}
