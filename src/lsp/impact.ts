// src/lsp/impact.ts — M26.W5: bounded reverse-dependency impact (issue #513).
//
// Impact is the highest-stakes read surface (refactoring decisions); silent
// truncation here is dangerous. This component is the SINGLE owner of the
// impact surface:
//
//   bounded:     the set comes from the graph engine's caller traversal under
//                the declared budget/depth (never an unbounded walk).
//   declared:    truncation is a first-class field with a reason and REAL
//                counts — `shownCount` plus `totalCountIfKnown`, the size of
//                the set this answer is a prefix of, measured by an
//                independent bounded walk over the traversal's OWN rule (same
//                relationship kinds, same owner cascade, same noise policy,
//                same depth) with no node budget. When that walk cannot finish
//                inside its declared ceilings the total is null and the UI says
//                so — null is a declared number-shaped absence, never a guess.
//   proved:      `truncated` is not taken on the engine's word. When the walk
//                could have lost a node at the depth boundary, the component
//                measures the set against the unbounded walk and declares the
//                answer a PREFIX if the two disagree, even when no bound
//                fired (M63.T2). An untruncated answer is one the component
//                checked, not one it assumed.
//   one rule:    the set, its total, and the `rule` field on the result are
//                measurements of ONE declared kind list, handed to both walks
//                (M63.T2). Before it, the walk and the count each read a list
//                of their own and nothing checked they agreed.
//   attributed:  every dependent says HOW it is a dependent — `exact`, `member`
//                (naming the member), or `range-folded`, meaning it is here only
//                because the owner-cascade RANGE widened, which is a strict
//                superset of the owner relation and so a conservative
//                over-count — measured on this lane's corpora at 21 914 owner ids
//                inside a range without being the member, and 7 of ripgrep
//                `RegexMatcher`'s 21 dependents. And because `depth` is the
//                MEASURED shortest path while the engine that produced the set
//                stamps the first depth-first trace, every evidence field is
//                re-read from the stored row AT THE REPORTED DEPTH and
//                `evidenceAtDepth` says which path it is on; measured, 340 of
//                4 258 rows (7.98%) had been publishing one row's depth with
//                another row's evidence. Where nothing can be attributed the
//                evidence fields are null: a refusal is not a measurement.
//   bounded cost: the counting walk is ONE STATEMENT PER LEVEL, not one per
//                symbol, and its statement is a flat list plus one term per
//                DISTINCT cascade range — measured equal to the per-member form
//                on every row of six hubs, 1.4-1.7x the speed, and free of the
//                expression-tree ceiling that stops a disjunction term per
//                member at ~400 (M63.T2).
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
//   answered:    a root the engine resolved by EXACT name is answered even when
//                its kind is outside the graph whitelist — an enum variant, a
//                constant, a plain field. The whitelist exists so a request is
//                never silently answered about a DIFFERENT symbol, and an
//                exact-name root is not that. Measured: the engine rooted at the
//                exact requested name and completed the walk in all seven cases
//                the D5 ledger named (136–313 caller edges), and the door threw
//                the answer away. `rootMatch.via` says `exact-exempt-kind` and
//                `nameMatches` says how many stored symbols share the name, so
//                the one substitution this DOES need disclosing — an ambiguous
//                name — is disclosed by the same field D4 introduced.
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
//   G6 attributed: a dependent at the shortest path carries the evidence of the
//                  row AT that path, and a row that is only in the set because
//                  the cascade range widened is marked as such on the payload
//                  and in the panel (M63.T2)

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
    /** Declared ceilings the declared total is computed under. Past any of
     *  them, `totalCountIfKnown` and `directCount` are null (declared
     *  unknown) — the walk gives up rather than spends unbounded time to be
     *  more certain. */
    totalScanCeiling: number
    totalExpansionCeiling: number
    /** The ceiling that actually governs the answer's cost, in milliseconds. */
    totalTimeCeilingMs: number
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
  rootMatch: { requested: string; via: "exact" | "exact-exempt-kind" | "fuzzy-containment" | "owning-declaration"; nameMatches: number }
  /** M63.T2: the rule this answer was MEASURED under, stated on the answer.
   *  A reader who wants to know why a `uses` or `references` relationship did
   *  not appear can read it here instead of inferring it, and the set and its
   *  declared total are guaranteed to be measurements of this same list. */
  rule: { relationshipTypes: string[]; cascade: string; noisePolicy: string; maxDepth: number }
  /** M63.T2: the RETURNED set's composition by HOW each dependent is a
   *  dependent. `rangeFolded` is the number of rows in `impact` that are in the
   *  answer only because the cascade range widened — a conservative
   *  over-count, declared rather than hidden. `null` when the composition could
   *  not be established (a member lookup the index refused), which is a third
   *  thing again, and is not zero. */
  cascade: { exact: number; member: number; rangeFolded: number } | null
  /** M63.T2: HOW completeness was established, so a reader can tell an answer
   *  that is complete BY CONSTRUCTION from one that was measured and agreed.
   *
   *  `ran: false` — the walk never reached the depth boundary, so no node could
   *  have been blocked, every bound that could fire has declared itself, and the
   *  set is the whole truth without a measurement having been paid for.
   *  `ran: true, timedOut: false` — the set was measured against an unbounded
   *  walk of the same rule and the two agree.
   *  `ran: true, timedOut: true` — the measurement stopped on the wall clock.
   *  That is the ONE case where the same question can get two different answers,
   *  because it is the only field here that depends on the machine rather than
   *  on the index — so it is published rather than folded into the total's null,
   *  where a reader could not tell a busy refusal from a structural one. */
  countVerification: { ran: boolean; timedOut: boolean; boundarySuspect: boolean }
  /** M63.T2: would this answer be the same if it were asked again?
   *
   *  Every bound this tool and the engine declare is a property of the INDEX —
   *  a node budget, a depth cap, a site limit, a caller budget — so the same
   *  question on the same index gets the same answer, and the lane's suite holds
   *  the tool to that. ONE bound is not: the engine's 2 000 ms walk-time budget
   *  (its owner's declared trade-off — a node is not a unit of work, and a bound
   *  that does not bound is worse than a slow one).
   *
   *  Measured on the lane's largest index, `bb_impact {symbol:"file"}` on cargo
   *  returned 142, 95, 142, 142, 95 rows over five identical calls, and `cargo`
   *  178 or 172. The engine declares the cause on exactly the short runs
   *  (`walk-time-budget-exhausted` in `traversal.engineTruncationReason`), but
   *  this tool's headline `truncationReason` names the first clause of the set —
   *  `caller-site-limit`, which also fired — so two answers with different row
   *  counts carried the SAME declared reason.
   *
   *  So this field is the reader's answer to "will I get this again?", and it is
   *  false when a time bound fired on either side: the engine's walk, or the
   *  counting walk behind the declared total (`countVerification.timedOut`). */
  reproducible: boolean
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
  /** M63.T2: HOW this row makes the dependent a dependent, under the walk's
   *  own rule.
   *
   *  `exact` — the stored row names the traced symbol itself.
   *  `member` — the row names a member of it (the owner cascade doing what it
   *  says: a class's method is attributed to the class).
   *  `range-folded` — the row names a symbol that is NEITHER the traced symbol
   *  nor a member of it, and is in the answer only because the cascade RANGE
   *  widened. The range is built from a symbol id up to its LAST colon, so for
   *  a walked member `P:container:29` the range is [`P:container:`,
   *  `P:container;`) — the whole container — and every sibling of `29` is
   *  folded in with it. Measured: ripgrep `RegexMatcher` answers 14 dependents
   *  of which all 14 are `range-folded` and none is a real member, and across
   *  the lane's corpora 21 914 owner ids sit inside some level member's range
   *  without being that member. The range is a SUPERSET — it never loses a
   *  dependent the owner relation has — so a reader is being told "this might
   *  break", but it is told so about a symbol nobody asked about, and that is
   *  only acceptable if the answer says which rows those are.
   *
   *  Taken from the engine's own `targetMatch` / `matchedMember`, so there is
   *  no second derivation of a fact the engine already states. */
  via: "exact" | "member" | "range-folded"
  /** The member the row actually named, when `via` is not `exact` — the
   *  engine's own record, with the named member's name and file. */
  viaMember?: { name: string; file: string }
  /** The walk node this row was found at, kept because deciding `via` needs it
   *  and for no other reason. Internal: the door does not publish it. */
  tracedId?: string
  /** The depth the QUOTED EVIDENCE belongs to. Normally the same as `depth`,
   *  because the evidence is re-read from the row at the reported depth.
   *
   *  It was not always. `depth` is the MEASURED shortest path (breadth-first, so
   *  minimal by construction) while the evidence fields — tier, cross-language
   *  flag, bridge, position, kind, confidence — came from the row the ENGINE
   *  quoted, and the engine walks depth-first and stamps the first trace. When
   *  the first trace is not the shortest one, the entry describes TWO different
   *  stored rows: the depth of one and the evidence of another. Measured: 340 of
   *  4 258 rows on nine repositories (7.98%), found by the suite's cross-language
   *  law catching a dependent reported at depth 0 and cross-language whose own
   *  direct row is not cross-language.
   *
   *  So the evidence is re-read from the row at the reported depth. If no such
   *  row can be found, every evidence field is null and so is this one: "could
   *  not attribute" is not "the row says this", and only one of them is a
   *  measurement. */
  evidenceAtDepth: number | null
  /** M63.T1: whether this dependent's FILE changed since it was indexed.
   *  Set by the surface that can answer it (the MCP door, over the component's
   *  file rows); absent from a component-level answer, which never touches
   *  the filesystem. Declared optional precisely so "not checked" cannot be
   *  read as "checked and fresh" — a three-state field, not a boolean. */
  stale?: boolean | null
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

