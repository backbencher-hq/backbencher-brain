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
//
// Declared guarantees (gated by script/m26/verify-impact-mode.ts):
//   G1 bounded:    result size <= declared budget; depth <= declared max
//   G2 declared:   truncated == true ⟺ a declared reason exists; counts real
//   G3 consistent: impact count agrees with L3 references on flat fixtures
//                  (differential, sampling stated in the verifier)
//   G4 rendered:   the ONE core's renderImpact() emits a visible marker with
//                  counts when truncated, nothing when complete

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
  /** reverse dependencies, bounded, deepest last */
  impact: Array<{ id: string; name: string; file: string; depth: number; relationshipType: string; confidence: number }>
  shownCount: number
  /** Total reverse dependencies if it could be bounded cheaply; null when
   *  the honest answer is "unknown" (never a fabricated total). */
  totalCountIfKnown: number | null
  truncated: boolean
  truncationReason: string | null
}

export interface ImpactDb {
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

export interface ImpactDeps {
  traverse?: typeof graphTraversal
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
 *  and inventing an empty one would read as "no one depends on this". */
export async function computeImpact(
  db: ImpactDb,
  projectId: string,
  symbolName: string,
  deps: ImpactDeps = {},
): Promise<ImpactResult> {
  const traverse = deps.traverse ?? graphTraversal
  const result = await traverse(projectId, symbolName, { direction: "callers", maxDepth: IMPACT_BUDGET.maxDepth })
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
  }
}
