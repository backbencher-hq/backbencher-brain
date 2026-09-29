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

export type MigrationBatchUnsupportedReason =
  | "missing-symbol"
  | "same-language"
  | "unsupported-target"
  | "unsupported-source"
  | "ambiguous-symbol"
  | "unplannable"

export interface MigrationPlanResult {
  targetLanguage: string
  plans: any[]
  dependencyOrder: string[]
  dependencyGraph: MigrationDependencyGraph
  unsupported: Array<{
    symbolName: string
    reason: string
    unsupportedReason: MigrationBatchUnsupportedReason
    candidates?: Array<{ id: string; name: string; language: string; file: string }>
  }>
  methodology: MigrationMethodology
  /**
   * Two independent reductions of the request, reported separately because they
   * have different causes and a caller needs to tell them apart: `deduplicated`
   * names were merged (the same name asked for twice), `capped` names were
   * dropped by the 100-symbol limit.
   */
  truncation: {
    truncated: boolean
    requested: number
    returned: number
    deduplicated: number
    capped: number
  }
  /**
   * The single authoritative effort figure for the whole request. Per-plan
   * `effortEstimateHours` is a per-plan view and legitimately double-counts a
   * relationship cited by two plans; this total is the deduplicated one, and the
   * formatter prints the reconciliation rather than two disagreeing numbers.
   */
  effort: {
    totalHours: number
    perPlanSumHours: number
    sharedRelationshipHours: number
    reconciliation: string
  }
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
  // `partial` means "some dependency could not be placed". That includes the case
  // where NO edge could be placed but unresolved dependencies exist: the old
  // ternary reported `no-edges` there because `order.length` was 0, which reads
  // as "this component has no dependencies" when the truth is "every dependency
  // sits outside the requested set". `no-edges` is reserved for a request with
  // genuinely no relationships at all.
  const orderingStatus = cycles.length
    ? "cyclic"
    : edges.length === 0 && unresolvedDependencies.length === 0
      ? "no-edges"
      : unresolvedDependencies.length || order.length !== names.length
        ? "partial"
        : "complete"
  return { order, graph: { edges, unresolvedDependencies, cycles, orderingStatus } }
}

export async function generateMigrationPlans(projectId: string, request: MigrationRequest): Promise<MigrationPlanResult> {
  const requestedNames = request.symbolNames.map((name) => String(name).trim()).filter(Boolean)
  const uniqueNames = [...new Set(requestedNames.map((name) => name.toLowerCase()))]
  const names = uniqueNames.slice(0, 100)
  const normalizedTargetLanguage = String(request.targetLanguage ?? "").trim().toLowerCase()
  const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId as any)
  const plans: any[] = []
  const unsupported: MigrationPlanResult["unsupported"] = []
  // Refusals come from the planner itself now. The previous code called the
  // null-returning wrapper and then re-derived the reason from a SECOND,
  // independent name lookup, so the reason shown and the plan computed could
  // come from different resolutions of the same name.
  for (const symbolName of names) {
    const outcome = await CrossLanguageMigrationAssistant.planMigration(symbolName, request.targetLanguage, analysis)
    if (outcome.ok) {
      plans.push(outcome.plan)
      continue
    }
    const entry: MigrationPlanResult["unsupported"][number] = {
      symbolName,
      reason: outcome.refusal.detail,
      unsupportedReason: outcome.refusal.reason,
    }
    if (outcome.refusal.candidates) entry.candidates = outcome.refusal.candidates
    unsupported.push(entry)
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

  // Every indexed relationship touching a planned symbol. A planned symbol that
  // is called by a symbol the caller did NOT request is a real, named
  // dependency the order cannot satisfy — that is what `unresolvedDependencies`
  // is for, and the previous engine only pushed edges where BOTH endpoints were
  // planned, so the `partial` ordering status was unreachable in production.
  const plannedIds = new Set<string>()
  for (const plan of plans) {
    if (plan.symbolId) plannedIds.add(plan.symbolId)
    for (const evidence of plan.relationshipEvidence ?? []) {
      if (evidence.sourceSymbolId) plannedIds.add(evidence.sourceSymbolId)
      if (evidence.targetSymbolId) plannedIds.add(evidence.targetSymbolId)
    }
  }
  const graphRelationships: MigrationDependencyEdge[] = []
  for (const relationship of analysis.crossLanguageRelationships) {
    const sourceId = relationship.source?.symbolId
    const targetId = relationship.target?.symbolId
    if (!sourceId || !targetId) continue
    if (!plannedIds.has(sourceId) && !plannedIds.has(targetId)) continue
    const dependent = nameById.get(sourceId)
    const dependency = nameById.get(targetId)
    // A relationship between two planned symbols is an orderable edge. A
    // relationship from a planned symbol to something not requested is
    // unresolved: naming the endpoint is honest; dropping it is a silent gap.
    if (dependent && dependency && dependent !== dependency) {
      graphRelationships.push({ dependent, dependency, relationshipType: String(relationship.type) })
    } else if (dependent && !dependency) {
      const endpoint = analysis.crossLanguageSymbols.find((symbol: any) => symbol.id === sourceId) as any
      graphRelationships.push({
        dependent,
        dependency: String(endpoint?.name ?? targetId),
        relationshipType: String(relationship.type),
      })
    } else if (dependency && !dependent) {
      const endpoint = analysis.crossLanguageSymbols.find((symbol: any) => symbol.id === targetId) as any
      graphRelationships.push({
        dependent: String(endpoint?.name ?? sourceId),
        dependency,
        relationshipType: String(relationship.type),
      })
    }
  }
  const { order: dependencyOrder, graph: dependencyGraph } = computeDependencyOrder(planNames, graphRelationships)
  const methodology = calculateMigrationMethodology(plans)

  // One authoritative total, plus the arithmetic that reconciles it with the
  // per-plan figures a reader will add up.
  const perPlanSumHours = plans.reduce((sum, plan) => sum + (Number(plan.effortEstimateHours) || 0), 0)
  const totalHours = methodology.baseHours + methodology.relationshipHours + methodology.missingMappingHours
  const sharedRelationshipHours = perPlanSumHours - totalHours

  const deduplicated = requestedNames.length - uniqueNames.length
  const capped = uniqueNames.length - names.length

  return {
    targetLanguage: normalizedTargetLanguage,
    plans,
    dependencyOrder,
    dependencyGraph,
    unsupported,
    methodology,
    effort: {
      totalHours,
      perPlanSumHours,
      sharedRelationshipHours,
      reconciliation:
        sharedRelationshipHours === 0
          ? "per-plan effort sums to the methodology total"
          : `per-plan effort sums to ${perPlanSumHours}h; ${sharedRelationshipHours}h of that is relationship time on edges cited by more than one plan, counted once in the ${totalHours}h methodology total`,
    },
    truncation: {
      truncated: deduplicated > 0 || capped > 0,
      requested: requestedNames.length,
      returned: names.length,
      deduplicated,
      capped,
    },
  }
}

