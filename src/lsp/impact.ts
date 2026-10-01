// src/lsp/impact.ts — M26.W5: bounded reverse-dependency impact (issue #513).
//
// Impact is the highest-stakes read surface (refactoring decisions); silent
// truncation here is dangerous. This component is the SINGLE owner of the
// impact surface:
//
//   bounded:     the set comes from the graph engine's caller traversal under
//                the declared budget/depth (never an unbounded walk).
//   declared:    truncation is a first-class field with a reason and REAL
//                counts — `shownCount` plus `totalCountIfKnown` (computed by
//                an independent bounded COUNT query over the same containment
//                rule the traversal uses, so the UI can say "showing X of Y"
//                instead of hiding the cut). When Y itself cannot be bounded
//                cheaply, `totalCountIfKnown` is null and the UI says so —
//                null is a declared number-shaped absence, never a guess.
//   consistent:  the differential gate (script/m26/verify-impact-mode.ts)
//                proves impact counts agree with the L3 references surface
//                (src/lsp/navigation.ts) for sampled symbols on the same
//                fixture, with the declared containment difference (the
//                traversal descends into nested symbols via the owner
//                cascade; flat references count direct edges only).
//   rendered:    budget exhaustion renders a visible in-UI marker with the
//                declared counts (W1 renderer law: truncation never silent).
//                Since M42.H4 the renderer lives in the ONE core
//                (script/m26/graph-core.ts renderImpact) — this component
//                owns the DATA; the core owns the DOM. Same law, one home.
//   resolved:    member-name targets (the hover's server-resolved identity
//                for a constructor or member symbol) resolve through their
//                OWNING declaration when the member itself has no stored
//                reverse edges (M44.U5, issue #692). The resolution is a
//                first-class field on the result — the UI says what it
//                rooted at, never silently relabels. A symbol that is
//                genuinely absent still throws the declared error.
//
// Declared guarantees (gated by script/m26/verify-impact-mode.ts and
// script/m44/verify-impact-resolution.ts):
//   G1 bounded:    result size <= declared budget; depth <= declared max
//   G2 declared:   truncated == true ⟺ a declared reason exists; counts real
//   G3 consistent: impact count agrees with L3 references on flat fixtures
//                  (differential, sampling stated in the verifier)
//   G4 rendered:   the ONE core's renderImpact() emits a visible marker with
//                  counts when truncated, nothing when complete
//   G5 resolved:   an indexed member target roots at its owning declaration
//                  with a declared note; a genuinely unknown symbol still
//                  errors (never an empty set that would read as "no impact")

import { graphTraversal } from "../intelligence/graph/graph-engine"
import { AnalysisExclusions } from "../ast/analysis-exclusions"
import { classifyTier, type EvidenceTier } from "./evidence_tier"
import type { GraphNode } from "../intelligence/contracts"

export const IMPACT_BUDGET = {
  /** maximum reverse-dependency nodes in one impact set */
  maxNodes: 200,
  /** traversal depth cap (mirrors the engine's own hard cap of 10) */
  maxDepth: 5,
} as const

/** Root symbol types the engine's graph traversal can root (the engine's
 *  STRUCTURAL whitelist, src/intelligence/graph/graph-engine.ts
 *  resolveGraphRoot). M53: a DIRECT root outside this set means the engine's
 *  M48.C1 any-type exact resolve picked a member (constructor, plain field…)
 *  — those re-root through their OWNING declaration with the U5 rules, never
 *  silently ride a gravity pick. Exported so the bb/graph door shares the
 *  ONE list; drift-gated by the U5 gate's mutant suite. */
export const IMPACT_TRAVERSABLE_ROOT_TYPES: readonly string[] = IDENTITY_TRAVERSABLE_TYPES