/** The relationship kinds an impact set is made of — ONE list, handed to
 *  the engine's walk AND to the counting walk, so the declared total can never
 *  measure a different set than the set it is a total of.
 *
 *  The kinds must be exactly what the set counts: a total that also counts
 *  `contains` / `uses` / `references` rows the set never sees is not a total of
 *  this set, it is a different measurement wearing its name. Measured on real
 *  corpora with the filter missing, `GraphQLList` declared 57 reverse
 *  dependencies of which 8 are dependency rows — the other 49 are `contains` /
 *  `uses` edges from the class itself and its neighbours.
 *
 *  The share of a typical index these four kinds cover, measured per corpus
 *  after the analyzer rewrite: svelte 26.7%, graphql-js 29.5%, cython 38.5%,
 *  cobra 50.5%, lodash 53.8%, vue-core 55.9%, ripgrep 59.3%, rake 63.5%,
 *  cargo 69.8%. The rest is `contains` (containment, not dependency),
 *  `uses`/`references` (usage evidence), and module-level `imports`/`exports`.
 *  A reader who wants one of those can ask; one who does not get the declared
 *  rule, and the tool says which rule it applied. */
export const IMPACT_REL_TYPES: readonly string[] = ["calls", "instantiates", "extends", "implements"]

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

/** Declared WALL-CLOCK ceiling on the counting walk, in milliseconds.
 *
 *  A wall-clock bound is a different KIND of bound from the other two, and the
 *  difference is not cosmetic. The row and expansion ceilings are properties of
 *  the INDEX, so the same question always gets the same answer. The clock is a
 *  property of the MACHINE, so the same question can get two — and this tool's
 *  own suite caught it doing that: cobra `Command` answered `95/null` and then
 *  `95/446` to two identical calls, because the first ran while the machine was
 *  busy. A total that changes when the load changes is not a fact about the
 *  index, so the clock is not used as the tool's budget: the budget is the work
 *  ceiling, and this is a circuit breaker behind it, for an index large enough
 *  that a work bound would not bound anything.
 *
 *  The first version of it was 1 200 ms, chosen from the cost of one hub. That
 *  was the wrong number in the wrong direction: it fired on answers the work
 *  bound would have delivered, so it was manufacturing declared unknowns on
 *  perfectly measurable symbols — eight of the thirteen measured hubs lost an
 *  exact total to it. What the measurement actually says is that the expansion
 *  ceiling is NOT the cost driver: eleven of twelve hubs give an exact total at a
 *  300-expansion ceiling, at the same wall time as at 2 000, and the three that
 *  stay unknown do so at every ceiling (their closures are wide, not deep). So
 *  the cost is set by the level widths, and 4 000 ms is a breaker that none of
 *  the measured corpora reaches while still capping the pathological one. */