export function formatMigrationPlans(result: MigrationPlanResult, format: "text" | "json" = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [
    `migration target: ${result.targetLanguage}`,
    `dependency order: ${result.dependencyOrder.join(" -> ") || "none"} (${result.dependencyGraph.orderingStatus})`,
    `methodology: base=${result.methodology.baseHours}h relationships=${result.methodology.relationshipHours}h missing-mappings=${result.methodology.missingMappingHours}h`,
    // The authoritative figure, with the arithmetic that reconciles it against
    // the per-plan numbers printed below. Previously the header and the per-plan
    // `effort=` lines were both presented as totals and differed by 8h on a
    // two-symbol mutual-call request, with nothing explaining why.
    `total effort: ${result.effort.totalHours}h (${result.effort.reconciliation})`,
    `truncated: ${result.truncation.truncated} (${result.truncation.returned}/${result.truncation.requested}; ${result.truncation.deduplicated} duplicate, ${result.truncation.capped} over the 100-symbol cap)`,
  ]
  if (result.dependencyGraph.unresolvedDependencies.length) lines.push(`unresolved dependencies: ${result.dependencyGraph.unresolvedDependencies.map((edge) => `${edge.dependent} -> ${edge.dependency}`).join(", ")}`)
  if (result.dependencyGraph.cycles.length) lines.push(`dependency cycles: ${result.dependencyGraph.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`)
  for (const plan of result.plans) {
    lines.push(
      `\n${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}`,
      `effort=${plan.effortEstimateHours}h complexity=${plan.complexityScore}/10 risk=${plan.riskAssessment?.level}`,
    )
    for (const dependency of plan.dependencies ?? []) {
      lines.push(`  ${dependency.source} -> ${dependency.target} (${Math.round((dependency.confidence ?? 0) * 100)}%, indexed import)`)
    }
    // A guess is shown as a guess: never listed as a mapping, never in a number.
    for (const guess of plan.inferredDependencies ?? []) {
      lines.push(`  ${guess.source} -> (${guess.target ?? "no registered equivalence"}) — name-based guess, not an observed import; excluded from effort and risk`)
    }
    if (!(plan.dependencies ?? []).length && !(plan.inferredDependencies ?? []).length) {
      lines.push("  no library evidence: the index carries no imports for this component")
    }
  }
  if (result.unsupported.length) {
    lines.push("\nunsupported:")
    for (const item of result.unsupported) {
      lines.push(`  ${item.symbolName}: ${item.reason}`)
      for (const candidate of item.candidates ?? []) lines.push(`    candidate: ${candidate.name} (${candidate.language}) in ${candidate.file}`)
    }
  }
  return lines.join("\n")
}
