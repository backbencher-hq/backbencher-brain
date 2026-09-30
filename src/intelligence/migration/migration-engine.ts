import { CrossLanguageMigrationAssistant } from "../../ast/cross-language-migration-assistant"
import { loadMigrationContext } from "./migration-source"

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

export interface MigrationPlanResult {
  targetLanguage: string
  plans: any[]
  /** Aggregated evidence split across every plan in the request. */
  evidenceTotals: {
    production: number
    test: number
    unresolvable: number
    /** Containment/export edges, shown but not charged. */
    structural: number
    crossLanguage: number
    withLine: number
    withConfidence: number
  }
  dependencyOrder: string[]
  /** The order grouped into parallel-workable layers; waves[0] can start now. */
  waves: string[][]
  /**
   * How much of the integration surface this request actually covers.
   *
   * Measured on cobra, the number that motivated this: for requests of 1, 2, 4,
   * 8 and 16 symbols, 99.8%, 99.6%, 99.4%, 99.4% and 98.6% of the cited
   * integration points have their OTHER endpoint outside the requested set. The
   * tool was printing a confident effort total for what is, in effect, one to
   * two per cent of the work. `completeness` is the in-scope ratio and
   * `outOfScope` names the gap instead of absorbing it into a total.
   */
  scope: {
    integrationPoints: number
    inScope: number
    outOfScope: number
    unresolvable: number
    /** inScope / integrationPoints, 0..1; null when no edges are indexed at all. */
    completeness: number | null
    statement: string
  }
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
    /**
     * The names the 100-symbol cap dropped, in request order. Without this a
     * caller learns only that 30 names vanished, and cannot tell which — so a
     * migration wave that silently excluded a component looks identical to one
     * that included it. Bounded by the cap itself.
     */
    cappedNames: string[]
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
  relationshipEvidence?: Array<{ id: string; sourceSymbolId: string | null; targetSymbolId: string | null; relationshipType: string; endpointsResolved?: boolean; isIntegrationPoint?: boolean }>
  dependencies?: Array<{ confidence?: number }>
}>): MigrationMethodology {
  const relationshipIds = new Set<string>()
  let missingMappingCount = 0
  for (const plan of plans) {
    for (const relationship of plan.relationshipEvidence ?? []) {
      // This MUST be the same chargeability rule the per-plan effort uses, or the
      // two views disagree. It did once: the per-plan figure had started
      // excluding structural edges and this still counted them, which made the
      // batch total LARGER than the sum of its own parts and produced a
      // "shared relationship hours" figure of MINUS FOUR.
      //
      // Not charged, for two reasons: an endpoint that is not an indexed symbol
      // (the edge cannot be located, planned or done), and a structural edge
      // (`contains`/`exports`, which records nesting or declaration rather than a
      // call to update). Both flags are absent on legacy callers, where an absent
      // flag means "charge it" so this stays a pure narrowing.
      if (relationship.endpointsResolved === false) continue
      if (relationship.isIntegrationPoint === false) continue
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

/**
 * Group the dependency order into migration WAVES: the sets a team can work on
 * in parallel, in the order they unblock each other.
 *
 * A dependency-first total order is not an answer to "where do we start". A team
 * wants the first batch. Wave 0 holds every requested symbol with no unresolved
 * in-scope dependency; wave n holds those that become startable only after
 * wave n-1.
 *
 * Derived arithmetic over the same edge set the order uses — no new constants
 * and no new claim. If the graph is cyclic, a cycle's members land in whichever
 * wave their other dependencies put them, so `orderingStatus` must be read
 * alongside: a cyclic graph does not decompose into waves.
 */
export function computeMigrationWaves(order: string[], relationships: MigrationDependencyEdge[]): string[][] {
  const position = new Map<string, number>()
  order.forEach((name, index) => position.set(name, index))
  const depth = new Map<string, number>()
  for (const name of order) {
    let d = 0
    for (const edge of relationships) {
      if (edge.dependent !== name) continue
      // Only an IN-SCOPE, resolvable dependency can push a wave. An edge to a
      // symbol outside the request is a SCOPE GAP, not an ordering constraint —
      // treating it as one would park every component behind a dependency the
      // caller never asked to migrate.
      if (!position.has(edge.dependency)) continue
      d = Math.max(d, (depth.get(edge.dependency) ?? 0) + 1)
    }
    depth.set(name, d)
  }
  const waves: string[][] = []
  for (const name of order) {
    const d = depth.get(name) ?? 0
    while (waves.length <= d) waves.push([])
    waves[d].push(name)
  }
  return waves
}

export async function generateMigrationPlans(projectId: string, request: MigrationRequest): Promise<MigrationPlanResult> {
  const requestedNames = request.symbolNames.map((name) => String(name).trim()).filter(Boolean)
  // Deduplicate CASE-SENSITIVELY, preserving the caller's spelling.
  //
  // This used to lowercase before planning, which destroyed the one piece of
  // information that distinguishes two real components: Go (and most languages)
  // treat `Execute` and `execute` as different functions in the same file. Asking
  // for `Dual` returned a plan for `dual`. The planner resolves a name
  // case-insensitively and prefers an EXACT match, which is the right place for
  // that decision — it has the candidate list, and this layer does not.
  const uniqueNames = [...new Set(requestedNames)]
  const names = uniqueNames.slice(0, 100)
  const normalizedTargetLanguage = String(request.targetLanguage ?? "").trim().toLowerCase()
  // Bounded load: the requested symbols and the relationships that touch them.
  // The previous call loaded and reconstructed every symbol, relationship and
  // taint flow in the project on every invocation — measured 2342 ms for ONE
  // symbol on a 1216-symbol repository, flat in the request size — and supplied
  // only four of the fourteen relationship columns the index stores.
  const context = await loadMigrationContext(projectId, names)
  const analysis: CrossLanguageMigrationAssistant.MigrationSource = {
    symbols: context.requestedSymbols,
    relationships: context.relationships,
    nameById: context.nameById,
    fileById: context.fileById,
  }
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
  // `nameById` is the loader's map, which already covers the requested symbols
  // AND the far endpoints of their relationships. Round 1 rebuilt this with a
  // linear `crossLanguageSymbols.find(...)` inside the edge loop — O(RxS), which
  // is 5228 x 1216 comparisons on cobra.
  const nameById = context.nameById

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
  const externalName = (external: string | null | undefined, symbolId: string | null): string | null => {
    if (symbolId) return nameById.get(symbolId) ?? null
    const named = String(external ?? "").trim()
    return named ? named : null
  }
  for (const relationship of context.relationships) {
    const sourceId = relationship.sourceSymbolId
    const targetId = relationship.targetSymbolId
    if (!plannedIds.has(sourceId ?? "") && !plannedIds.has(targetId ?? "")) continue
    const dependent = externalName(relationship.sourceExternal, sourceId)
    const dependency = externalName(relationship.targetExternal, targetId)
    // A relationship between two planned symbols is an orderable edge. A
    // relationship from a planned symbol to something not requested is
    // unresolved: naming the endpoint is honest; dropping it is a silent gap.
    if (dependent && dependency) {
      if (dependent !== dependency) graphRelationships.push({ dependent, dependency, relationshipType: relationship.type })
      continue
    }
    // One endpoint is outside the requested set. Naming it is honest; the
    // previous code named it with the raw symbol id, which tells a reader
    // nothing they can look up.
    if (dependent && !dependency) {
      const endpoint = String(relationship.targetExternal ?? targetId ?? "").trim()
      if (endpoint) graphRelationships.push({ dependent, dependency: endpoint, relationshipType: relationship.type })
    } else if (dependency && !dependent) {
      const endpoint = String(relationship.sourceExternal ?? sourceId ?? "").trim()
      if (endpoint) graphRelationships.push({ dependent: endpoint, dependency, relationshipType: relationship.type })
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

  // Scope completeness: an integration point is IN scope when its other endpoint
  // is one of the requested symbols. Everything else is a caller the caller did
  // not ask about, and a port that ignores them does not work.
  const requestedIds = new Set(plans.map((plan) => plan.symbolId))
  let scopeIntegrationPoints = 0
  let scopeInScope = 0
  let scopeUnresolvable = 0
  for (const plan of plans) {
    for (const edge of plan.relationshipEvidence ?? []) {
      if (edge.isIntegrationPoint === false) continue
      scopeIntegrationPoints++
      if (edge.endpointsResolved !== true) {
        scopeUnresolvable++
        continue
      }
      const other = edge.sourceSymbolId === plan.symbolId ? edge.targetSymbolId : edge.sourceSymbolId
      if (other && requestedIds.has(other)) scopeInScope++
    }
  }
  const scopeOutOfScope = scopeIntegrationPoints - scopeInScope
  const completeness = scopeIntegrationPoints ? scopeInScope / scopeIntegrationPoints : null
  const scopeStatement =
    scopeIntegrationPoints === 0
      ? "no integration points are indexed for these components, so this request covers no known integration surface"
      : completeness !== null && completeness < 0.5
        ? `${scopeInScope} of ${scopeIntegrationPoints} integration points (${(completeness * 100).toFixed(1)}%) are inside this request; ${scopeOutOfScope} belong to components that were not asked for, so these plans alone are NOT a complete migration`
        : `${scopeInScope} of ${scopeIntegrationPoints} integration points (${((completeness ?? 0) * 100).toFixed(1)}%) are inside this request`

  // The per-edge evidence split, aggregated. A flat per-edge cost makes a plan
  // look enormous when most of its edges are test callers: measured 55.3% on
  // cobra. Reporting the split is what makes the number interpretable.
  const evidenceTotals = plans.reduce(
    (acc, plan) => {
      const b = plan.evidenceBreakdown
      if (!b) return acc
      acc.production += b.production ?? 0
      acc.test += b.test ?? 0
      acc.unresolvable += b.unresolvable ?? 0
      acc.structural += b.structural ?? 0
      acc.crossLanguage += b.crossLanguage ?? 0
      acc.withLine += b.withLine ?? 0
      acc.withConfidence += b.withConfidence ?? 0
      return acc
    },
    { production: 0, test: 0, unresolvable: 0, structural: 0, crossLanguage: 0, withLine: 0, withConfidence: 0 },
  )

  return {
    targetLanguage: normalizedTargetLanguage,
    plans,
    evidenceTotals,
    dependencyOrder,
    waves: computeMigrationWaves(dependencyOrder, graphRelationships),
    scope: {
      integrationPoints: scopeIntegrationPoints,
      inScope: scopeInScope,
      outOfScope: scopeOutOfScope,
      unresolvable: scopeUnresolvable,
      completeness,
      statement: scopeStatement,
    },
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
          : sharedRelationshipHours > 0
            ? `per-plan effort sums to ${perPlanSumHours}h; ${sharedRelationshipHours}h of that is relationship time on edges cited by more than one plan, counted once in the ${totalHours}h methodology total`
            : // Defensive: a NEGATIVE gap means the two views disagree, which is a
              // defect in the chargeability rule rather than a fact about the
              // request. Say so instead of printing "minus 4h of shared time".
              `INTERNAL MISMATCH: per-plan effort sums to ${perPlanSumHours}h but the methodology total is ${totalHours}h; the two views disagree and the total is not trustworthy`,
    },
    truncation: {
      truncated: deduplicated > 0 || capped > 0,
      requested: requestedNames.length,
      returned: names.length,
      deduplicated,
      capped,
      // `names` is the deduplicated list, so the dropped ones are the tail of
      // the DEDUPLICATED request, in the order the caller sent them.
      cappedNames: uniqueNames.slice(100),
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
    // The scope line goes near the TOP, not in a footnote: a total effort number
    // read without it is the number most likely to be quoted in a plan and acted
    // on. Measured on cobra, this line is the difference between "328h" and
    // "328h, for 0.2% of the surface".
    `scope: ${result.scope.statement}`,
    ...(result.waves.length ? [`waves: ${result.waves.map((wave, i) => `${i + 1}[${wave.join(", ")}]`).join(" -> ")}`] : []),
    `truncated: ${result.truncation.truncated} (${result.truncation.returned}/${result.truncation.requested}; ${result.truncation.deduplicated} duplicate, ${result.truncation.capped} over the 100-symbol cap)` +
      (result.truncation.cappedNames.length
        ? `\ndropped by the cap, NOT planned: ${result.truncation.cappedNames.slice(0, 20).join(", ")}${result.truncation.cappedNames.length > 20 ? `, … and ${result.truncation.cappedNames.length - 20} more` : ""}`
        : ""),
  ]
  const totals = result.evidenceTotals
  if (totals && (totals.production || totals.test || totals.unresolvable || totals.structural || totals.crossLanguage)) {
    // The split is what makes a flat per-edge cost interpretable: on cobra, 55.3%
    // of a plan's edges are test callers, and an undifferentiated number reads
    // as "this function is enormous" when it is "this function is well tested".
    lines.push(
      `evidence: ${totals.production} production integration point(s), ${totals.test} test, ${totals.crossLanguage} crossing a language boundary` +
        (totals.structural ? `, ${totals.structural} structural (containment/export, not charged)` : "") +
        (totals.unresolvable ? `, ${totals.unresolvable} with an unresolvable endpoint (not charged)` : "") +
        (totals.withLine ? `; ${totals.withLine} carry a line` : "; no edge carries a line"),
    )
  }
  if (result.dependencyGraph.unresolvedDependencies.length) lines.push(`unresolved dependencies: ${result.dependencyGraph.unresolvedDependencies.map((edge) => `${edge.dependent} -> ${edge.dependency}`).join(", ")}`)
  if (result.dependencyGraph.cycles.length) lines.push(`dependency cycles: ${result.dependencyGraph.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`)

  for (const plan of result.plans) {
    lines.push(
      `\n${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}  [${plan.sourceFile}]`,
      `effort=${plan.effortEstimateHours}h complexity=${plan.complexityScore}/10 risk=${plan.riskAssessment?.level}`,
    )
    // F21: the text output used to print `risk=High` and never the reason, so a
    // reader of the DEFAULT format could not act on the band. The factors are
    // the explanation and they belong next to the band.
    for (const factor of plan.riskAssessment?.factors ?? []) lines.push(`  why: ${factor}`)
    for (const dependency of plan.dependencies ?? []) {
      lines.push(`  ${dependency.source} -> ${dependency.target} (${Math.round((dependency.confidence ?? 0) * 100)}%, indexed import)`)
    }
    for (const guess of plan.inferredDependencies ?? []) {
      lines.push(`  ${guess.source} -> (${guess.target ?? "no registered equivalence"}) — name-based guess, not an observed import; excluded from effort and risk`)
    }
    if (!(plan.dependencies ?? []).length && !(plan.inferredDependencies ?? []).length) {
      lines.push(
        plan.dependencyProvenance?.importEvidence === "unavailable"
          ? "  library dependencies UNKNOWN: the index records no imports for this component (not the same as 'none')"
          : "  no library evidence: the index carries no imports for this component",
      )
    }
    const b = plan.evidenceBreakdown
    if (b) {
      const cross = b.crossLanguage > 0 ? `, ${b.crossLanguage} cross-language` : ""
      const structural = b.structural ? `, ${b.structural} structural` : ""
      lines.push(`  evidence: ${b.production} production + ${b.test} test integration points${cross}${structural}${b.unresolvable ? `, ${b.unresolvable} unresolvable` : ""}`)
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