// M55.T1 (issue #770): the whitelist above and the member-resolution rules
// below now live in the ONE resolver, `src/lsp/identity.ts`. This module
// re-exports them under its historical names so every existing caller, gate
// and mutant anchor keeps working — the DECISION is not duplicated, only its
// name, and the identity owner is the place to change it.
import {
  IDENTITY_TRAVERSABLE_TYPES,
  memberFileMatches,
  resolveMemberIdentity as resolveImpactMemberOwner,
} from "./identity"
export {
  memberFileMatches,
  resolveMemberIdentity as resolveImpactMemberOwner,
  type MemberIdentityHint as ImpactMemberIdentity,
  type MemberResolution,
} from "./identity"

export interface ImpactResult {
  /** The symbol the walk rooted at, with the identity a reader needs to check
   *  it: M63.T1 the engine's node already carries the type, the line and the
   *  language, and an impact answer about a symbol with no line and no type is
   *  hard to argue with (the same shape the bb_graph door adopted when it
   *  declared name ambiguity). */
  root: { id: string; name: string; file: string; filePath: string; line: number; symbolType: string; language: string }
  /** Reverse dependencies, bounded, deepest last.
   *
   *  M63.T1: each dependent carries the same evidence the stored row already
   *  had and this component used to drop — the TIER (from the ONE server-side
   *  classifier, `classifyTier`, never a second derivation), whether the edge
   *  CROSSES LANGUAGES, the bridge mechanism when it does, and the dependent's
   *  own position. Two of those were documented claims with no payload behind
   *  them: docs/tools/bb_impact.md has promised "per-edge evidence tiers"
   *  since M28, and a cross-language dependent was indistinguishable from a
   *  same-language one — which is precisely the fact an agent needs before
   *  renaming or deprecating a symbol. */
  impact: ImpactDependent[]
  shownCount: number
  /** The true number of reverse dependencies under the declared rule, or null
   *  when the counting walk hit its declared scan ceiling (a declared
   *  unknown, never a fabricated total and never a partial count wearing a
   *  total's name). It is a total OF THIS SET: same relationship kinds, same
   *  owner cascade, same noise policy, same depth (M63.T1). */
  totalCountIfKnown: number | null
  /** Distinct dependents at depth 0 — exact whenever the counting walk stayed
   *  inside its declared scan ceiling, and null (declared unknown) when it did
   *  not. Trustworthy on its own even when `totalCountIfKnown` is null. */
  directCount: number | null
  /** Declared limits actually in force, so a reader never has to guess
   *  whether a bound is in play (M63.T1). */
  budget: {
    maxNodes: number
    maxDepth: number
    /** Declared ceilings the declared total is computed under. Past either,
     *  `totalCountIfKnown` and `directCount` are null (declared unknown). */
    totalScanCeiling: number
    totalExpansionCeiling: number
  }
  /** How far the walk actually went, and the engine's own bound declarations
   *  (its per-query site limit, how many of its queries hit it, and the root's
   *  uncapped site count when it could be computed). */
  traversal: {
    depthReached: number
    engineTruncated: boolean
    engineTruncationReason: string | null
    edgeLimit: number | null
    cappedQueries: number | null
    callersIfUncapped: number | null
    totalsAreLowerBounds: boolean
    dedupedAtToolLayer: { cascadeRepeatsCollapsed: number; spellingVariantsCollapsed: number } | null
  }
  truncated: boolean
  truncationReason: string | null
  /** M44.U5: how the root was resolved. "direct" = the name resolved to a
   *  traversable root (the engine's whitelist); "owning-declaration" = the
   *  name is an indexed member the whitelist excludes (constructor, plain
   *  members), rooted through its owner with the member named. First-class
   *  so the UI states what it rooted at — never a silent relabel. */
  resolution?: { through: "direct" | "owning-declaration"; memberName?: string; ownerName?: string; memberFile?: string }
  /** M63.T1: HOW the requested name became this root, stated on the answer.
   *
   *  The engine resolves a name in three steps (exact among traversable kinds,
   *  exact among any kind, then a documented containment match). A reader of an
   *  impact answer cannot tell which step ran: measured on the lane's corpora,
   *  `bb_impact {symbol:"push"}` on graphql-js answers "0 reverse dependencies"
   *  for a `push` that 141 stored relationships point at, and ripgrep `filter`
   *  answers "0" for a symbol 8 depend on — a confident empty set about
   *  somebody else's symbol, with no field that says the name was not exact.
   *
   *  `via` is derived, not guessed: a containment match can only win when no
   *  exact name exists, so `root.name === requested` is exactly "the name was
   *  an exact hit" and anything else is a containment match (or the declared
   *  member substitution, which the `resolution` record already describes).
   *
   *  `nameMatches` counts the stored symbols whose name IS the requested one —
   *  more than one means the name was ambiguous even when the hit was exact
   *  (lodash `build` names eight; the resolver picked one and said nothing).
   *  It is deliberately NOT the resolver's `candidates`: that number is counted
   *  with the winning step's predicate, and for a containment match that means
   *  re-running a `LIKE '%x%'` scan, which measured 30–420 ms per call on the
   *  lane's corpora — a real cost on the highest-stakes read surface, paid for
   *  a flag the `via` field already carries. This count is one indexed
   *  equality. */
  rootMatch: { requested: string; via: "exact" | "fuzzy-containment" | "owning-declaration"; nameMatches: number }
}

