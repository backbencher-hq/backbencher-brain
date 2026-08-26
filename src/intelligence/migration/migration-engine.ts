import { CrossLanguageIntelligence } from "../../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../../ast/cross-language-migration-assistant"

export interface MigrationRequest {
  symbolNames: string[]
  targetLanguage: string
}

export interface MigrationDependencyEdge {
  dependent: string
  dependency: string
  relationshipType: string
}

export interface MigrationDependencyGraph {
  edges: MigrationDependencyEdge[]
  unresolvedDependencies: Array<{ dependent: string; dependency: string; relationshipType: string }>
  cycles: string[][]
  orderingStatus: "complete" | "no-edges" | "partial" | "cyclic"
}

export interface MigrationMethodology {
  baseHours: number
  relationshipHours: number
  relationshipCount: number
  missingMappingHours: number
  missingMappingCount: number
  ordering: "dependency-first"
  deduplication: "relationship-id-or-structural-identity"
}

export type MigrationBatchUnsupportedReason = "missing-symbol" | "same-language" | "unsupported-target" | "unplannable"

export interface MigrationPlanResult {
  targetLanguage: string
  plans: any[]
  dependencyOrder: string[]
  dependencyGraph: MigrationDependencyGraph
  unsupported: Array<{ symbolName: string; reason: string; unsupportedReason: MigrationBatchUnsupportedReason }>
  methodology: MigrationMethodology
  truncation: { truncated: boolean; requested: number; returned: number }
}

/**
 * Calculate migration methodology from structured plan evidence. Presentation
 * text is intentionally not an input. Relationship IDs are globally
 * deduplicated because one indexed edge may be attached to both planned
 * components.
 */
export function calculateMigrationMethodology(plans: Array<{
  relationshipEvidence?: Array<{ id: string; sourceSymbolId: string | null; targetSymbolId: string | null; relationshipType: string }>
  dependencies?: Array<{ confidence?: number }>
}>): MigrationMethodology {
  const relationshipIds = new Set<string>()
  let missingMappingCount = 0
  for (const plan of plans) {
    for (const relationship of plan.relationshipEvidence ?? []) {
      const identity = relationship.id || [relationship.sourceSymbolId ?? "", relationship.targetSymbolId ?? "", relationship.relationshipType].join("|")
      relationshipIds.add(identity)
    }
    missingMappingCount += (plan.dependencies ?? []).filter((dependency) => (dependency.confidence ?? 0) < 0.5).length
  }
  return {
    baseHours: plans.length * 4,
    relationshipHours: relationshipIds.size * 2,
    relationshipCount: relationshipIds.size,
    missingMappingHours: missingMappingCount * 6,
    missingMappingCount,
    ordering: "dependency-first",
    deduplication: "relationship-id-or-structural-identity",
  }
}

/**
 * Compute a deterministic dependency-first order. A relationship source is
 * the dependent and its target is the dependency, so targets are emitted first.
 * Unresolved endpoints and cycles stay visible instead of being flattened into
 * an apparently valid order.
 */
export function computeDependencyOrder(symbolNames: string[], relationships: MigrationDependencyEdge[]): { order: string[]; graph: MigrationDependencyGraph } {
  const names = [...new Set(symbolNames)].filter(Boolean)
  const nameSet = new Set(names)
  const edges = [...new Map(
    relationships
      .filter((edge) => nameSet.has(edge.dependent) && nameSet.has(edge.dependency) && edge.dependent !== edge.dependency)
      .map((edge) => [`${edge.dependent}|${edge.dependency}|${edge.relationshipType}`, edge]),
  ).values()].sort((a, b) => `${a.dependent}|${a.dependency}|${a.relationshipType}`.localeCompare(`${b.dependent}|${b.dependency}|${b.relationshipType}`))
  const unresolvedDependencies = relationships
    .filter((edge) => nameSet.has(edge.dependent) && !nameSet.has(edge.dependency))
    .map((edge) => ({ ...edge }))
    .sort((a, b) => `${a.dependent}|${a.dependency}|${a.relationshipType}`.localeCompare(`${b.dependent}|${b.dependency}|${b.relationshipType}`))
  const outgoing = new Map<string, Set<string>>(names.map((name) => [name, new Set()]))
  const indegree = new Map<string, number>(names.map((name) => [name, 0]))
  for (const edge of edges) {
    const dependents = outgoing.get(edge.dependency)!
    if (dependents.has(edge.dependent)) continue
    dependents.add(edge.dependent)
    indegree.set(edge.dependent, (indegree.get(edge.dependent) ?? 0) + 1)
  }
  const ready = names.filter((name) => indegree.get(name) === 0).sort()
  const order: string[] = []
  while (ready.length) {
    const current = ready.shift()!
    order.push(current)
    for (const dependent of [...(outgoing.get(current) ?? [])].sort()) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) {
        ready.push(dependent)
        ready.sort()
      }
    }
  }

  const cycles: string[][] = []
  const state = new Map<string, "unvisited" | "active" | "done">(names.map((name) => [name, "unvisited"]))
  const stack: string[] = []
  const seenCycles = new Set<string>()
  const visit = (name: string) => {
    state.set(name, "active")
    stack.push(name)
    for (const dependent of [...(outgoing.get(name) ?? [])].sort()) {
      if (state.get(dependent) === "unvisited") visit(dependent)
      else if (state.get(dependent) === "active") {
        const start = stack.indexOf(dependent)
        const cycle = stack.slice(start)
        const key = [...cycle].sort().join("|")
        if (!seenCycles.has(key)) { seenCycles.add(key); cycles.push([...cycle].sort()) }
      }
    }
    stack.pop()
    state.set(name, "done")
  }
  for (const name of names.sort()) if (state.get(name) === "unvisited") visit(name)
  cycles.sort((a, b) => a.join("|").localeCompare(b.join("|")))
  const orderingStatus = cycles.length ? "cyclic" : unresolvedDependencies.length ? (order.length ? "partial" : "no-edges") : edges.length ? "complete" : "no-edges"
  return { order, graph: { edges, unresolvedDependencies, cycles, orderingStatus } }
}

