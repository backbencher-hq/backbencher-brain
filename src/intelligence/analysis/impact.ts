// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the deprecated component-level change-impact calculator
//   (`analyzeImpact`), retained as an exported unit for the legacy analysis gate.
// WHICH TOOL IT SERVES — none directly. `bb_analyze` mode=impact aggregates the
//   canonical `src/lsp/impact.ts` walk (`computeImpact`); no public tool calls
//   this function.
// WHY IT IS SHAPED THIS WAY — a deprecated calculator is still a calculator, and
//   one measuring a different dependency set would make the legacy reachability
//   proof a proof about a number nothing else agrees with. So it imports the
//   canonical dependency rule (`IMPACT_REL_TYPES`) from its owner instead of
//   re-declaring one, and walks the shared graph engine. Its depth-capped
//   "transitive" scope cannot prove completeness — it can report truncated:false
//   while real dependents exist beyond the cap — which is why no tool surface is
//   wired to it.
// WHERE ITS EVIDENCE LIVES — validation/m15/** and the canonical surface's
//   evidence in validation/tools/bb_impact/**, docs/GRAPH_ENGINE.md; gates:
//   script/m15/verify-analyze-deep.ts, script/verify-analyze.ts,
//   script/m48/verify-p2-honesty-fields.ts (legacy-import guard).
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/impact.ts (IMPACT_REL_TYPES),
//   src/intelligence/contracts.ts (ImpactReport), and the analysis gates above.
// CONTRACTS IT MUST NOT BREAK — the dependency rule is imported, never
//   re-declared; read-only operation; the ImpactReport shape the gates read.
// ─────────────────────────────────────────────────────────────────────────────

import { graphTraversal } from "../graph/graph-engine"
// The DEPENDENCY rule, imported from its owner. This legacy unit once counted
// every stored kind as a reverse dependency, which is the defect the canonical
// surface fixed (a class declared 57 reverse dependencies of which 8 were
// dependency rows).
import { IMPACT_REL_TYPES } from "../../lsp/impact"
import type { ProjectID } from "../../project/schema"
import type { ImpactReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "impact@intelligence"
const ENGINE_VERSION = "m10.04"

// Change impact: who is affected when the target changes. Built over the shared
// graph engine (callers direction) under the DECLARED dependency rule
// (IMPACT_REL_TYPES: calls, instantiates, extends, implements) — the same rule
// the canonical surface walks, so `directSymbols` is a count of dependents and
// not of rows. `contains` is what that excludes and why it matters: it is the
// parent -> member edge, so under an all-kinds default a class would report its
// own methods as symbols affected by a change to it, and a changed method would
// count the class that merely holds it. Distinguishes direct (depth 0),
// transitive (depth > 0), and global (full traversal). Reports cross-language and
// unresolved edges. Makes NO test-coverage claims (that belongs to the test
// intelligence surface).
export async function analyzeImpact(
  projectId: ProjectID,
  target: string,
  options: { scope?: "direct" | "transitive" | "global"; maxDepth?: number } = {},
): Promise<ImpactReport> {
  const scope = options.scope ?? "transitive"
  const maxDepth = scope === "direct" ? 1 : options.maxDepth ?? (scope === "global" ? 10 : 3)

  let graph
  try {
    graph = await graphTraversal(projectId, target, {
      direction: "callers",
      maxDepth,
      relationshipTypes: [...IMPACT_REL_TYPES],
    })
  } catch {
    return {
      target,
      found: false,
      scope,
      directSymbols: 0,
      affectedFiles: [],
      transitiveFiles: 0,
      crossLanguageFiles: 0,
      unresolvedEdges: 0,
      riskLevel: "low",
      truncated: false,
      provenance: makeProvenance({ evidenceClass: "unknown", engine: ENGINE, engineVersion: ENGINE_VERSION, projectId, source: "graph-engine-not-available", limitations: ["Target not found or graph engine errored."], unknowns: ["graph-traversal-failed"] }),
    }
  }

  const affectedByFile = new Map<string, { file: string; via: string; depth: number; crossLanguage: boolean }>()
  let unresolvedEdges = 0
  let directSymbols = 0

  for (const edge of graph.callers) {
    const node = graph.nodes[edge.from]
    if (!node) continue
    if (node.isExternal) {
      unresolvedEdges++
      continue
    }
    if (edge.depth === 0) directSymbols++
    const key = node.file
    const existing = affectedByFile.get(key)
    if (!existing || edge.depth < existing.depth) {
      affectedByFile.set(key, {
        file: node.file,
        via: node.name,
        depth: edge.depth,
        crossLanguage: edge.isCrossLanguage,
      })
    }
  }

  const affectedFiles = Array.from(affectedByFile.values()).sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file))
  const transitiveFiles = affectedFiles.filter((f) => f.depth > 0).length
  const crossLanguageFiles = affectedFiles.filter((f) => f.crossLanguage).length

  const total = affectedFiles.length
  const riskLevel: ImpactReport["riskLevel"] =
    total >= 20 || crossLanguageFiles > 0 ? "critical" : total >= 8 ? "high" : total >= 3 ? "medium" : "low"

  return {
    target,
    found: true,
    scope,
    directSymbols,
    affectedFiles,
    transitiveFiles,
    crossLanguageFiles,
    unresolvedEdges,
    riskLevel,
    truncated: graph.summary.truncated,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: ENGINE, engineVersion: ENGINE_VERSION, projectId, source: "brain_relationship+brain_symbol+brain_file", limitations: ["Impact is bounded by graph traversal depth and indexed edges; unresolved external edges are reported but not followed."], truncated: graph.summary.truncated }),
  }
}