export interface ImpactDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
}

/** One reverse dependency, with everything the stored row said about it. */
export interface ImpactDependent {
  id: string
  name: string
  file: string
  filePath: string
  line: number
  symbolType: string
  language: string
  depth: number
  relationshipType: string
  confidence: number
  /** The legend tier for this edge, from the ONE server-side classifier. */
  tier: EvidenceTier
  /** True when the stored row says this dependency crosses languages. */
  isCrossLanguage: boolean
  /** The bridge mechanism, when the row names one (null otherwise). */
  bridgeMechanism: string | null
}

export interface ImpactDeps {
  traverse?: typeof graphTraversal
}

// (The member identity contract and the file-hint matcher are re-exported
// above from src/lsp/identity.ts — the ONE resolver. Nothing is defined
// twice: the rules have a single owner, the impact door keeps its names.)

// M55.T1 (issue #770): the member-resolution rules (M44.U5, disambiguated at
// the M53 X1 closure) now live in src/lsp/identity.ts — the ONE resolver —
// and are re-exported above as `resolveImpactMemberOwner`. The rules are not
// duplicated here: this door reads them from that owner, and the identity
// owner's header carries the full rule list.
/** The containment rule the engine's caller traversal uses (owner cascade:
 *  a call edge to any nested symbol of X counts as a reverse dependency of
 *  X). Declared here so the total-count query and the differential gate use
 *  the SAME rule the traversal walks. */
export const IMPACT_CONTAINMENT_NOTE =
  "the traversal descends into nested symbols via the owner cascade; flat reference counts (L3) count direct edges only"

/** The relationship kinds the engine's caller traversal counts
 *  (`DEFAULT_REL_TYPES` in src/intelligence/graph/graph-engine.ts). The
 *  declared total has to count EXACTLY what the set counts: a total that also
 *  counts `contains` / `uses` / `references` rows the set never sees is not a
 *  total of this set, it is a different measurement wearing its name.
 *
 *  Measured on real corpora (this lane's runs): with the filter missing,
 *  `GraphQLList` declared 57 reverse dependencies of which 8 are dependency
 *  rows — the other 49 are `contains` / `uses` edges from the class itself
 *  and its neighbours. */
const IMPACT_REL_TYPES = ["calls", "instantiates", "extends", "implements"] as const

/** Declared ceiling on the counting walk's row scan. Past it the honest
 *  answer is "unknown" and the component says so (null), rather than
 *  publishing a partial count as a total. Mirrors the engine's own
 *  `MAX_TOTAL_COUNT_SCAN` discipline. */
export const IMPACT_TOTAL_SCAN_CEILING = 50_000