export const IMPACT_TOTAL_TIME_CEILING_MS = 4_000

export interface ImpactTotalCount {
  /** Distinct dependent symbols under the declared rule, transitive to
   *  `maxDepth`; null when the scan ceiling was reached (declared unknown,
   *  never a partial count wearing a total's name). */
  total: number | null
  /** The SHORTEST path to each dependent, as this walk measured it. A
   *  breadth-first walk reaches a node by the fewest edges there is, so these
   *  are the depths the answer should report — the engine's caller walk is
   *  depth-first and stamps the first trace instead (M63.T2). */
  depths: Map<string, number>
  /** Distinct dependents at depth 0 — always exact, always cheap, and the
   *  number a reader can always trust even when `total` is null. */
  direct: number
  /** Rows the walk read (the declared cost of the answer). */
  rowsScanned: number
  /** Symbols the walk opened (the other declared cost bound). */
  expansions: number
  hitScanCeiling: boolean
  /** M63.T2: the walk stopped on the WALL CLOCK, not on a declared work bound.
   *  A separate field from `hitScanCeiling` because the two mean different
   *  things to a reader: the work ceilings are properties of the INDEX (the
   *  same question always gives the same answer), and the clock is a property
   *  of the MACHINE (the same question can give a different one). Keeping them
   *  apart is what lets a reader — and the lane's stability law — tell a
   *  structural unknown from a busy one. */
  timedOut: boolean
  /** The walk's composition by HOW each dependent is a dependent, measured
   *  under the same rule as `total`. See `ImpactResult.cascade`. */
  cascade: { exact: number; member: number; rangeFolded: number } | null
  /** For each dependent, the walk node whose expansion FOUND it — so the
   *  shortest path to it is one edge from that node, and the stored row behind
   *  that edge is one indexed lookup away. First discovery wins, and the walk is
   *  breadth-first, so this is the SHORTEST path's parent and not merely some
   *  parent. This is what lets the answer quote a row at its own reported depth
   *  rather than the engine's first-trace row. */
  parents: Map<string, string>
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
  options: {
    maxDepth?: number
    scanCeiling?: number
    expansionCeiling?: number
    timeCeilingMs?: number
    relationshipTypes?: readonly string[]
  } = {},
): ImpactTotalCount {
  const maxDepth = options.maxDepth ?? IMPACT_BUDGET.maxDepth
  const scanCeiling = options.scanCeiling ?? IMPACT_TOTAL_SCAN_CEILING
  const expansionCeiling = options.expansionCeiling ?? IMPACT_TOTAL_EXPANSION_CEILING
  const timeCeilingMs = options.timeCeilingMs ?? IMPACT_TOTAL_TIME_CEILING_MS
  const startedAt = Date.now()
  // The kinds the WALK was given, not a list of this module's own: the caller
  // hands both the same array, so a total can never describe a set that was
  // measured under a different rule.
  const relTypes = options.relationshipTypes ?? IMPACT_REL_TYPES
  const relPlaceholders = relTypes.map(() => "?").join(",")
  // One level, one statement. Every symbol at the same distance from the root
  // is asked about at once, so the walk asks "who depends on ANY of these" once
  // per level instead of once per symbol.
  //
  // The statement is a flat IN list of the batch's ids plus one range predicate
  // per DISTINCT cascade range in it — not one disjunction term per member.
  // Two reasons, both measured:
  //   * the disjunction nests, so a level wider than ~400 symbols cannot be
  //     PREPARED at all ("Expression tree is too large"), and that failure
  //     arrives as a declared `null`, indistinguishable from an unreadable
  //     index. A flat list does not nest, and a batch of 200 keeps the
  //     statement inside SQLite's default bound of 999 parameters.
  //   * SQLite evaluates every term of the disjunction against every candidate
  //     row, so the per-batch cost grew superlinearly with the batch. The union
  //     of the per-member ranges IS the union of the distinct ranges — measured:
  //     3 359 level members collapse to ONE — and `m.id = L` for each L is one
  //     list. Same relation: the symmetric difference against the old form is
  //     zero on all six measured hubs, at 1.4-1.7x the speed.
  const BATCH = 200
  const levelSql = (ids: number, ranges: number) =>
    "SELECT s.id AS id, s.name AS name, f.relative_path AS file, r.target_symbol_id AS targetId " +
    "FROM brain_relationship r " +
    "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
    "JOIN brain_file f ON f.id = s.file_id " +
    "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
    "AND r.target_symbol_id IN (SELECT m.id FROM brain_symbol m WHERE m.project_id = ? AND (m.id IN (" +
    new Array(ids).fill("?").join(",") +
    ")" +
    new Array(ranges).fill(" OR (m.owner_symbol_id >= ? AND m.owner_symbol_id < ?)").join("") +
    "))"
  try {
    const found = new Set<string>()
    const depths = new Map<string, number>()
    // Every symbol this walk OPENED, across every level. Kept because it is
    // what decides how a found dependent got in: a target is `exact` if the
    // walk asked about it, `member` if the walk asked about its OWNER, and
    // `range-folded` if neither and the cascade RANGE let it in anyway.
    const opened = new Set<string>()
    const visited = new Set<string>()
    const parents = new Map<string, string>()
    let frontier: Array<{ id: string; depth: number }> = [{ id: rootSymbolId, depth: 0 }]
    let direct = 0
    let rowsScanned = 0
    let expansions = 0
    let hitScanCeiling = false
    let timedOut = false

    while (frontier.length > 0 && !hitScanCeiling) {
      const next: Array<{ id: string; depth: number }> = []
      for (let start = 0; start < frontier.length; start += BATCH) {
        // Per BATCH, not per level. A level can be a thousand symbols, so
        // checking only between levels let the walk overshoot its own ceiling
        // by 67% (measured: a 1 200 ms ceiling costing 2 001 ms). A batch is
        // ONE statement, so checking here bounds the overshoot to that
        // statement and nothing else.
        if (Date.now() - startedAt > timeCeilingMs) {
          // The clock, not a work bound. Named separately so a reader is never
          // told "the index says so" when the machine said so.
          timedOut = true
          hitScanCeiling = true
          break
        }
        const batch = frontier.slice(start, start + BATCH).filter((entry) => !visited.has(entry.id))
        if (batch.length === 0) continue
        for (const entry of batch) {
          if (expansions >= expansionCeiling) {
            hitScanCeiling = true
            break
          }
          visited.add(entry.id)
          opened.add(entry.id)
          expansions++
        }
        if (hitScanCeiling) break
        // The cascade range belongs to the symbol being walked, not to the
        // root: at distance d the members of THAT symbol are the targets whose
        // edges make it a dependent. Using the root's range for every level
        // silently drops the owner-cascade edges of every non-root level —
        // measured on rake `each`: 112 found instead of 143.
        //
        // Distinct ranges, not distinct members: two members of the same
        // container share one range, which is the whole point of the range's
        // construction and the reason the statement stays small on a wide level.
        const ranges = new Map<string, string>()
        for (const entry of batch) {
          const prefix = cascadePrefix(entry.id)
          if (!ranges.has(prefix)) ranges.set(prefix, prefix)
        }
        const params: unknown[] = [projectId, ...relTypes, projectId, ...batch.map((entry) => entry.id)]
        for (const prefix of ranges.values()) params.push(prefix, prefix + ";")
        // `targetId` is the walk node this row actually matched — the member's
        // own id, or a symbol inside a member's cascade range — so the SHORTEST
        // path's parent is recorded rather than "some node in this batch".
        const rows = db.prepare(levelSql(batch.length, ranges.size)).all(...params) as Array<{ id: string; name: string; file: string; targetId: string }>
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
          depths.set(row.id, frontier[0]!.depth)
          // The walk node whose expansion found this one, at the depth recorded.
          // With the flat-list statement one batch can hold several walk nodes,
          // so the parent is the target the row actually matched — the member's
          // own id, or a symbol inside a member's cascade range.
          parents.set(row.id, row.targetId)
          if (frontier[0]!.depth === 0) direct++
          if (frontier[0]!.depth + 1 < maxDepth) next.push({ id: row.id, depth: frontier[0]!.depth + 1 })
        }
      }
      frontier = next
    }
    return {
      total: hitScanCeiling ? null : found.size,
      direct,
      rowsScanned,
      expansions,
      hitScanCeiling,
      timedOut,
      depths,
      parents,
      cascade: classifyCascade(db, projectId, [...found], opened),
    }
  } catch {
    // Unreadable index: the declared unknown, never a guess.
    return {
      total: null,
      direct: 0,
      rowsScanned: 0,
      expansions: 0,
      hitScanCeiling: false,
      timedOut: false,
      depths: new Map(),
      parents: new Map(),
      cascade: null,
    }
  }
}

