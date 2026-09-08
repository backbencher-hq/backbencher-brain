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
  resolution?: { through: "direct" | "owning-declaration"; memberName?: string; ownerName?: string }
}

export interface ImpactDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
}

export interface ImpactDeps {
  traverse?: typeof graphTraversal
}

/** The member-resolution fallback (M44.U5, issue #692). The engine's root
 *  resolver whitelists traversable symbol types ('function','method','class',
 *  ...); an indexed member the whitelist excludes (a constructor, a plain
 *  member) must not die at the impact door — it roots through its OWNING
 *  declaration. Returns the owner row only when ALL of:
 *    1. the name resolves to exactly one stored symbol (exact, project-
 *       scoped — never fuzzy here: a member fallback must be certain),
 *    2. that symbol's type is outside the engine's traversable whitelist
 *       (otherwise the direct path already handled it),
 *    3. the member has no stored reverse edges of its own (its own impact
 *       set would be non-empty — resolving through the owner then would
 *       DROP real dependencies), and
 *    4. the owner (via owner_symbol_id) exists and is a traversable type.
 *  Any other outcome returns null and the caller keeps the declared error —
 *  a genuinely absent symbol never silently becomes someone else's impact. */
export function resolveImpactMemberOwner(
  db: ImpactDb,
  projectId: string,
  symbolName: string,
): { id: string; name: string; file: string } | null {
  try {
    const TRAVERSABLE = ["function", "method", "class", "interface", "trait", "struct", "enum", "macro"]
    const memberRows = db
      .prepare(
        `SELECT s.id, s.name, s.symbol_type AS symbolType, s.owner_symbol_id AS ownerId,
                COALESCE(f.relative_path, f.path, '') AS file
         FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.name = ?`,
      )
      .all(projectId, symbolName) as Array<{ id: string; name: string; symbolType: string; ownerId: string | null; file: string }>
    // Rule 1: exactly one exact member match (ambiguous name -> declared
    // error path, never a guessed owner).
    if (memberRows.length !== 1) return null
    const member = memberRows[0]!
    // Rule 2: the direct path handles traversable types — no fallback here.
    if (TRAVERSABLE.includes(member.symbolType)) return null
    // Rule 3: the member's OWN reverse edges exist -> its own impact set is
    // real; resolving through the owner would drop dependencies. Declared
    // error (unchanged behavior) is the honest answer for that shape.
    const inbound = db
      .prepare(
        `SELECT COUNT(*) AS c FROM brain_relationship
         WHERE project_id = ? AND target_symbol_id = ?
           AND relationship_type IN ('calls','instantiates','extends','implements')`,
      )
      .get(projectId, member.id) as { c: number }
    if (typeof inbound?.c === "number" && inbound.c > 0) return null
    // Rule 4: the owner must exist and be traversable (the cascade needs a
    // real root; the owner prefix cascade in the engine does the rest).
    if (!member.ownerId) return null
    const ownerRows = db
      .prepare(
        `SELECT s.id, s.name, s.symbol_type AS symbolType,
                COALESCE(f.relative_path, f.path, '') AS file
         FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.id = ?`,
      )
      .all(projectId, member.ownerId) as Array<{ id: string; name: string; symbolType: string; file: string }>
    if (ownerRows.length !== 1) return null
    const owner = ownerRows[0]!
    if (!TRAVERSABLE.includes(owner.symbolType)) return null
    return { id: owner.id, name: owner.name, file: owner.file }
  } catch {
    // Unreadable index: null -> the caller's declared error stands (never a
    // crash disguised as resolution).
    return null
  }
}

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
): Promise<ImpactResult> {
  const traverse = deps.traverse ?? graphTraversal
  let resolution: ImpactResult["resolution"] = { through: "direct" }
  let result: Awaited<ReturnType<typeof graphTraversal>>
  try {
    result = await traverse(projectId, symbolName, { direction: "callers", maxDepth: IMPACT_BUDGET.maxDepth })
  } catch (error) {
    // Member fallback (declared, narrow): only when the direct traversal
    // could not resolve the name AND the member-resolution rules all hold.
    const owner = resolveImpactMemberOwner(db, projectId, symbolName)
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
    resolution = { through: "owning-declaration", memberName: symbolName, ownerName: owner.name }
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
