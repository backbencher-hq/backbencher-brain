import { CrossLanguageMigrationAssistant } from "../../ast/cross-language-migration-assistant"
import { loadMigrationContextForSymbols, resolveMigrationSymbols } from "./migration-source"

export interface MigrationRequest {
  symbolNames: string[]
  targetLanguage: string
  /**
   * Indexed symbol ids. The only unambiguous way to name a component, and what
   * the ambiguity refusal points at when it reports that a name matches several
   * symbols.
   */
  symbolIds?: string[]
  /**
   * Project-relative file or DIRECTORY paths. Every indexed symbol in them joins
   * the request, so "plan the migration of src/api" is one call rather than a
   * hand-picked list of names.
   *
   * This is the shape a real programme is planned in, and it was missing: until
   * it existed the only way to ask the tool about a module was to enumerate its
   * symbols by hand, and the result was indistinguishable from a deliberately
   * chosen cohort.
   */
  paths?: string[]
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
  /**
   * What the request RESOLVED TO, and the cost rolled up per file and per wave.
   *
   * A plan costs one symbol; a migration costs a cohort. Before this there was
   * no way to ask for the cost of a module, a directory, or a wave — the shape
   * a real programme is actually planned in.
   *
   * `effortHours` per group is the sum of that group's PER-PLAN effort, so a
   * relationship cited by two symbols in the same group is counted in both. It
   * is labelled `perPlanSumHours` at the batch level for the same reason; the
   * deduplicated figure is `effort.totalHours` and the two are reconciled there.
   */
  cohort: {
    /** Indexed symbols the request resolved to, before the cap. */
    symbolsResolved: number
    pathsRequested: string[]
    pathsUnmatched: string[]
    filesCovered: number
    /**
     * What this call READ, against what the project holds. A wall-clock claim
     * that "it did not load everything" passes on a quiet machine and fails on a
     * busy one; this is checkable anywhere.
     */
    work: {
      symbolsLoaded: number
      relationshipsLoaded: number
      projectSymbols: number
      projectRelationships: number
    }
    byFile: Array<{
      file: string
      symbols: number
      perPlanSumHours: number
      productionIntegrationPoints: number
      testIntegrationPoints: number
    }>
    byWave: Array<{ wave: number; symbols: number; perPlanSumHours: number }>
    /**
     * The waves keyed by SYMBOL, where every plan appears exactly once. `waves`
     * renders names and disambiguates a name two files share by appending the
     * file; this is the same partition with the identity a caller can index.
     */
    wavePlan: Array<{ wave: number; symbols: Array<{ symbolId: string; name: string; file: string; line: number | null }> }>
    /**
     * What the cohort actually CONTAINS, by indexed source language. A cohort
     * scoped to a project root is often mostly YAML and Markdown; without this,
     * "0 plans" and "100 YAML documents" are indistinguishable from the summary.
     */
    byLanguage: Array<{ language: string; symbols: number; processed: number; planned: number; refused: number }>
    /** Requested components that produced no plan, by refusal reason. */
    refusedByReason: Array<{ reason: string; count: number; example: string }>
    statement: string
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
    /** Distinct symbols the request RESOLVED to, before the cap. */
    requested: number
    returned: number
    /** Explicit names merged as duplicates. Never negative. */
    deduplicated: number
    /** Resolved symbols dropped by the cap. */
    capped: number
    /** How many resolved symbols came from a `paths` cohort rather than a name. */
    pathSymbols: number
    selection: string
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
  /**
   * The measured import split. `imports.unmapped` is a real third-party library
   * with no registered mapping — the exact case the missing-mapping charge exists
   * for, and it was counted from `dependencies`, which was ALWAYS EMPTY, so the
   * charge was structurally 0 on every plan this tool ever produced.
   */
  dependencyProvenance?: { imports?: { unmapped?: number; unmappedLibraries?: string[] } }
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
    // Counted from the MEASURED import split, not from `dependencies`. A plan with
    // no registered mapping and no uncertain guess previously contributed zero,
    // because both of those collections were empty whenever the index held no
    // import evidence — so a plan for a Go service using `pflag` reported zero
    // missing mappings while carrying an unported library.
    // Per LIBRARY NAME, not per specifier: a file importing `gin` and `gin/render`
    // declares two specifiers for one library, and charging both bills the research
    // twice.
    const measuredUnmapped = plan.dependencyProvenance?.imports?.unmappedLibraries
    if (Array.isArray(measuredUnmapped)) {
      missingMappingCount += measuredUnmapped.length
    } else {
      // A caller with no measured split (an older caller, or a synthetic plan) still
      // gets the uncertain-guess count it used to get.
      missingMappingCount += (plan.dependencies ?? []).filter((dependency) => (dependency.confidence ?? 0) < 0.5).length
    }
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
  const requestedPaths = (request.paths ?? []).map((p) => String(p).trim()).filter(Boolean)
  const requestedNames = request.symbolNames.map((name) => String(name).trim()).filter(Boolean)
  // Deduplicate CASE-SENSITIVELY, preserving the caller's spelling.
  //
  // This used to lowercase before planning, which destroyed the one piece of
  // information that distinguishes two real components: Go (and most languages)
  // treat `Execute` and `execute` as different functions in the same file. Asking
  // for `Dual` returned a plan for `dual`. The planner resolves a name
  // case-insensitively and prefers an EXACT match, which is the right place for
  // that decision — it has the candidate list, and this layer does not.
  // PHASE 1: resolve names and paths to a symbol list. No relationship is read
  // yet, so a directory with thousands of symbols costs one indexed pass rather
  // than the whole relationship graph.
  const requestedSymbolIds = (request.symbolIds ?? []).map((id) => String(id).trim()).filter(Boolean)
  const resolved = await resolveMigrationSymbols(projectId, requestedNames, requestedPaths, requestedSymbolIds)

  // THE REQUEST IS A LIST OF ENTRIES, NOT A LIST OF NAMES.
  //
  // A name is not a symbol's identity. Two components named `String` in two files
  // are two components, and the batch used to collapse them to one name and then
  // plan whichever the planner resolved first — the caller was never told. That is
  // invisible for a hand-picked list and corrosive for a cohort: measured on a
  // one-file cobra cohort, 100 distinct NAMES resolved to 209 SYMBOLS, so a cohort
  // could never plan more than 100 of the symbols it covered, and 109 of them were
  // unreachable with no report.
  //
  //   - a `paths` entry is a symbol ID, which is unambiguous by construction;
  //   - an explicit NAME stays a name, so the planner's single ambiguity rule
  //     (same-file case variants resolve; cross-file collisions refuse and name the
  //     candidates) still decides, and now names a capability that exists:
  //     `symbolIds`.
  //
  // A name whose every match is already covered by the cohort is dropped, so naming
  // a symbol AND the file that contains it still plans it once.
  const cohortIds = new Set(resolved.symbolsFromPaths.map((symbol) => symbol.id))
  const cohortNames = new Set(resolved.symbolsFromPaths.map((symbol) => String(symbol.name).toLowerCase()))
  const namesCoveredByCohort = (name: string): boolean => {
    const wanted = name.toLowerCase()
    const matches = resolved.symbols.filter((symbol) => String(symbol.name).toLowerCase() === wanted)
    return matches.length > 0 && matches.every((symbol) => cohortIds.has(symbol.id))
  }
  const nameEntries = requestedNames.filter((name) => !namesCoveredByCohort(name)).map((name) => ({ kind: "name" as const, name }))
  const symbolEntries = [
    ...resolved.symbolsFromPaths,
    ...resolved.symbolsById.filter((symbol) => !cohortIds.has(symbol.id)),
  ].map((symbol) => ({ kind: "symbol" as const, id: symbol.id, name: symbol.name, file: symbol.file }))
  const requestedEntries = [...nameEntries, ...symbolEntries]
  const entries = requestedEntries.slice(0, 100)
  const names = entries.map((entry) => entry.name)
  const normalizedTargetLanguage = String(request.targetLanguage ?? "").trim().toLowerCase()
  // Bounded load: the requested symbols and the relationships that touch them.
  // The previous call loaded and reconstructed every symbol, relationship and
  // taint flow in the project on every invocation — measured 2342 ms for ONE
  // symbol on a 1216-symbol repository, flat in the request size — and supplied
  // only four of the fourteen relationship columns the index stores.
  // PHASE 2: the relationship pass, over the ALREADY-CAPED set. This is the
  // bound the F18 finding asked for, and it has to happen after the cap.
  const keptSymbolIds = new Set(entries.filter((e) => e.kind === "symbol").map((e) => e.id))
  const keptNames = new Set(nameEntries.map((entry) => entry.name.toLowerCase()))
  const loadedSymbols = resolved.symbols.filter(
    (symbol) => keptSymbolIds.has(symbol.id) || keptNames.has(String(symbol.name).toLowerCase()),
  )
  const context = await loadMigrationContextForSymbols(projectId, loadedSymbols, resolved.pathResolution)
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
  for (const requested of entries) {
    const symbolName = requested.name
    const outcome =
      requested.kind === "symbol"
        ? await CrossLanguageMigrationAssistant.planMigrationById(requested.id, request.targetLanguage, analysis)
        : await CrossLanguageMigrationAssistant.planMigration(symbolName, request.targetLanguage, analysis)
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
  // An id that no indexed symbol carries is a REFUSAL, not an absence. It
  // previously vanished: no entry meant no plan meant no way to see it, so a
  // typo'd id produced a clean, empty, successful-looking result. Reported
  // through the same channel as every other refusal, so there is one place to
  // look and one place to count them.
  for (const id of resolved.idsUnmatched) {
    unsupported.push({
      symbolName: id,
      reason: `no indexed symbol carries the id "${id}"`,
      unsupportedReason: "missing-symbol",
    })
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

  // Truncation arithmetic, per source.
  //
  // This was written for a names-only request and went NEGATIVE the moment a
  // `paths` cohort was added: `requestedNames` was empty, so `deduplicated`
  // came out as `0 - 212 = -212 duplicates` and the header read `100/0`. A
  // duplicate count cannot be negative and a `returned/requested` of 100/0 is
  // meaningless, so the two reductions are now measured against the things they
  // actually reduce:
  //
  //   deduplicated — explicit NAMES merged, measured against the explicit names
  //   capped       — resolved SYMBOLS dropped, measured against the resolved set
  //
  // `requested` becomes the number of distinct symbols the request RESOLVED to,
  // which is the quantity a caller actually asked about — a cohort of 212 and a
  // hand-typed list of 212 are the same request.
  const distinctExplicitNames = new Set(requestedNames).size
  const deduplicated = requestedNames.length - distinctExplicitNames
  // The cap is over ENTRIES, which is what the planner actually iterates: a
  // symbol-id entry plans exactly one symbol, and a name entry plans one symbol
  // or refuses. `requested` is therefore the number of distinct components the
  // request asked about, which is the quantity a caller means by "requested".
  const capped = requestedEntries.length - entries.length
  // Counted from the resolution, not by subtraction: a symbol that is BOTH named
  // explicitly and covered by a path is one symbol contributed by the path, and
  // `uniqueNames.length - explicit` would report zero path symbols for a request
  // that got all of them from a path.
  const processedNames = new Set(names)
  const resolvedFromPaths = resolved.symbolsFromPaths.filter((symbol) => processedNames.has(symbol.name)).length

  // Scope completeness: an integration point is IN scope when its other endpoint
  // is one of the requested symbols. Everything else is a caller the caller did
  // not ask about, and a port that ignores them does not work.
  const scopePlannedIds = new Set(plans.map((plan) => plan.symbolId))
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
      if (other && scopePlannedIds.has(other)) scopeInScope++
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

  // Cohort rollup. Grouped by the plan's OWN file, and by the wave it landed in.
  // A file with zero planned symbols cannot appear here, so a partially-covered
  // cohort is visible as a short `byFile` rather than hidden.
  // `computeDependencyOrder` cannot emit a symbol that sits in a cycle: Kahn's
  // algorithm never reaches indegree 0 for it, so it is simply ABSENT from
  // `dependencyOrder`. Measured on a one-file cobra cohort, 26 of 88 planned
  // symbols were cycle members and therefore missing from `waves` entirely —
  // the wave plan silently under-reported the cohort it was describing.
  //
  // A cycle is a group that cannot be split: its members must be migrated
  // together. So they are collected into one trailing wave, which is the correct
  // semantic rather than a fudge, and it makes the wave plan account for every
  // planned symbol.
  const baseWaves = computeMigrationWaves(dependencyOrder, graphRelationships) ?? []
  const waveOf = new Map<string, number>()
  baseWaves.forEach((wave, index) => {
    for (const name of wave) waveOf.set(name, index)
  })
  const cyclicPeers = plans.map((p) => String(p.componentName)).filter((name) => !waveOf.has(name))
  const waves = cyclicPeers.length ? [...baseWaves, cyclicPeers.slice().sort()] : baseWaves
  for (const name of cyclicPeers) waveOf.set(name, waves.length - 1)

  // A WAVE is a list of names; a PLAN is a symbol. Since round 6 those are
  // different things: two components in different files can share a name, and one
  // wave entry then stands for two plans. Measured on a one-file cobra cohort:
  // 100 plans, 99 distinct names, `FParseErrWhitelist` planned twice, one wave
  // entry. `byWave` was never wrong — it iterates plans — but the LABEL was: a
  // team reading `waves: 3[FParseErrWhitelist, …]` cannot tell which file to
  // migrate, and the very same ambiguity in `cappedNames` is resolved by rendering
  // `name (file)`.
  //
  // So `waves` renders the file whenever a name is ambiguous, and `cohort.wavePlan`
  // is the machine-readable view keyed by symbol id, where every plan appears
  // exactly once. A human gets an unambiguous label; a caller gets something it can
  // index without parsing a string.
  const renderName = (name: string): string[] => {
    // One label per COMPONENT, not per name. A name two plans share must expand to
    // as many labels as there are plans under it, or the wave holds 4 plans behind
    // 3 labels and the reader cannot tell which is which.
    const withName = plans.filter((plan) => String(plan.componentName) === name)
    if (withName.length < 2) return [name]
    const byFile = new Map<string, typeof withName>()
    for (const plan of withName) {
      const file = String(plan.sourceFile ?? "unknown")
      byFile.set(file, [...(byFile.get(file) ?? []), plan])
    }
    // name + file is enough — one component per file.
    if ([...byFile.values()].every((group) => group.length === 1)) {
      return [...byFile.keys()].sort().map((file) => `${name} (${file})`)
    }
    // name AND file collide — measured on cobra, where two `FParseErrWhitelist`
    // symbols both live in command.go. The line is what separates them, and it is
    // what `bb_search` prints for the same symbol.
    return withName.map((plan) => `${name} (${String(plan.sourceFile ?? "unknown")}:${plan.sourceLine ?? "?"})`).sort()
  }
  const waveLabels: string[][] = waves.map((wave) => wave.flatMap(renderName))
  const wavePlan = waves.map((wave, index) => ({
    wave: index,
    symbols: plans
      .filter((plan) => waveOf.get(String(plan.componentName)) === index)
      .map((plan) => ({ symbolId: plan.symbolId, name: String(plan.componentName), file: String(plan.sourceFile ?? "unknown"), line: plan.sourceLine ?? null })),
  }))
  const fileGroups = new Map<string, { file: string; symbols: number; perPlanSumHours: number; productionIntegrationPoints: number; testIntegrationPoints: number }>()
  for (const plan of plans) {
    const file = String(plan.sourceFile ?? "unknown")
    const group = fileGroups.get(file) ?? { file, symbols: 0, perPlanSumHours: 0, productionIntegrationPoints: 0, testIntegrationPoints: 0 }
    group.symbols++
    group.perPlanSumHours += Number(plan.effortEstimateHours) || 0
    group.productionIntegrationPoints += plan.evidenceBreakdown?.production ?? 0
    group.testIntegrationPoints += plan.evidenceBreakdown?.test ?? 0
    fileGroups.set(file, group)
  }
  const waveGroups = new Map<number, { wave: number; symbols: number; perPlanSumHours: number }>()
  for (const plan of plans) {
    const name = String(plan.componentName)
    const wave = waveOf.get(name)
    if (wave === undefined) continue
    const group = waveGroups.get(wave) ?? { wave, symbols: 0, perPlanSumHours: 0 }
    group.symbols++
    group.perPlanSumHours += Number(plan.effortEstimateHours) || 0
    waveGroups.set(wave, group)
  }
  // The language mix of the RESOLVED cohort, and how each bucket fared. Derived
  // from the index, not asserted: a cohort scoped to a repository root is
  // routinely mostly YAML, and "0 plans" reads as a broken request unless the
  // composition of the cohort is visible.
  // Over the WHOLE resolved cohort, not the capped slice.
  //
  // My first version counted only the loaded symbols, which made the line
  // actively misleading: a whole-repository cohort is 1263 components of which
  // ~1100 are Go, but the cap happened to select 100 YAML files, and the line
  // cheerfully reported "100 yaml" as if that were the cohort's composition. A
  // caller reading that would conclude the repository contains no Go at all.
  //
  // `symbols` is the whole cohort; `processed` is the part the cap let through;
  // `planned` and `refused` describe that part only. So the line reads "this is
  // what you asked about, this is what we looked at, and this is what happened".
  const languageBuckets = new Map<string, { language: string; symbols: number; processed: number; planned: number; refused: number }>()
  const bucketFor = (language: string) => {
    const key = String(language ?? "unknown")
    const bucket = languageBuckets.get(key) ?? { language: key, symbols: 0, processed: 0, planned: 0, refused: 0 }
    languageBuckets.set(key, bucket)
    return bucket
  }
  for (const symbol of resolved.symbols) bucketFor(symbol.language).symbols++
  for (const symbol of loadedSymbols) bucketFor(symbol.language).processed++
  const plannedById = new Set(plans.map((plan) => plan.symbolId))
  for (const symbol of loadedSymbols) {
    if (plannedById.has(symbol.id)) bucketFor(symbol.language).planned++
  }
  for (const entry of unsupported) {
    // The refusal carries the NAME; find the symbol it refused. A cohort can hold
    // two same-named symbols, so the file disambiguates when the tool recorded it.
    const hint = String(entry.reason ?? "")
    for (const symbol of loadedSymbols) {
      if (String(symbol.name) !== String(entry.symbolName)) continue
      // Prefer a symbol whose language the refusal actually names, so a same-named
      // pair is not counted against the wrong bucket.
      if (hint.includes(`"${symbol.language}"`) || bucketFor(symbol.language).processed === 1) {
        bucketFor(symbol.language).refused++
        break
      }
    }
  }
  const refusedBuckets = new Map<string, { reason: string; count: number; example: string }>()
  for (const entry of unsupported) {
    const bucket = refusedBuckets.get(entry.unsupportedReason) ?? { reason: entry.unsupportedReason, count: 0, example: String(entry.symbolName) }
    bucket.count++
    refusedBuckets.set(entry.unsupportedReason, bucket)
  }

  const cohort = {
    symbolsResolved: resolved.symbols.length,
    pathsRequested: resolved.pathResolution.paths,
    pathsUnmatched: resolved.pathResolution.unmatched,
    filesCovered: new Set(plans.map((p) => p.sourceFile)).size,
    work: {
      symbolsLoaded: context.work.symbolsLoaded,
      relationshipsLoaded: context.work.relationshipsLoaded,
      projectSymbols: context.projectScale.symbols,
      projectRelationships: context.projectScale.relationships,
    },
    byFile: [...fileGroups.values()].sort((a, b) => b.perPlanSumHours - a.perPlanSumHours || a.file.localeCompare(b.file)),
    byWave: [...waveGroups.values()].sort((a, b) => a.wave - b.wave),
    wavePlan,
    byLanguage: [...languageBuckets.values()].sort((a, b) => b.symbols - a.symbols || a.language.localeCompare(b.language)),
    refusedByReason: [...refusedBuckets.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    statement:
      plans.length === 0 && unsupported.length > 0
        ? `NO PLANS: all ${unsupported.length} resolved component(s) were refused — ${[...refusedBuckets.values()].map((b) => `${b.count} ${b.reason} (e.g. "${b.example}")`).join(", ")}. The cohort's language mix is ${[...languageBuckets.values()].map((b) => `${b.symbols} ${b.language}`).join(", ")}; the ${loadedSymbols.length} component(s) the cap let through were ${[...languageBuckets.values()].filter((b) => b.processed).map((b) => `${b.processed} ${b.language}`).join(", ") || "none"}, so scope paths to the code you mean.`
        : resolved.pathResolution.paths.length > 0
        ? `${resolved.symbols.length} indexed symbol(s) under ${resolved.pathResolution.paths.length} path(s), covering ${new Set(plans.map((p) => p.sourceFile)).size} file(s) in the plans returned${
            capped > 0 ? ` (${capped} of ${requestedEntries.length} resolved components were dropped by the 100-component cap; see truncation.cappedNames)` : ""
          }${resolved.pathResolution.unmatched.length ? `; ${resolved.pathResolution.unmatched.length} requested path(s) matched no indexed file: ${resolved.pathResolution.unmatched.join(", ")}` : ""}`
        : `${plans.length} plan(s) across ${new Set(plans.map((p) => p.sourceFile)).size} file(s)`,
  }

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
    cohort,
    dependencyOrder,
    waves: waveLabels,
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
      requested: requestedEntries.length,
      returned: entries.length,
      deduplicated,
      capped,
      /** How many of the resolved symbols came from a `paths` cohort. */
      pathSymbols: resolvedFromPaths,
      /**
       * The order the cap applied. Resolution is sorted by file path then
       * symbol name, so the cap keeps the FIRST N in that order and the dropped
       * set is a property of the project layout rather than of a query plan.
       */
      selection: "first N resolved symbols by project-relative file path, then symbol name",
      // The dropped entries are the tail of the resolved request, in the
      // deterministic resolution order, and a same-named symbol is named WITH
      // its file so the caller can tell two `String`s apart.
      cappedNames: requestedEntries
        .slice(100)
        .map((entry) => (entry.kind === "symbol" ? `${entry.name} (${entry.file})` : entry.name)),
    },
  }
}

export function formatMigrationPlans(result: MigrationPlanResult, format: "text" | "json" = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [
    `migration target: ${result.targetLanguage}`,
    `dependency order: ${result.dependencyOrder.join(" -> ") || "none"} (${result.dependencyGraph.orderingStatus})`,
    `methodology: base=${result.methodology.baseHours}h relationships=${result.methodology.relationshipHours}h missing-mappings=${result.methodology.missingMappingHours}h` +
      (result.methodology.missingMappingCount > 0
        ? `  (${result.methodology.missingMappingCount} third-party librar${result.methodology.missingMappingCount === 1 ? "y has" : "ies have"} no registered mapping; each needs a target-language equivalent chosen by a human)`
        : ""),
    // The authoritative figure, with the arithmetic that reconciles it against
    // the per-plan numbers printed below. Previously the header and the per-plan
    // `effort=` lines were both presented as totals and differed by 8h on a
    // two-symbol mutual-call request, with nothing explaining why.
    `total effort: ${result.effort.totalHours}h (${result.effort.reconciliation})`,
    // The scope line goes near the TOP, not in a footnote: a total effort number
    // read without it is the number most likely to be quoted in a plan and acted
    // on. Measured on cobra, this line is the difference between "328h" and
    // "328h, for 0.2% of the surface".
    `cohort: ${result.cohort.statement}`,
    `scope: ${result.scope.statement}`,
    ...(result.cohort.byFile.length
      ? [`per file: ${result.cohort.byFile.slice(0, 10).map((f) => `${f.file} (${f.symbols} sym, ${f.perPlanSumHours}h)`).join("; ")}${result.cohort.byFile.length > 10 ? `; … and ${result.cohort.byFile.length - 10} more` : ""}`]
      : []),
    ...(result.cohort.byWave.length ? [`per wave: ${result.cohort.byWave.map((w) => `wave ${w.wave + 1} = ${w.symbols} sym, ${w.perPlanSumHours}h`).join("; ")}`] : []),
    ...(result.waves.length
      ? [
          `waves: ${result.waves.map((wave, i) => `${i + 1}[${wave.join(", ")}]`).join(" -> ")}` +
            // Say it once, where the numbers are, when a label carries a file —
            // otherwise `3[Foo (a.ts), Foo (b.ts)]` is the reader's only clue.
            (result.cohort.wavePlan.some((w) => w.symbols.length !== new Set(w.symbols.map((x) => x.name)).size)
              ? `  (a name shared by two components is labelled once per component; ${result.plans.length} plans are in ${result.cohort.wavePlan.length} waves — index them by cohort.wavePlan, not by name)`
              : ""),
        ]
      : []),
    ...(result.unsupported.length
      ? [
          `refused: ${result.unsupported.length} of ${result.truncation.returned} requested component(s) produced no plan — ${result.cohort.refusedByReason.map((r) => `${r.count} ${r.reason}`).join(", ")}; the reasons are listed under "unsupported" below` +
            (result.plans.length === 0 ? "  NO PLANS WERE PRODUCED" : ""),
        ]
      : []),
    ...(result.cohort.byLanguage.length
      ? [
          `cohort languages: ${result.cohort.byLanguage
            .slice(0, 8)
            .map((b) => `${b.symbols} ${b.language}${b.processed ? ` [${b.processed} processed: ${b.planned} planned${b.refused ? `, ${b.refused} refused` : ""}]` : ""}`)
            .join("; ")}`,
        ]
      : []),
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
          ? "  library dependencies UNKNOWN: the index holds no external import rows for this file (not the same as 'none')"
          : "  no library dependency: every import this file declares is standard library or local crate",
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