/** M63.T2: split a dependent set by HOW each member is a dependent.
 *
 *  The walk asked about every symbol it opened. So a found target is:
 *  `exact`      — the walk asked about the target itself;
 *  `member`     — the walk asked about the target's OWNER (the owner cascade
 *                  working as declared);
 *  `range-folded` — neither, and the target is here only because some opened
 *                  symbol's cascade RANGE covered the target's owner without
 *                  naming it. The range runs from a symbol id to the same id
 *                  with its last colon replaced by `;`, so a member widens the
 *                  range to its whole container and every sibling comes with
 *                  it (see `ImpactDependent.via` for the measurement).
 *
 *  One indexed lookup per batch of target ids, after the walk rather than
 *  inside it, so the walk's own statement keeps the shape that was measured to
 *  be fast. A refusal is `null` — a third thing, not zero. */
function classifyCascade(
  db: ImpactDb,
  projectId: string,
  targets: string[],
  opened: Set<string>,
): { exact: number; member: number; rangeFolded: number } | null {
  if (targets.length === 0) return { exact: 0, member: 0, rangeFolded: 0 }
  const ownerById = new Map<string, string | null>()
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const slice = targets.slice(i, i + 400)
      for (const row of db
        .prepare("SELECT id AS id, owner_symbol_id AS owner FROM brain_symbol WHERE project_id = ? AND id IN (" + slice.map(() => "?").join(",") + ")")
        .all(projectId, ...slice) as Array<{ id: string; owner: string | null }>) {
        ownerById.set(row.id, row.owner ?? null)
      }
    }
  } catch {
    return null
  }
  let exact = 0
  let member = 0
  let rangeFolded = 0
  for (const id of targets) {
    if (opened.has(id)) {
      exact++
      continue
    }
    const owner = ownerById.get(id) ?? null
    if (owner !== null && opened.has(owner)) member++
    else rangeFolded++
  }
  return { exact, member, rangeFolded }
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
  /** M63.T2: named options. `relationshipTypes` defaults to the declared
   *  IMPACT_REL_TYPES and is handed to BOTH walks, so the set and its declared
   *  total are always measurements of the same rule. */
  options: { relationshipTypes?: readonly string[] } = {},
): Promise<ImpactResult> {
  const traverse = deps.traverse ?? graphTraversal
  // M63.T2: ONE list, handed to the walk and to the counting walk. The engine
  // applies exactly the kinds it is given, so the set is a measurement of this
  // list and so is the total — not "whatever each side defaulted to".
  const relationshipTypes = options.relationshipTypes ?? IMPACT_REL_TYPES
  const walk = { direction: "callers" as const, maxDepth: IMPACT_BUDGET.maxDepth, relationshipTypes: [...relationshipTypes] }
  let resolution: ImpactResult["resolution"] = { through: "direct" }
  let result: Awaited<ReturnType<typeof graphTraversal>>
  try {
    result = await traverse(projectId, symbolName, walk)
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
    result = await traverse(projectId, owner.name, walk)
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
  // M63.T2: the engine resolves exact names of ANY stored kind (M48.C1), so it
  // roots at a `constant` or an `enum_member` and COMPLETES the walk whenever the
  // name is an exact hit. Measured on the seven cases the D5 ledger named, the
  // engine rooted at the exact requested name in all seven and produced 136–313
  // caller edges — and the door below discarded every one of them, because
  // `resolveMemberIdentity` rule 3 had correctly declined the owner fallback
  // (graphql-js `map` has 221 declared-kind reverse edges of its own, so
  // re-rooting would DROP dependencies) and `null` was read as "no answer".
  //
  // The whitelist's law is "never silently root at a DIFFERENT symbol", and an
  // exact-name root satisfies that by construction: nothing was substituted, so
  // there is nothing to refuse. What the door still refuses, unchanged, is a
  // non-traversable root that is NOT the symbol asked for — a gravity pick, a
  // containment match, a re-root through an owner — because THAT is a relabel.
  //
  // `resolveMemberIdentity` is not touched: its four rules still decide the
  // fallback, and the M55 identity gate still holds. What changes is that the
  // fallback being unnecessary no longer means there is no answer.
  const rootedAtRequestedName = result.root?.name === symbolName
  const kindOutsideWhitelist = rootType.length > 0 && !IMPACT_TRAVERSABLE_ROOT_TYPES.includes(rootType)
  // A name match alone is NOT the symbol the caller asked for: the engine's
  // any-type exact resolve gravity-picks among same-name rows, so a file-HINTED
  // request for an ambiguous member name comes back rooted at a DIFFERENT file's
  // copy — a silent relabel, and the one thing the graph whitelist exists to
  // prevent. Measured by the gate the moment this condition was first written
  // without the hint: `constructor` hinted at `main.ts` answered about
  // `registry.ts`. So all three must hold.
  const { candidates: nameCandidates, total: nameTotal } = listNameCandidates(db, projectId, symbolName)
  const hintMatchesRoot =
    memberFile !== undefined && typeof result.root?.file === "string" && memberFileMatches(memberFile, result.root.file)
  // Ambiguity is judged on the TRUE count, never on the bounded list: a name with
  // 36 stored symbols is ambiguous even when the message shows eight of them.
  const nameIsUnambiguous = nameTotal === 1 || ((nameTotal === null || nameTotal > 1) && hintMatchesRoot)
  // The exemption is scoped to the two kinds the D5 ledger MEASURED as
  // unanswerable, and both are value-like: an enum VARIANT and a module-level
  // `constant` are things a refactoring question is asked ABOUT, and their own
  // dependents are the answer.
  //
  // It is deliberately NOT scoped to every non-traversable kind. `constructor`,
  // `property`, `field` and the rest are the U5 law's subject (M44/M55): a hover
  // that resolved a member's identity means the OWNING declaration is the
  // question, and routing them through the owner is that law, not a workaround.
  // Widening the scope is what broke M55's R5 the first time this was written —
  // the m55 fixture's hinted `constructor` picks up a declared-kind row from the
  // real indexer, so "has its own reverse edges" was true and the exemption
  // answered about the constructor instead of `Store`. A measured allowlist of
  // the two kinds that were measured is narrower and honest about its own
  // evidence; "everything the whitelist excludes" was neither.
  const VALUE_LIKE_KINDS = ["enum_member", "constant"]
  const exemptKind =
    kindOutsideWhitelist && rootedAtRequestedName && nameIsUnambiguous && VALUE_LIKE_KINDS.includes(rootType) ? rootType : null
  if (kindOutsideWhitelist && exemptKind === null) {
    const owner = resolveImpactMemberOwner(db, projectId, symbolName, memberFile)
    if (owner === null) {
      // A refusal that names what it could have answered is a different thing
      // from a refusal that does not. The candidates are one indexed equality on
      // `brain_sym_proj_name_idx`, already read for `rootMatch.nameMatches`, and
      // they are what turns "you cannot ask about this" into "ask again with one
      // of these".
      const candidates =
        (nameTotal ?? 0) > 1
          ? ` — ${nameTotal} stored symbols carry that name: ${nameCandidates
              .slice(0, 8)
              .map((c) => `${c.file || "?"}:${c.line}`)
              .slice(0, 8)
              .join(", ")}${nameTotal !== null && nameTotal > 8 ? `, +${nameTotal - 8} more` : ""}; re-ask with a file`
          : ""
      throw new Error(
        `bb/impact: symbol '${symbolName}' is not a traversable root (${rootType}) — no impact set exists` +
          ` (declared error: the symbol was not found as a traversable root${
            memberFile
              ? "; the hinted file does not disambiguate it — hover a symbol that was indexed"
              : "; run `bb index` or check the name"
          }${candidates})`,
      )
    }
    result = await traverse(projectId, owner.name, walk)
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
      // Provisional, and rewritten below wherever `depth` moved: the evidence
      // below belongs to the engine's row, and the engine's row may not be the
      // one at the shortest path this entry reports.
      evidenceAtDepth: edge.depth,
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
      // The engine already classifies every caller row as `exact` or
      // `owner-cascade` and names the member it matched (bb_graph publishes
      // both). Reading them here is the point: a second derivation would be the
      // defect M55.T5 exists to prevent, and a dropped field is the defect D10
      // was filed for.
      via: edge.targetMatch === "owner-cascade" ? "member" : "exact",
      ...(edge.matchedMember ? { viaMember: edge.matchedMember } : {}),
      // The walk node this row was found at, which is what the cascade
      // classification below judges the named member against. It stays off the
      // wire: it is an internal id the reader has no use for, and `via` is the
      // reader-facing half of the same fact.
      tracedId: edge.to,
    })
  }
  // M63.T2: `owner-cascade` is not the same thing as a real member. The named
  // member is looked up once (name + file, both indexed) and its OWNER decides:
  // an owner equal to the symbol the walk was at is the cascade working as
  // declared, and anything else is here only because the range widened. The
  // answer then declares how many of its rows are which, so a conservative
  // over-count is visible instead of silent. A lookup the index refuses leaves
  // the rows at `member` and the declared breakdown null — never zero.
  // One lookup per DISTINCT member the answer names, not one per row: a class
  // with forty cascaded callers names one member forty times.
  const memberOwner = new Map<string, string>()
  let unresolvedMembers = 0
  for (const entry of impact) {
    if (entry.via !== "member" || !entry.viaMember) continue
    // The walk node this row was found at, so the member's owner can be judged
    // against the symbol whose range let it in — and memoised WITH it, because
    // the same member reached from two different walk nodes is two different
    // questions.
    const traced = entry.tracedId ?? ""
    const key = `${entry.viaMember.name}\u0000${entry.viaMember.file}\u0000${traced}`
    if (!memberOwner.has(key)) {
      const owner = memberOwnerOf(db, projectId, entry.viaMember, traced)
      memberOwner.set(key, owner)
      if (owner === "unknown") unresolvedMembers++
    }
    if (memberOwner.get(key) === "range-folded") entry.via = "range-folded"
  }
  // M63.T2: an engine reason that describes a KIND FILTER is not a bound. The
  // engine's default is now every stored kind, so a caller that passes one
  // (this component passes the declared dependency kinds) has the filter
  // recorded in its reason set — and folding that into `truncationReason`
  // would make every answer `truncated: true`, because every answer filters.
  // The filter is declared where it belongs, in `rule.relationshipTypes`;
  // `truncated` keeps its one meaning: this set is a PREFIX of the declared
  // rule's whole truth.
  // M63.T2: the reason SET is kept, not just its first clause, because the
  // clauses are not equal in kind. `caller-site-limit` and
  // `walk-time-budget-exhausted` can both fire on the same call, and a
  // time-bounded answer is not reproducible — so a reader comparing two answers
  // must not see the same declared reason on both while the row counts differ.
  const reasons: string[] = []
  for (const reason of (result.summary?.truncationReason ?? "").split("+")) {
    const clause = reason.trim()
    if (clause.length === 0 || clause.startsWith("relationshipTypes:")) continue
    truncated = true
    if (!reasons.includes(clause)) reasons.push(clause)
  }
  // A time bound, named separately: it is the one clause that says the answer
  // depends on the machine, so it is never left to be inferred from a sibling.
  const walkTimeBoundFired = reasons.some((clause) => clause === "walk-time-budget-exhausted")
  truncationReason = truncationReason ?? (reasons.length > 0 ? `traversal: ${reasons.join("+")}` : null)
  if (walkTimeBoundFired) {
    truncationReason = truncationReason === null ? "walk: time-budget-exhausted" : `${truncationReason} (walk: time-budget-exhausted — this answer is not reproducible)`
  }

  // M63.T1: the declared total is measured under the SAME rule the walk used
  // (kinds, cascade, noise, depth) with no node budget, so it is the size of
  // the set this answer is a prefix of.
  const directFromSet = impact.reduce((n, entry) => (entry.depth === 0 ? n + 1 : n), 0)
  const depthReached = impact.reduce((n, entry) => (entry.depth > n ? entry.depth : n), 0)

  // M63.T2 — the tool now PROVES its own completeness instead of inferring it
  // from the engine's `truncated` flag.
  //
  // That flag is the engine's honest account of ITS bounds: the node budget,
  // the per-query site limit and the caller budget all declare themselves. It
  // is silent about one more thing. The caller walk recurses depth-first and
  // gives a node the depth of the first trace that reached it, so a symbol ONE
  // hop from the root can be first reached four hops in; when the depth cap
  // then forbids expanding it, its own dependents are dropped and no bound has
  // fired. Measured on this lane's corpora: cobra `HasAvailableFlags` answered
  // 27 of 28 dependents with `truncated: false`, and across nine repositories
  // 21 of 47 hub answers carried dependents at a deeper depth than their real
  // one.
  //
  // The walk is the engine's, so the engine's owner fixes that. But the CLAIM
  // is this component's, and a claim it cannot support must not be made. The
  // counting walk is exactly the measurement that settles it — same rule, no
  // node budget, and therefore no order-dependence: if the unbounded count
  // agrees with the returned set, the set IS the whole truth whatever the
  // engine said; if the count is larger, the answer is a prefix and says so
  // with a declared reason.
  //
  // The verification is not paid for on every call, because it cannot prove
  // anything the walk could not in one case: a node is dropped at the boundary
  // only if it sits at the last expandable depth (maxDepth - 1). If the walk
  // never reached that depth, no node was ever blocked, every bound that could
  // have fired has declared itself, and the set is complete by construction.
  // So the count runs exactly on the answers that could be wrong.
  const boundaryReached = depthReached >= IMPACT_BUDGET.maxDepth - 1
  // M63.T2: the cheap form of the question. A node can be lost at the boundary
  // only if it sits at the last expandable depth, so one query over THAT
  // LEVEL's nodes decides whether anything was lost; the unbounded counting
  // walk — the only thing that can say what the true total is, and the only way
  // to correct a mis-stamped depth — runs only when this says maybe, or when
  // truncation was already declared. Measured: it moved the warm median from
  // ~740 ms to ~180 ms over the lane's corpora with no answer changed.
  const boundarySuspect = boundaryReached && boundaryHasDependents(db, projectId, impact, relationshipTypes)
  const verify = truncated || boundarySuspect
  const counts = verify
    ? countImpactDependents(db, projectId, result.root.id, { maxDepth: IMPACT_BUDGET.maxDepth, relationshipTypes })
    : {
        total: impact.length,
        direct: directFromSet,
        hitScanCeiling: false,
        timedOut: false,
        depths: new Map<string, number>(),
        parents: new Map<string, string>(),
        cascade: null,
      }
  // The measured depths are the shortest paths, so the answer reports them
  // rather than the walk's first-trace stamps, and the set is re-sorted so
  // "deepest last" remains true of what is actually shown. A dependent the
  // measurement did not reach keeps the walk's depth — that can only happen
  // when the measurement hit its ceiling, which is declared as an unknown.
  if (counts.depths.size > 0) {
    for (const entry of impact as Array<{ id: string; depth: number }>) {
      const measured = counts.depths.get(entry.id)
      if (measured !== undefined && measured !== entry.depth) entry.depth = measured
    }
    impact.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
    // M63.T2: `depth` is now the measured shortest path, and the evidence on
    // each entry is the ENGINE's row, which sits on its first trace — a
    // different path whenever that trace was not the shortest one. Measured: 340
    // of 4 258 rows across nine repositories (7.98%), and the suite's
    // cross-language law caught one of them: a dependent reported at depth 0 and
    // labelled cross-language, whose own direct row is not cross-language at all.
    //
    // So every entry whose depth moved gets its evidence re-read from the stored
    // row at ITS depth — the counting walk recorded the parent it was found
    // through, so the row is `(source = this dependent, target = that parent)`.
    // If there is no such row, the evidence fields are nulled: a field the tool
    // cannot attribute is not a field it should publish.
    const reread = new Map<string, ReturnType<typeof storedRowEvidence> | null>()
    for (const entry of impact as Array<ImpactDependent & { evidenceAtDepth: number | null }>) {
      if (entry.evidenceAtDepth === entry.depth) continue
      const parent = counts.parents.get(entry.id)
      if (parent === undefined) {
        entry.relationshipType = null as never
        entry.tier = null as never
        entry.isCrossLanguage = null as never
        entry.bridgeMechanism = null
        entry.confidence = null as never
        entry.evidenceAtDepth = null
        continue
      }
      const key = `${entry.id} ${parent}`
      if (!reread.has(key)) reread.set(key, storedRowEvidence(db, projectId, entry.id, parent, relationshipTypes))
      const row = reread.get(key)
      if (!row) {
        entry.relationshipType = null as never
        entry.tier = null as never
        entry.isCrossLanguage = null as never
        entry.bridgeMechanism = null
        entry.confidence = null as never
        entry.evidenceAtDepth = null
        continue
      }
      entry.relationshipType = row.relationshipType
      entry.confidence = row.confidence
      entry.isCrossLanguage = row.isCrossLanguage
      entry.bridgeMechanism = row.bridgeMechanism
      entry.line = row.line
      // The ONE server-side classifier, on the row being quoted (M55.T5's law: a
      // second derivation here would be the defect that module exists to prevent).
      entry.tier = classifyTier({
        relationshipType: row.relationshipType,
        confidence: row.confidence,
        evidenceClass: row.evidenceClass,
      })
      entry.evidenceAtDepth = entry.depth
    }
  }
  // A count that cannot be trusted is worse than no count: when the counting
  // walk hit its ceiling BOTH numbers are null (declared unknown), never a
  // partial count presented as a whole.
  const total = counts.hitScanCeiling ? null : counts.total
  const direct = counts.hitScanCeiling ? null : counts.direct
  if (verify && counts.hitScanCeiling) {
    // Completeness could not be established either way, and no bound declared
    // it. Say that rather than letting the reader assume the whole set.
    truncated = true
    truncationReason = truncationReason ?? "impact-completeness-unverifiable-at-depth-boundary"
  } else if (verify && counts.total !== impact.length) {
    // The set is short of an unbounded walk of the same rule: it is a prefix of
    // a larger truth, and it says that instead of claiming to be the whole.
    truncated = true
    truncationReason = truncationReason ?? "impact-set-shorter-than-unbounded-walk"
  }
  // M63.T2: a time bound on EITHER side makes the answer unreproducible, and the
  // reason has to say so. The engine's walk-time clause is handled where the
  // engine's reasons are read; this is the counting walk's own breaker, and it
  // fires LATER than that, so it could not be folded in there. Caught by the
  // suite's law: `cargo/project` came back `reproducible: false` with the reason
  // `impact-node-budget-exhausted`, which names a bound of the INDEX and so reads
  // as reproducible when it is not.
  if (verify && counts.timedOut === true) {
    truncated = true
    const clause = "count: time-budget-exhausted — this answer is not reproducible"
    truncationReason = truncationReason === null ? clause : `${truncationReason} (${clause})`
  }
  const summary = result.summary
  // A member whose owner the index refused is not evidence that it is a member,
  // so the breakdown is then UNESTABLISHED: `null` says so where a count would
  // read as a measurement.
  let cascade: ImpactResult["cascade"] = { exact: 0, member: 0, rangeFolded: 0 }
  if (unresolvedMembers === 0) {
    let exact = 0
    let member = 0
    let rangeFolded = 0
    for (const entry of impact) {
      if (entry.via === "exact") exact++
      else if (entry.via === "member") member++
      else rangeFolded++
    }
    cascade = { exact, member, rangeFolded }
  } else {
    cascade = null
  }
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
      totalTimeCeilingMs: IMPACT_TOTAL_TIME_CEILING_MS,
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
            ? exemptKind === null
              ? "exact"
              : "exact-exempt-kind"
            : "fuzzy-containment",
      // From the SAME rows the declared error lists, so the count a reader sees
      // in the payload and the list they see in a refusal are one measurement.
      nameMatches: nameTotal !== null ? nameTotal : countExactNameMatches(db, projectId, symbolName),
    },
    rule: {
      relationshipTypes: [...relationshipTypes],
      cascade: "owner-cascade: a relationship stored against a member of a class is attributed to the whole owner family. The RANGE that implements it widens to the member's whole container, so siblings are folded in too; `cascade.rangeFolded` counts how many rows that accounts for in this answer",
      noisePolicy: "hard-noise symbol names and paths are excluded, as in every other analysis surface",
      maxDepth: IMPACT_BUDGET.maxDepth,
    },
    cascade,
    countVerification: { ran: verify, timedOut: verify && counts.timedOut === true, boundarySuspect },
    reproducible: !walkTimeBoundFired && !(verify && counts.timedOut === true),
  }
}