export async function generateMigrationPlans(projectId: string, request: MigrationRequest): Promise<MigrationPlanResult> {
  const names = [...new Set(request.symbolNames.map((name) => String(name).trim()).filter(Boolean))].slice(0, 100)
  const normalizedTargetLanguage = String(request.targetLanguage ?? "").trim().toLowerCase()
  const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId as any)
  const symbolsByName = new Map(analysis.crossLanguageSymbols.map((symbol: any) => [String(symbol.name).toLowerCase(), symbol]))
  const plans: any[] = []
  const unsupported: MigrationPlanResult["unsupported"] = []
  for (const symbolName of names) {
    const plan = await CrossLanguageMigrationAssistant.generateMigrationPlan(symbolName, request.targetLanguage, analysis)
    if (plan) plans.push(plan)
    else {
      const symbol = symbolsByName.get(symbolName.toLowerCase()) as any
      const source = String(symbol?.languages?.[0] ?? "").trim().toLowerCase()
      const unsupportedReason: MigrationBatchUnsupportedReason = !symbol
        ? "missing-symbol"
        : source === normalizedTargetLanguage
          ? "same-language"
          : !normalizedTargetLanguage
            ? "unsupported-target"
            : "unplannable"
      unsupported.push({ symbolName, reason: `migration is ${unsupportedReason}`, unsupportedReason })
    }
  }
  const planNames = plans.map((plan) => plan.componentName)
  const idsByName = new Map<string, Set<string>>()
  for (const symbol of analysis.crossLanguageSymbols) {
    if (!planNames.includes(symbol.name)) continue
    const ids = idsByName.get(symbol.name) ?? new Set<string>()
    ids.add(symbol.id)
    idsByName.set(symbol.name, ids)
  }
  const nameById = new Map<string, string>()
  for (const [name, ids] of idsByName) for (const id of ids) nameById.set(id, name)
  const graphRelationships: MigrationDependencyEdge[] = []
  for (const relationship of analysis.crossLanguageRelationships) {
    const dependent = relationship.source.symbolId ? nameById.get(relationship.source.symbolId) : undefined
    const dependency = relationship.target.symbolId ? nameById.get(relationship.target.symbolId) : undefined
    if (dependent && dependency) graphRelationships.push({ dependent, dependency, relationshipType: String(relationship.type) })
  }
  const { order: dependencyOrder, graph: dependencyGraph } = computeDependencyOrder(planNames, graphRelationships)
  const methodology = calculateMigrationMethodology(plans)
  return { targetLanguage: normalizedTargetLanguage, plans, dependencyOrder, dependencyGraph, unsupported, methodology, truncation: { truncated: request.symbolNames.length > names.length, requested: request.symbolNames.length, returned: names.length } }
}

export function formatMigrationPlans(result: MigrationPlanResult, format: "text" | "json" = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [`migration target: ${result.targetLanguage}`, `dependency order: ${result.dependencyOrder.join(" -> ") || "none"} (${result.dependencyGraph.orderingStatus})`, `methodology: base=${result.methodology.baseHours}h relationships=${result.methodology.relationshipHours}h missing-mappings=${result.methodology.missingMappingHours}h`, `truncated: ${result.truncation.truncated} (${result.truncation.returned}/${result.truncation.requested})`]
  if (result.dependencyGraph.unresolvedDependencies.length) lines.push(`unresolved dependencies: ${result.dependencyGraph.unresolvedDependencies.map((edge) => `${edge.dependent} -> ${edge.dependency}`).join(", ")}`)
  if (result.dependencyGraph.cycles.length) lines.push(`dependency cycles: ${result.dependencyGraph.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`)
  for (const plan of result.plans) lines.push(`\n${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}`, `effort=${plan.effortEstimateHours}h complexity=${plan.complexityScore}/10 risk=${plan.riskAssessment?.level}`, ...(plan.dependencies ?? []).map((dependency: any) => `  ${dependency.source} -> ${dependency.target} (${Math.round((dependency.confidence ?? 0) * 100)}%)`))
  if (result.unsupported.length) lines.push("\nunsupported:\n" + result.unsupported.map((item) => `  ${item.symbolName}: ${item.reason}`).join("\n"))
  return lines.join("\n")
}
