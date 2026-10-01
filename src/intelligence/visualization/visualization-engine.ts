import { BrainDatabase } from "../../brain/database"
import { DependencyGraphVisualizer } from "../../ast/dependency-graph-visualizer"

export type VisualizationScope = "project" | "file" | "module" | "symbol" | "feature"
export type VisualizationFormat = "text" | "json" | "html"

export interface VisualizationRequest {
  scope?: VisualizationScope
  target?: string
  format?: VisualizationFormat
  maxNodes?: number
  maxLinks?: number
  relationshipTypes?: string[]
  languages?: string[]
  /** Path SEGMENTS the projection should treat as noise. Matched on whole
   *  segments, never as substrings — the previous hardcoded filter removed
   *  `src/util/edit_distance.rs` because "dist" is inside "edit_distance". */
  excludePatterns?: string[]
  /** Include test/spec sources. Default true: they are ordinary source. */
  includeTests?: boolean
}

export interface VisualizationResult {
  scope: VisualizationScope
  target: string | null
  format: VisualizationFormat
  nodes: any[]
  links: any[]
  /** What the noise filter removed, and on whose authority. A partial graph
   *  must never look like a whole one. */
  excluded?: { symbols: number; byPattern: Record<string, number>; patterns: string[]; includesTestFiles: boolean }
  provenance: { source: "canonical-graph-engine"; indexedProject: string; omittedDanglingLinks: number }
  truncation: { truncated: boolean; originalNodes: number; originalLinks: number; maxNodes: number; maxLinks: number; reason: string | null }
}

function bounded(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback
}

export async function visualizeProject(projectId: string, request: VisualizationRequest = {}): Promise<VisualizationResult> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const scope = request.scope ?? "project"
  const target = String(request.target ?? "")
  const maxNodes = bounded(request.maxNodes, 200, 2000)
  const maxLinks = bounded(request.maxLinks, 5000, 20000)
  let symbols: any[]
  if (scope === "file") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (f.relative_path=? OR f.path=? OR f.relative_path LIKE ?) ORDER BY s.line_start LIMIT ?").all(projectId, target, target, `%${target}`, maxNodes * 2) as any[]
  else if (scope === "module") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (f.relative_path LIKE ? OR f.relative_path LIKE ?) ORDER BY f.relative_path,s.line_start LIMIT ?").all(projectId, `${target}/%`, `${target}%`, maxNodes * 2) as any[]
  else if (scope === "symbol") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT ?").all(projectId, target, target, maxNodes * 2) as any[]
  else if (scope === "feature") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?) ORDER BY s.gravity_score DESC,s.line_start LIMIT ?").all(projectId, `%${target.toLowerCase()}%`, `%${target.toLowerCase()}%`, maxNodes * 2) as any[]
  else symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY s.gravity_score DESC,s.line_start LIMIT ?").all(projectId, maxNodes * 2) as any[]
  if (request.languages?.length) symbols = symbols.filter((symbol) => request.languages?.includes(symbol.language))
  const ids = new Set(symbols.map((symbol) => symbol.id))
  // `id` and `evidence_tier` are selected because the projection carries them: an
  // edge with no row id cannot be traced to the stored row that justifies it, and
  // a graph that cannot distinguish a proven edge from an inferred one is a
  // picture, not evidence.
  const relationships = raw.prepare("SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,evidence_tier,line_number FROM brain_relationship WHERE project_id=? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL ORDER BY id LIMIT ?").all(projectId, maxLinks * 3) as any[]
  const filteredRelationships = relationships.filter((relationship) => (!request.relationshipTypes?.length || request.relationshipTypes.includes(relationship.relationship_type)) && ids.has(relationship.source_id) && ids.has(relationship.target_id))
  const graph = DependencyGraphVisualizer.generateGraphData(symbols, filteredRelationships, { excludePatterns: request.excludePatterns, includeTests: request.includeTests })
  const originalNodes = graph.nodes.length
  const originalLinks = graph.links.length
  const nodes = graph.nodes.slice(0, maxNodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const links = graph.links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)).slice(0, maxLinks)
  const omittedDanglingLinks = graph.links.filter((link) => !nodeIds.has(link.source) || !nodeIds.has(link.target)).length
  const truncated = originalNodes > nodes.length || originalLinks > links.length
  return { scope, target: target || null, format: request.format ?? "text", nodes, links, excluded: graph.excluded, provenance: { source: "canonical-graph-engine", indexedProject: projectId, omittedDanglingLinks }, truncation: { truncated, originalNodes, originalLinks, maxNodes, maxLinks, reason: truncated ? "output limits" : null } }
}

export function formatVisualization(result: VisualizationResult): string {
  if (result.format === "json") return JSON.stringify(result, null, 2)
  if (result.format === "html") return DependencyGraphVisualizer.generateHTML({ nodes: result.nodes, links: result.links })
  return `graph: ${result.nodes.length} nodes, ${result.links.length} links\nscope: ${result.scope}${result.target ? ` (${result.target})` : ""}\ntruncated: ${result.truncation.truncated} original=${result.truncation.originalNodes}/${result.truncation.originalLinks} limits=${result.truncation.maxNodes}/${result.truncation.maxLinks}\nprovenance: ${result.provenance.source} dangling-links-omitted=${result.provenance.omittedDanglingLinks}`
}