/** M63.T2: the stored row that makes `dependent` a dependent of `parent`, and
 *  the evidence it carries. One indexed equality on a unique pair, memoised per
 *  `(dependent, parent)` by the caller.
 *
 *  Null when there is no such row, which is a finding and not a failure: the
 *  answer then publishes no evidence for that entry rather than evidence from
 *  the wrong path. `evidenceClass` is lifted out of the row's metadata so the
 *  ONE classifier decides the tier, from the row being quoted. */
function storedRowEvidence(
  db: ImpactDb,
  projectId: string,
  dependentId: string,
  parentId: string,
  relTypes: readonly string[],
):
  | {
      relationshipType: string
      confidence: number
      isCrossLanguage: boolean
      bridgeMechanism: string | null
      line: number
      evidenceClass: string | null
    }
  | null {
  try {
    const row = db
      .prepare(
        "SELECT r.relationship_type AS relType, r.confidence AS confidence, r.is_cross_language AS isCross, " +
          "r.bridge_mechanism AS bridge, r.line_number AS line, r.metadata AS meta " +
          "FROM brain_relationship r WHERE r.project_id = ? AND r.source_symbol_id = ? AND r.target_symbol_id = ? " +
          "AND r.relationship_type IN (" + relTypes.map(() => "?").join(",") + ") LIMIT 1",
      )
      .get(projectId, dependentId, parentId, ...relTypes) as
      | { relType: string; confidence: number | null; isCross: number | null; bridge: string | null; line: number | null; meta: string | null }
      | undefined
    if (!row) return null
    let evidenceClass: string | null = null
    if (row.meta) {
      try {
        const parsed = JSON.parse(row.meta) as { evidenceClass?: unknown }
        if (typeof parsed.evidenceClass === "string") evidenceClass = parsed.evidenceClass
      } catch {
        evidenceClass = null
      }
    }
    return {
      relationshipType: row.relType,
      confidence: typeof row.confidence === "number" ? row.confidence : 0,
      isCrossLanguage: row.isCross === 1,
      bridgeMechanism: row.bridge ?? null,
      line: typeof row.line === "number" ? row.line : 0,
      evidenceClass,
    }
  } catch {
    return null
  }
}

