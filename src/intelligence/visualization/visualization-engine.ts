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
  /** Path SEGMENTS to treat as noise. Matched on whole segments, never as
   *  substrings " the previous hardcoded filter removed `src/util/edit_distance.rs`
   *  because "dist" is inside "edit_distance", and `src/compiler/layout.rs`
   *  because "out" is inside "layout". */
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
  /** What the noise filter removed, and on whose authority. A partial graph must
   *  never be allowed to look like a whole one. */
  excluded?: { symbols: number; byPattern: Record<string, number>; patterns: string[]; includesTestFiles: boolean }
  /** How many symbols this scope and filter set actually match, ignoring every
   *  output bound. Kept distinct from `truncation.originalNodes` (how many
   *  reached the projection) and from `nodes` (how many were returned), so a
   *  short page can never be mistaken for the whole set. */
  totalNodesAvailable: number
  /** True when the answer is empty, with the reason. Absence is declared, —
   *  never an empty result that looks like a real project. */
  declaredAbsent?: boolean
  absenceNote?: string | null
  provenance: { source: "canonical-graph-engine"; indexedProject: string; omittedDanglingLinks: number }
  truncation: { truncated: boolean; originalNodes: number; originalLinks: number; maxNodes: number; maxLinks: number; reason: string | null; totalNodesAvailable: number }
}

/** Escape the LIKE metacharacters so a target is matched as a VALUE.
 *  Measured: `scope: "file", target: "%"` previously selected every file in the
 *  corpus, because the target was interpolated into a LIKE pattern raw. The
 *  sibling tool states the same rule for itself — "a target is a VALUE, never a
 *  pattern: %, _ and \ are escaped and match themselves" — so the two now agree. */
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (c) => `\\${c}`)
}

/** A directory prefix matched on a whole SEGMENT boundary: `src/util` matches
 *  `src/util/x.ts` and never `src/utilities/x.ts`. */
function segmentPrefix(value: string): string {
  return `${escapeLike(value)}/%`
}

function bounded(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback
}

/** How many symbols the scope and filters match, ignoring every output bound.
 *  Counted with the SAME predicate as the symbol query so the two cannot drift. */
function countAvailableSymbols(raw: any, projectId: string, scope: VisualizationScope, target: string, request: VisualizationRequest): number {
  const langClause = request.languages?.length
    ? ` AND f.language IN (${request.languages.map(() => "?").join(",")})`
    : ""
  const langParams: unknown[] = request.languages ?? []
  let where = "1=1"
  const params: unknown[] = [projectId, ...langParams]
  if (scope === "file") {
    where = "(f.relative_path=? OR f.path=? OR f.relative_path LIKE ?)"
    params.push(target, target, segmentPrefix(target.replace(/\/$/, "")))
  } else if (scope === "module") {
    where = "(f.relative_path LIKE ? OR f.relative_path LIKE ?)"
    params.push(segmentPrefix(target.replace(/\/$/, "")), segmentPrefix((target.replace(/\/$/, "").split("/").pop() ?? target)))
  } else if (scope === "symbol") {
    where = "(s.name=? OR s.qualified_name=?)"
    params.push(target, target)
  } else if (scope === "feature") {
    where = "(lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?)"
    params.push(`%${escapeLike(target.toLowerCase())}%`, `%${escapeLike(target.toLowerCase())}%`)
  }
  const row = raw
    .prepare(`SELECT COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND ${where}${langClause}`)
    .get(...params) as { c: number }
  return Number(row?.c ?? 0)
}