/** Declared ceiling on the counting walk's EXPANSIONS (symbols it opens).
 *  The cost of an honest total is one bounded query per symbol in the
 *  closure, so the ceiling that actually bounds latency is this one, not the
 *  row count. Measured on the lane's corpora: ~1.2 ms per expansion
 *  (graphql-js, 43 496 relationships), so 2 000 expansions is a ~2.5 s worst
 *  case; the biggest hub in any lane corpus closes over 719. Past the ceiling
 *  both counts are null — the declared unknown. */
export const IMPACT_TOTAL_EXPANSION_CEILING = 2_000

export interface ImpactTotalCount {
  /** Distinct dependent symbols under the declared rule, transitive to
   *  `maxDepth`; null when the scan ceiling was reached (declared unknown,
   *  never a partial count wearing a total's name). */
  total: number | null
  /** Distinct dependents at depth 0 — always exact, always cheap, and the
   *  number a reader can always trust even when `total` is null. */
  direct: number
  /** Rows the walk read (the declared cost of the answer). */
  rowsScanned: number
  /** Symbols the walk opened (the other declared cost bound). */
  expansions: number
  hitScanCeiling: boolean
}

/** The owner-cascade id range: everything owned by `symbolId` sorts between
 *  that id's last colon and the colon's successor. One definition, used by
 *  the counting walk and by every consumer that needs the same range. */
function cascadePrefix(symbolId: string): string {
  return symbolId.includes(":") ? symbolId.slice(0, symbolId.lastIndexOf(":") + 1) : ""
}

/** Independent bounded count of the reverse-dependency symbols the traversal
 *  would return if nothing were capped.
 *
 *  M63.T1: this replaced a single flat COUNT over relationships whose target
 *  is the root (or one of its members), which is not a total of the set the
 *  walk returns:
 *    * the set is TRANSITIVE to the declared depth, the old count was depth 0
 *      only — measured on four real corpora it made the surface say "showing
 *      200 of 145 reverse dependencies", a total smaller than the part shown;
 *    * it counted EVERY relationship kind, including the `contains` rows that
 *      make a class a dependent of its own members;
 *    * it applied none of the noise filters the walk applies, so a name or a
 *      path the walk drops still moved the declared total.
 *  The walk below uses the traversal's own rule — same kinds, same cascade,
 *  same noise policy, same depth — with no node budget, so what it returns IS
 *  the size of the set the walk would have produced. It is bounded by a
 *  declared scan ceiling and returns null past it. */