/** M63.T2: the owner of the member a cascade row named, resolved from its name
 *  and file, or `"range-folded"` when that owner is inside the walked symbol's
 *  cascade range without being it.
 *
 *  `"unknown"` means the index could not resolve the member, and is not the
 *  same answer as `"range-folded"`: one is a refusal, the other is a finding.
 *  Both are indexed lookups (name, then file), memoised by the caller, so an
 *  answer pays once per DISTINCT member it names. */
function memberOwnerOf(
  db: ImpactDb,
  projectId: string,
  member: { name: string; file: string },
  tracedId: string,
): "member" | "range-folded" | "unknown" {
  try {
    const file = db
      .prepare("SELECT id AS id FROM brain_file WHERE project_id = ? AND (relative_path = ? OR path = ?) LIMIT 1")
      .get(projectId, member.file, member.file) as { id: string } | undefined
    if (!file) return "unknown"
    // ALL the stored rows for that name in that file, not one of them. Measured:
    // ripgrep's `matcher.rs` stores `non_matching_bytes` twice (a method at :481
    // and a property at :379) and `RegexMatcher` three times (the struct and two
    // `impl` blocks), so `LIMIT 1` here would be a coin toss presented as a
    // measurement. A file can hold an overload, a generic instantiation, or —
    // in Rust — one struct with several `impl` blocks, and the classification
    // below is only as good as the candidate set it reads.
    const rows = db
      .prepare("SELECT id AS id, owner_symbol_id AS owner FROM brain_symbol WHERE project_id = ? AND file_id = ? AND name = ?")
      .all(projectId, file.id, member.name) as Array<{ id: string; owner: string | null }>
    if (rows.length === 0) return "unknown"
    // The member the row named, judged against the symbol the walk was AT.
    // `member` when ANY candidate is owned by it — a real member existing is
    // evidence the row is a real cascade, and the field's job is to catch the
    // rows that are NOT. `range-folded` when every candidate's owner is inside
    // the walk node's cascade RANGE without being the walk node. Anything else
    // — the engine matched it by a path this module cannot see — keeps the
    // engine's own `owner-cascade` rather than being relabelled into a finding
    // this module did not establish.
    const prefix = cascadePrefix(tracedId)
    let sawRangeOnly = false
    for (const row of rows) {
      if (row.owner === null || tracedId.length === 0 || row.owner === tracedId) return "member"
      if (prefix.length === 0 || row.owner < prefix || row.owner >= prefix + ";") return "member"
      sawRangeOnly = true
    }
    return sawRangeOnly ? "range-folded" : "member"
  } catch {
    return "unknown"
  }
}

