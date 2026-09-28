import { graphTraversal } from "../graph/graph-engine"
import type { ProjectID } from "../../project/schema"
import type { ImpactReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "impact@intelligence"
const ENGINE_VERSION = "m10.04"

// M48.P1/P2 (#696/#697): DEPRECATED as a tool-surface calculator. bb_analyze
// mode=impact aggregates the canonical computeImpact walk (src/lsp/impact.ts)
// since M48.P1; this function is no longer reachable from any public tool and
// its depth-capped "transitive" scope could report truncated:false while real
// dependents exist beyond the cap. Retained only as an exported unit for the
// M15 legacy gate (which asserts reachability, never truncation). Do not wire
// it into a tool handler; the M48.P2 gate fails if a handler imports it.

// Change impact: who is affected when the target changes. Built over the shared
// graph engine (callers direction). Distinguishes direct (depth 0), transitive
// (depth > 0), and global (full traversal). Reports cross-language and
// unresolved edges. Makes NO test-coverage claims (that belongs to M9.10).
export async function analyzeImpact(
  projectId: ProjectID,
  target: string,
  options: { scope?: "direct" | "transitive" | "global"; maxDepth?: number } = {},
): Promise<ImpactReport> {
  const scope = options.scope ?? "transitive"
  const maxDepth = scope === "direct" ? 1 : options.maxDepth ?? (scope === "global" ? 10 : 3)

  let graph
  try {
    graph = await graphTraversal(projectId, target, { direction: "callers", maxDepth })
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