export function countImpactDependents(
  db: ImpactDb,
  projectId: string,
  rootSymbolId: string,
  options: { maxDepth?: number; scanCeiling?: number; expansionCeiling?: number } = {},
): ImpactTotalCount {
  const maxDepth = options.maxDepth ?? IMPACT_BUDGET.maxDepth
  const scanCeiling = options.scanCeiling ?? IMPACT_TOTAL_SCAN_CEILING
  const expansionCeiling = options.expansionCeiling ?? IMPACT_TOTAL_EXPANSION_CEILING
  const relPlaceholders = IMPACT_REL_TYPES.map(() => "?").join(",")
  const sql =
    "SELECT s.id AS id, s.name AS name, f.relative_path AS file " +
    "FROM brain_relationship r " +
    "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
    "JOIN brain_file f ON f.id = s.file_id " +
    "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
    "AND r.target_symbol_id IN (" +
    "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m " +
    "WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?" +
    ")"
  try {
    const found = new Set<string>()
    const visited = new Set<string>()
    let frontier: Array<{ id: string; depth: number }> = [{ id: rootSymbolId, depth: 0 }]
    let direct = 0
    let rowsScanned = 0
    let expansions = 0
    let hitScanCeiling = false

    while (frontier.length > 0 && !hitScanCeiling) {
      const next: Array<{ id: string; depth: number }> = []
      for (const current of frontier) {
        if (visited.has(current.id)) continue
        if (expansions >= expansionCeiling) {
          hitScanCeiling = true
          break
        }
        visited.add(current.id)
        expansions++
        // The cascade range belongs to the symbol being walked, not to the
        // root: at depth d the members of THAT symbol are the targets whose
        // edges make it a dependent. Using the root's range for every level
        // silently drops the owner-cascade edges of every non-root symbol —
        // measured on rake `each`: 112 found instead of 143.
        const prefix = cascadePrefix(current.id)
        const rows = db
          .prepare(sql)
          .all(projectId, ...IMPACT_REL_TYPES, current.id, prefix, prefix + ";", projectId) as Array<{
          id: string
          name: string
          file: string
        }>
        rowsScanned += rows.length
        if (rowsScanned > scanCeiling) {
          hitScanCeiling = true
          break
        }
        for (const row of rows) {
          if (!row.name || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
          if (row.file && AnalysisExclusions.isHardNoisePath(row.file)) continue
          // A cycle makes the root a dependent of itself; the set is about
          // OTHER symbols (see the M63.T1 note where the walk is built).
          if (row.id === rootSymbolId) continue
          if (found.has(row.id)) continue
          found.add(row.id)
          if (current.depth === 0) direct++
          if (current.depth + 1 < maxDepth) next.push({ id: row.id, depth: current.depth + 1 })
        }
      }
      frontier = next
    }
    return { total: hitScanCeiling ? null : found.size, direct, rowsScanned, expansions, hitScanCeiling }
  } catch {
    // Unreadable index: the declared unknown, never a guess.
    return { total: null, direct: 0, rowsScanned: 0, expansions: 0, hitScanCeiling: false }
  }
}

/** Bounded reverse-dependency impact for one symbol. Throws (declared error)
 *  when the root cannot be resolved — an unknown symbol has no impact set,
 *  and inventing an empty one would read as "no one depends on this".
 *
 *  M44.U5: a member-name target (the hover's server-resolved identity for a
 *  constructor or member) that the engine's root whitelist excludes is
 *  re-rooted through its OWNING declaration when the member has no stored
 *  reverse edges of its own — and the result says so (resolution field).
 *  A genuinely absent symbol still throws: no silent re-rooting, no empty
 *  set that would read as "no one depends on this". */
export async function computeImpact(
  db: ImpactDb,
  projectId: string,
  symbolName: string,
  deps: ImpactDeps = {},
  /** X1 closure: the hover's defining-file identity. Same-name members
   *  (every real repo's constructors) resolve ONLY through it; without it an
   *  ambiguous member name keeps the declared error. Positional so existing
   *  call sites stay source-compatible. */
  memberFile?: string,
): Promise<ImpactResult> {
  const traverse = deps.traverse ?? graphTraversal
  let resolution: ImpactResult["resolution"] = { through: "direct" }
  let result: Awaited<ReturnType<typeof graphTraversal>>
  try {
    result = await traverse(projectId, symbolName, { direction: "callers", maxDepth: IMPACT_BUDGET.maxDepth })
  } catch (error) {
    // Member fallback (declared, narrow): only when the direct traversal
    // could not resolve the name AND the member-resolution rules all hold.
    const owner = resolveImpactMemberOwner(db, projectId, symbolName, memberFile)
    if (owner === null) {
      // No fallback applies: the declared error stands. The engine's raw
      // not-found is normalized to the component's declared shape (the wire
      // layer adds remediation; internal crashes keep propagating raw).
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("not found")) {
        throw new Error(`bb/impact: symbol '${symbolName}' not found — no impact set exists (declared error; run \`bb index\` or check the name)`)
      }
      throw error
    }
    result = await traverse(projectId, owner.name, { direction: "callers", maxDepth: IMPACT_BUDGET.maxDepth })
    if (!result.root || !result.root.id) {
      // The owner row exists but the traversal cannot root it (should not
      // happen — the owner passed the traversable-type rule): the original
      // declared error stands, never a fabricated set.
      throw error
    }
    resolution = { through: "owning-declaration", memberName: symbolName, ownerName: owner.name, ...(memberFile ? { memberFile } : {}) }
  }
  // M53: the hover's server-resolved identity beats the engine's gravity
  // pick. M48.C1 made the engine resolve exact member names DIRECTLY
  // (gravity-ordered, any type), which silently bypassed the U5 fallback and
  // could root a same-name member in the WRONG file (found live: two
  // `constructor` rows; the hinted greeter.ts request rooted the
  // higher-gravity one). The hint is a server-resolved identity, so a root
  // outside it is a silent relabel — re-resolve through the hinted member's
  // OWNING declaration with the same U5 rules (owner exists, is traversable,
  // and the member has no reverse edges of its own). A hint-less unique
  // member the engine whitelist excludes re-roots too (the fallback owns
  // that decision for BOTH doors). Failures here are never silent: a
  // mismatched or unresolvable hint keeps the declared error.
  const rootType = (result.root as unknown as { symbolType?: string } | undefined)?.symbolType ?? ""
  if (rootType && !IMPACT_TRAVERSABLE_ROOT_TYPES.includes(rootType)) {
    const owner = resolveImpactMemberOwner(db, projectId, symbolName, memberFile)
    if (owner === null) {
      throw new Error(
        `bb/impact: symbol '${symbolName}' is not a traversable root (${rootType}) — no impact set exists` +
          ` (declared error: the symbol was not found as a traversable root${
            memberFile
              ? "; the hinted file does not disambiguate it — hover a symbol that was indexed"
              : "; run `bb index` or check the name"
          })`,
      )
    }
    result = await traverse(projectId, owner.name, { direction: "callers", maxDepth: IMPACT_BUDGET.maxDepth })
    if (!result.root || !result.root.id) throw new Error(`bb/impact: symbol '${symbolName}' not found — no impact set exists (declared error)`)
    resolution = { through: "owning-declaration", memberName: symbolName, ownerName: owner.name, ...(memberFile ? { memberFile } : {}) }
  } else if (memberFile && result.root && rootType && IMPACT_TRAVERSABLE_ROOT_TYPES.includes(rootType)) {
    // Traversable root WITH a hint: still the hinted identity's truth or the
    // declared error — gravity never overrules the hover's identity.
    if (typeof result.root.file !== "string" || !memberFileMatches(memberFile, result.root.file)) {
      throw new Error(
        `bb/impact: symbol '${symbolName}' resolves to a member in '${result.root.file}' but the hover's identity is '${memberFile}' — the hinted symbol was not found at that identity; refusing the silent relabel (declared error)`,
      )
    }
  }
  if (!result.root || !result.root.id) {
    throw new Error(`bb/impact: symbol '${symbolName}' not found — no impact set exists (declared error; run \`bb index\` or check the name)`)
  }

  // Distinct caller nodes (a caller with three call sites is ONE dependency),
  // in traversal order (depth, then edge order — deterministic).
  //
  // M63.T1: the root is never a member of its own impact set. A cycle (A calls
  // B, B calls A) makes the engine emit an edge from the root back to itself,
  // and a reader asking "what breaks if I change this" would be told the
  // symbol breaks itself. Measured on the lane's corpora: 8 of 24 hub answers
  // listed the root among its own dependents (cobra `MarkFlagRequired`, rake
  // `join`, lodash `baseConvert`, graphql-js `join`, vue-core
  // `addEventListener`, …). The set is about OTHER symbols; the count moves
  // with the set, so the counting walk drops the root too.
  const seen = new Set<string>()
  const impact: ImpactResult["impact"] = []
  let truncated = false
  let truncationReason: string | null = null

  const edges = [...result.callers].sort((a, b) => a.depth - b.depth)
  for (const edge of edges) {
    if (impact.length >= IMPACT_BUDGET.maxNodes) {
      truncated = true
      truncationReason = "impact-node-budget-exhausted"
      break
    }
    const nodeId = edge.from
    if (nodeId === result.root.id) continue
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    const node = result.nodes[nodeId] as GraphNode | undefined
    impact.push({
      id: nodeId,
      name: node?.name ?? nodeId,
      file: node?.file ?? "",
      filePath: node?.filePath ?? "",
      line: node?.line ?? 0,
      symbolType: node?.symbolType ?? "",
      language: node?.language ?? "",
      depth: edge.depth,
      relationshipType: edge.relationshipType,
      confidence: edge.confidence,
      // The ONE server-side classifier (M55.T5's owner). A second derivation
      // here would be the exact defect that module was written to close.
      tier: classifyTier({
        relationshipType: edge.relationshipType,
        confidence: edge.confidence,
        evidenceClass: edge.metadata?.evidenceClass ?? null,
      }),
      isCrossLanguage: edge.isCrossLanguage === true,
      bridgeMechanism: edge.bridgeMechanism ?? null,
    })
  }
  if (result.summary?.truncated && result.summary.truncationReason) {
    truncated = true
    truncationReason = truncationReason ?? `traversal: ${result.summary.truncationReason}`
  }

  // M63.T1: the declared total is measured under the SAME rule the walk used
  // (kinds, cascade, noise, depth) with no node budget, so it is the size of
  // the set this answer is a prefix of. An untruncated answer IS the whole
  // set, so its total is its own size and no counting walk is paid for.
  const directFromSet = impact.reduce((n, entry) => (entry.depth === 0 ? n + 1 : n), 0)
  const counts = truncated
    ? countImpactDependents(db, projectId, result.root.id, { maxDepth: IMPACT_BUDGET.maxDepth })
    : { total: impact.length, direct: directFromSet, hitScanCeiling: false }  // A count that cannot be trusted is worse than no count: when the counting
  // walk hit its ceiling BOTH numbers are null (declared unknown), never a
  // partial count presented as a whole.
  const total = counts.hitScanCeiling ? null : counts.total
  const direct = counts.hitScanCeiling ? null : counts.direct
  const summary = result.summary
  return {
    root: {
      id: result.root.id,
      name: result.root.name,
      file: result.root.file,
      filePath: result.root.filePath ?? "",
      line: result.root.line ?? 0,
      symbolType: result.root.symbolType ?? "",
      language: result.root.language ?? "",
    },
    impact,
    shownCount: impact.length,
    totalCountIfKnown: total,
    directCount: direct,
    budget: {
      maxNodes: IMPACT_BUDGET.maxNodes,
      maxDepth: IMPACT_BUDGET.maxDepth,
      totalScanCeiling: IMPACT_TOTAL_SCAN_CEILING,
      totalExpansionCeiling: IMPACT_TOTAL_EXPANSION_CEILING,
    },
    traversal: {
      depthReached: impact.reduce((n, entry) => (entry.depth > n ? entry.depth : n), 0),
      engineTruncated: summary?.truncated === true,
      engineTruncationReason: summary?.truncationReason ?? null,
      edgeLimit: summary?.edgeLimit ?? null,
      cappedQueries: summary?.cappedQueries ?? null,
      callersIfUncapped: summary?.callersIfUncapped ?? null,
      totalsAreLowerBounds: summary?.totalsAreLowerBounds === true,
      dedupedAtToolLayer: summary?.dedupedAtToolLayer ?? null,
    },
    truncated,
    truncationReason,
    resolution,
    rootMatch: {
      requested: symbolName,
      via:
        resolution.through === "owning-declaration"
          ? "owning-declaration"
          : result.root.name === symbolName
            ? "exact"
            : "fuzzy-containment",
      nameMatches: countExactNameMatches(db, projectId, symbolName),
    },
  }
}

/** How many stored symbols carry exactly this name. One indexed equality —
 *  `brain_sym_proj_name_idx` — so the declaration costs a fraction of a
 *  millisecond; a declared 1 when the index cannot answer, because the root
 *  that was just walked is itself one such row. */
function countExactNameMatches(db: ImpactDb, projectId: string, symbolName: string): number {
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ? AND name = ?")
      .get(projectId, symbolName) as { c: number }
    return typeof row?.c === "number" && row.c > 0 ? row.c : 1
  } catch {
    return 1
  }
}