/** Do any of the LAST-LEVEL dependents have dependents of their own that the
 *  walk had no room to expand? One query over that level's node ids, under the
 *  declared kinds and the noise policy.
 *
 *  This is the whole boundary question, cheaply: a node the walk never
 *  expanded is a node at the last expandable depth, so if the last level has no
 *  dependents, the walk expanded everything it had room to expand and the
 *  returned set is the whole truth. If it has some, the answer may be a prefix
 *  and the caller pays for the full measurement to find out which. */
function boundaryHasDependents(
  db: ImpactDb,
  projectId: string,
  impact: ImpactResult["impact"],
  relationshipTypes: readonly string[],
): boolean {
  const lastDepth = Math.max(0, ...impact.map((entry) => entry.depth))
  if (lastDepth === 0) return false // nothing sat at a boundary: the root's own
  const boundary = impact.filter((entry) => entry.depth === lastDepth).map((entry) => entry.id)
  if (boundary.length === 0) return false
  const placeholders = relationshipTypes.map(() => "?").join(",")
  const row = db
    .prepare(
      "SELECT 1 AS any FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
        "WHERE r.project_id = ? AND r.relationship_type IN (" + placeholders + ") " +
        "AND r.source_symbol_id IN (" + boundary.map(() => "?").join(",") + ") LIMIT 1",
    )
    .get(projectId, ...relationshipTypes, ...boundary) as { any: number } | undefined
  return row !== undefined
}