export async function visualizeProject(projectId: string, request: VisualizationRequest = {}): Promise<VisualizationResult> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const scope = request.scope ?? "project"
  const target = String(request.target ?? "")
  const maxNodes = bounded(request.maxNodes, 200, 2000)
  const maxLinks = bounded(request.maxLinks, 5000, 20000)
  let symbols: any[]
  if (scope === "file") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (f.relative_path=? OR f.path=? OR f.relative_path LIKE ?) ORDER BY s.line_start LIMIT ?").all(projectId, target, target, segmentPrefix(target.replace(/\/$/, "")), maxNodes * 2) as any[]
  else if (scope === "module") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (f.relative_path LIKE ? OR f.relative_path LIKE ?) ORDER BY f.relative_path,s.line_start LIMIT ?").all(projectId, segmentPrefix(target.replace(/\/$/, "")), segmentPrefix((target.replace(/\/$/, "").split("/").pop() ?? target)), maxNodes * 2) as any[]
  else if (scope === "symbol") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT ?").all(projectId, target, target, maxNodes * 2) as any[]
  else if (scope === "feature") symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?) ORDER BY s.gravity_score DESC,s.line_start LIMIT ?").all(projectId, `%${escapeLike(target.toLowerCase())}%`, `%${escapeLike(target.toLowerCase())}%`, maxNodes * 2) as any[]
  else symbols = raw.prepare("SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY s.gravity_score DESC,s.line_start LIMIT ?").all(projectId, maxNodes * 2) as any[]
  if (request.languages?.length) symbols = symbols.filter((symbol) => request.languages?.includes(symbol.language))
  const ids = new Set(symbols.map((symbol) => symbol.id))
  // `id` and the stored classification are selected because the projection carries
  // them: an edge with no row id cannot be traced to the stored row that justifies it,
  // and a graph that cannot tell a confident edge from a weak one is a picture, not
  // evidence. Evidence TIERS are absent by design — they are not a stored column
  // (verified with PRAGMA table_info) and bb_graph derives them; deriving them here too
  // would create a second, divergent source of truth.
  const relationships = raw.prepare("SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number FROM brain_relationship WHERE project_id=? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL ORDER BY id LIMIT ?").all(projectId, maxLinks * 3) as any[]
  const filteredRelationships = relationships.filter((relationship) => (!request.relationshipTypes?.length || request.relationshipTypes.includes(relationship.relationship_type)) && ids.has(relationship.source_id) && ids.has(relationship.target_id))
  const graph = DependencyGraphVisualizer.generateGraphData(symbols, filteredRelationships, { excludePatterns: request.excludePatterns, includeTests: request.includeTests })
  const originalNodes = graph.nodes.length
  const originalLinks = graph.links.length
  const nodes = graph.nodes.slice(0, maxNodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const links = graph.links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)).slice(0, maxLinks)
  // How many symbols this scope and these filters ACTUALLY match, independent of
  // the pre-selection LIMIT. Without this the declared "original" was the size of
  // a slice: measured on cargo it reported 3,463 against an index of 40,595, so a
  // reader would conclude the project holds 3.5k symbols. `bb_search` states the
  // rule for itself — "a short page is never mistaken for a complete one" — and the
  // three quantities are now always distinguishable.
  const totalNodesAvailable = countAvailableSymbols(raw, projectId, scope, target, request)
  const omittedDanglingLinks = graph.links.filter((link) => !nodeIds.has(link.source) || !nodeIds.has(link.target)).length
  const truncated = originalNodes > nodes.length || originalLinks > links.length
  // A filter or scope that matches nothing is DECLARED, never returned as a
  // plausible empty project. Measured: relationshipTypes:["not_a_real_type"]
  // produced {nodes:[],links:[]} indistinguishable from an empty repository.
  const declaredAbsent = nodes.length === 0
  const absenceNote = declaredAbsent
    ? (totalNodesAvailable === 0
      ? `no indexed symbol matches scope=${scope}${target ? ` target="${target}"` : ""}${request.languages?.length ? ` languages=[${request.languages.join(",")}]` : ""}${request.relationshipTypes?.length ? ` relationshipTypes=[${request.relationshipTypes.join(",")}]` : ""} — absence declared, never guessed`
      : `${totalNodesAvailable} symbol(s) match this query but none survived the projection — absence declared, never guessed`)
    : null
  return { scope, target: target || null, format: request.format ?? "text", nodes, links, excluded: graph.excluded, declaredAbsent, absenceNote, totalNodesAvailable, provenance: { source: "canonical-graph-engine", indexedProject: projectId, omittedDanglingLinks }, truncation: { truncated, originalNodes, originalLinks, maxNodes, maxLinks, reason: truncated ? "output limits" : null, totalNodesAvailable } }
}

export function formatVisualization(result: VisualizationResult): string {
  if (result.format === "json") return JSON.stringify(result, null, 2)
  if (result.format === "html") return DependencyGraphVisualizer.generateHTML({ nodes: result.nodes, links: result.links })
  return `graph: ${result.nodes.length} nodes, ${result.links.length} links\nscope: ${result.scope}${result.target ? ` (${result.target})` : ""}\ntruncated: ${result.truncation.truncated} original=${result.truncation.originalNodes}/${result.truncation.originalLinks} limits=${result.truncation.maxNodes}/${result.truncation.maxLinks}\nprovenance: ${result.provenance.source} dangling-links-omitted=${result.provenance.omittedDanglingLinks}`
}
