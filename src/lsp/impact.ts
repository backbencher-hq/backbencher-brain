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
  root: { id: string; name: string; file: string }
  /** Reverse dependencies, bounded, deepest last. */
  impact: Array<{ id: string; name: string; file: string; depth: number; relationshipType: string; confidence: number }>
  shownCount: number
  /** Total reverse dependencies if it could be bounded cheaply; null when
   *  the honest answer is "unknown" (never a fabricated total). */
  totalCountIfKnown: number | null
  truncated: boolean
  truncationReason: string | null
  /** M44.U5: how the root was resolved. "direct" = the name resolved to a
   *  traversable root (the engine's whitelist); "owning-declaration" = the
   *  name is an indexed member the whitelist excludes (constructor, plain
   *  members), rooted through its owner with the member named. First-class
   *  so the UI states what it rooted at — never a silent relabel. */
  resolution?: { through: "direct" | "owning-declaration"; memberName?: string; ownerName?: string; memberFile?: string }
}

export interface ImpactDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
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

/** Independent bounded count of distinct reverse-dependency symbols under the
 *  same containment rule. Returns null only when the count query itself
 *  fails (declared unknown). */
export function totalImpactCountIfKnown(db: ImpactDb, rootSymbolId: string): number | null {
  try {
    const prefix = rootSymbolId.includes(":") ? rootSymbolId.slice(0, rootSymbolId.lastIndexOf(":") + 1) : ""
    const upper = prefix + ";"
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT r.source_symbol_id) AS c
         FROM brain_relationship r
         WHERE r.target_symbol_id = ?
            OR (r.target_symbol_id IN (
              SELECT m.id FROM brain_symbol m
              WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ?
            ) AND r.target_symbol_id IS NOT NULL)`,
      )
      .get(rootSymbolId, prefix, upper) as { c: number }
    return typeof row?.c === "number" ? row.c : null
  } catch {
    return null
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
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    const node = result.nodes[nodeId] as GraphNode | undefined
    impact.push({
      id: nodeId,
      name: node?.name ?? nodeId,
      file: node?.file ?? "",
      depth: edge.depth,
      relationshipType: edge.relationshipType,
      confidence: edge.confidence,
    })
  }
  if (result.summary?.truncated && result.summary.truncationReason) {
    truncated = true
    truncationReason = truncationReason ?? `traversal: ${result.summary.truncationReason}`
  }

  const total = truncated ? totalImpactCountIfKnown(db, result.root.id) : impact.length
  return {
    root: { id: result.root.id, name: result.root.name, file: result.root.file },
    impact,
    shownCount: impact.length,
    totalCountIfKnown: total,
    truncated,
    truncationReason,
    resolution,
  }
}