/** The stored symbols carrying exactly this name, with the file and line a
 *  reader needs to disambiguate with, and the UNTRUNCATED count of them.
 *
 *  The count and the list are separate because they are separate claims. A
 *  bounded list is right — an error message listing 400 rows helps nobody — but
 *  `rootMatch.nameMatches` is a MEASUREMENT and a capped one is a different
 *  number wearing a measurement's name. The corpus suite's H10 caught that
 *  exactly: ripgrep `Error` has 36 stored symbols and the payload said 32,
 *  because the candidate query carried the limit and the count was read off the
 *  rows it returned. So the count is its own `COUNT(*)`, and the list is
 *  bounded at 32 rows for the message.
 *
 *  One indexed equality on `brain_sym_proj_name_idx` for each — the same index
 *  `countExactNameMatches` uses, and a refusal must rest on the same
 *  measurement the payload publishes. */
function listNameCandidates(
  db: ImpactDb,
  projectId: string,
  symbolName: string,
): { candidates: Array<{ file: string; line: number }>; total: number | null } {
  try {
    const total = db
      .prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ? AND name = ?")
      .get(projectId, symbolName) as { c: number } | undefined
    // A NULL `line_start` is the indexer's own state for a symbol it could not
    // place, so it is shown as 0 rather than dropped: a candidate without a line
    // is still a candidate, and dropping it would make the list incomplete.
    const candidates = (
      db
        .prepare(
          "SELECT COALESCE(f.relative_path, f.path, '') AS file, s.line_start AS line FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ? ORDER BY COALESCE(f.relative_path, f.path, ''), s.line_start LIMIT 32",
        )
        .all(projectId, symbolName) as Array<{ file: string; line: number | null }>
    ).map((row) => ({ file: row.file, line: typeof row.line === "number" ? row.line : 0 }))
    return { candidates, total: typeof total?.c === "number" ? total.c : null }
  } catch {
    return { candidates: [], total: null }
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
