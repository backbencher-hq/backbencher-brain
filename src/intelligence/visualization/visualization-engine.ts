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
  /** What the answer actually READ, as opposed to what it returned.
   *
   *  The edge set is COMPLETE for the selected nodes rather than a slice of the
   *  relationship table, so there is nothing to confess there. MEASURED: the old
   *  query read `LIMIT maxLinks*3` rows in PRIMARY KEY order and found 0 of the
   *  1,142 relationships that actually connected 400 selected symbols — the slice
   *  was uncorrelated with the node set, so the answer was both slow and wrong.
   *  The NODE set is still a selection, and that is what this block declares. */
  considered?: {
    /** Stored relationship rows connecting two of the RETURNED nodes, counted for
     *  the node set the reader can actually see rather than the larger set the
     *  fetch was built from. MEASURED: counting the fetch set declared 1,142 edges
     *  for a graph of 200 nodes whose true figure is 394. */
    relationshipsBetweenSelectedNodes: number
    /** Why the edge set is complete, stated so a reader need not infer it. */
    relationshipSelection: string
    /** True when `maxLinks` cut the complete edge set after all. */
    relationshipSetTruncated: boolean
    /** Which symbols got a chance to be in the graph, and in what order. */
    nodeSelection: string
    /** The language filter, which is applied BEFORE the limit. */
    languagesConsidered: string[] | null
  }
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

/** The SQL clause and parameters for the language filter.
 *
 *  MEASURED on cargo: `bb_visualize({languages: ["javascript"]})` returned 0
 *  nodes and declared the project had none, while the index held 56 javascript
 *  symbols in real files. The engine selected `LIMIT maxNodes*2` symbols ordered
 *  by gravity and then filtered them in memory, so any language whose symbols were
 *  not already in that slice was cut before the filter ran. The tool even
 *  contradicted itself: the declared total counted the language in SQL while the
 *  returned nodes came from the empty in-memory result.
 *
 *  Built in one place and used by BOTH the symbol query and the count query, so
 *  the two can never disagree about what was asked for — which is how the
 *  contradiction above arose in the first place. */
function languageClause(request: VisualizationRequest): { where: string; params: unknown[] } {
  const wanted = request.languages?.filter((l) => typeof l === "string" && l.length > 0) ?? []
  if (wanted.length === 0) return { where: "", params: [] }
  return {
    where: ` AND f.language IN (${wanted.map(() => "?").join(",")})`,
    params: wanted,
  }
}


function countAvailableSymbols(
  raw: any,
  projectId: string,
  scope: VisualizationScope,
  target: string,
  request: VisualizationRequest,
): number {
  // The SAME predicate the symbol query uses, so the declared true size and the
  // returned answer can never describe different sets. This is not a nicety:
  // when the two drifted, one reply declared 56 javascript symbols available and
  // returned none of them.
  const stripped = target.replace(/\/$/, "")
  let where = "1=1"
  const params: unknown[] = []
  if (scope === "file") {
    where = "(f.relative_path=? OR f.path=? OR f.relative_path LIKE ?)"
    params.push(target, target, segmentPrefix(stripped))
  } else if (scope === "module") {
    where = "(f.relative_path LIKE ? OR f.relative_path LIKE ?)"
    params.push(segmentPrefix(stripped), segmentPrefix(stripped.split("/").pop() ?? stripped))
  } else if (scope === "symbol") {
    where = "(s.name=? OR s.qualified_name=?)"
    params.push(target, target)
  } else if (scope === "feature") {
    const needle = `%${escapeLike(target.toLowerCase())}%`
    where = "(lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?)"
    params.push(needle, needle)
  }
  const lang = languageClause(request)
  // The join to brain_file is only there because the PREDICATE sometimes reads
  // f.language or f.relative_path. When neither does — the whole-project count
  // with no language filter — the join is pure waste, and SQLite then has to walk
  // the file table to satisfy it. MEASURED on cargo, project scope, no filter:
  // 406.1 ms with the join against 3.0 ms without it, on the same 40,595 symbols.
  // So the join is applied only when a predicate actually needs it.
  const needsFile = where !== "1=1" || lang.params.length > 0
  const row = needsFile
    ? raw
        .prepare(
          `SELECT COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
            WHERE s.project_id = ? AND ${where}${lang.where}`,
        )
        .get(projectId, ...lang.params, ...params)
    : raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId)
  return Number((row as { c: number })?.c ?? 0)
}

export async function visualizeProject(projectId: string, request: VisualizationRequest = {}): Promise<VisualizationResult> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const scope = request.scope ?? "project"
  const target = String(request.target ?? "")
  const maxNodes = bounded(request.maxNodes, 200, 2000)
  const maxLinks = bounded(request.maxLinks, 5000, 20000)
  // The language filter is applied in SQL, BEFORE the LIMIT — see languageClause above for
  // what that costs when it is applied afterwards instead.
  const lang = languageClause(request)
  let symbols: any[]
  const stripped = target.replace(/\/$/, "")
  const leaf = stripped.split("/").pop() ?? stripped
  const needle = `%${escapeLike(target.toLowerCase())}%`
  if (scope === "file") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (f.relative_path=? OR f.path=? OR f.relative_path LIKE ?) ORDER BY s.line_start LIMIT ?`).all(projectId, ...lang.params, target, target, segmentPrefix(stripped), maxNodes * 2) as any[]
  else if (scope === "module") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (f.relative_path LIKE ? OR f.relative_path LIKE ?) ORDER BY f.relative_path,s.line_start LIMIT ?`).all(projectId, ...lang.params, segmentPrefix(stripped), segmentPrefix(leaf), maxNodes * 2) as any[]
  else if (scope === "symbol") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT ?`).all(projectId, ...lang.params, target, target, maxNodes * 2) as any[]
  else if (scope === "feature") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?) ORDER BY s.gravity_score DESC,s.line_start LIMIT ?`).all(projectId, ...lang.params, needle, needle, maxNodes * 2) as any[]
  else symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} ORDER BY s.gravity_score DESC,s.line_start LIMIT ?`).all(projectId, ...lang.params, maxNodes * 2) as any[]
  const ids = new Set(symbols.map((symbol) => symbol.id))
  // The edge set is fetched BY JOINING the selected nodes, not by reading a slice
  // of the relationship table and discarding most of it.
  //
  // MEASURED on cargo (400 selected symbols): the old query read
  // `LIMIT maxLinks*3` = 15,000 rows in PRIMARY KEY order and found **zero** of the
  // 1,142 relationships that actually connect those nodes — the slice is essentially
  // uncorrelated with the node set, so it was slow AND wrong. Joining on both
  // endpoints returns the same answer from 1,142 rows in 43.4 ms, using the
  // existing brain_rel_proj_source_idx, with no new index.
  //
  // The consequence is an honesty IMPROVEMENT, not just a speedup. There is no
  // longer an arbitrary slice to disclose: the edge set is every relationship
  // between the selected nodes, which is a complete fact. So the full-table COUNT
  // that existed only to say "we read M of N" is not merely slow (453 ms for a
  // SCAN of 164,767 rows) — it is unnecessary, and deleting it removes the known
  // primary-key weakness the docs had to confess.
  //
  // `id` and the stored classification are selected because the projection carries
  // them: an edge with no row id cannot be traced to the stored row that justifies
  // it, and a graph that cannot tell a confident edge from a weak one is a picture,
  // not evidence. Evidence TIERS are absent by design — they are not a stored column
  // (verified with PRAGMA table_info) and bb_graph derives them; deriving them here
  // too would create a second, divergent source of truth.
  let relationships: any[]
  if (ids.size === 0) {
    relationships = []
  } else {
    const idList = [...ids]
    const placeholders = idList.map(() => "?").join(",")
    relationships = raw
      .prepare(
        `SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number
           FROM brain_relationship
          WHERE project_id = ?
            AND source_symbol_id IN (${placeholders})
            AND target_symbol_id IN (${placeholders})`,
      )
      .all(projectId, ...idList, ...idList) as any[]
  }
  const filteredRelationships = relationships.filter((relationship) => !request.relationshipTypes?.length || request.relationshipTypes.includes(relationship.relationship_type))
  const graph = DependencyGraphVisualizer.generateGraphData(symbols, filteredRelationships, { excludePatterns: request.excludePatterns, includeTests: request.includeTests })
  const originalNodes = graph.nodes.length
  const originalLinks = graph.links.length
  const nodes = graph.nodes.slice(0, maxNodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const links = graph.links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)).slice(0, maxLinks)
  // The edge count is stated for the node set the reader actually SEES, not the
  // larger one the fetch was built from. MEASURED: the fetch is bounded by
  // `maxNodes * 2` symbols while `maxNodes` are returned, so counting against the
  // fetch set declared 1,142 edges for a graph showing 200 nodes, when the true
  // figure between those 200 nodes is 394. A completeness claim is only worth
  // making about the thing it is claiming completeness FOR.
  const relationshipsBetweenSelectedNodes = filteredRelationships.filter(
    (relationship) => nodeIds.has(relationship.source_id) && nodeIds.has(relationship.target_id),
  ).length
  // How many symbols this scope and these filters ACTUALLY match, independent of
  // the pre-selection LIMIT. Without this the declared "original" was the size of
  // a slice: measured on cargo it reported 3,463 against an index of 40,595, so a
  // reader would conclude the project holds 3.5k symbols. `bb_search` states the
  // rule for itself — "a short page is never mistaken for a complete one" — and the
  // three quantities are now always distinguishable.
  const totalNodesAvailable = countAvailableSymbols(raw, projectId, scope, target, request)
  // Which symbols got a chance to be in the graph, and in what order. The project
  // and feature scopes take the index's own gravity, so the graph is the busiest
  // core rather than a sample; the narrower scopes take source order, because that
  // is the only order a reader of one file would want. Either way it is a
  // SELECTION, and until now nothing in the answer named it.
  let nodeSelectionNote = "every symbol matching the scope, in source order"
  if (scope === "project" || scope === "feature") {
    nodeSelectionNote = "the highest-gravity symbols first, so the graph is the project's busiest core rather than a sample"
  } else if (scope === "file") {
    nodeSelectionNote = "every symbol in the file, in source order"
  } else if (scope === "module") {
    nodeSelectionNote = "every symbol under the module directory, in source order"
  } else {
    nodeSelectionNote = `every symbol named ${target}, in source order`
  }
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
  return { scope, target: target || null, format: request.format ?? "text", nodes, links, excluded: graph.excluded, declaredAbsent, absenceNote, totalNodesAvailable, provenance: { source: "canonical-graph-engine", indexedProject: projectId, omittedDanglingLinks }, considered: { relationshipsBetweenSelectedNodes, relationshipSelection: `every relationship connecting two of the ${nodeIds.size} returned nodes — complete for this node set, not a slice of the relationship table`, relationshipSetTruncated: originalLinks > links.length, nodeSelection: nodeSelectionNote, languagesConsidered: request.languages?.length ? request.languages : null }, truncation: { truncated, originalNodes, originalLinks, maxNodes, maxLinks, reason: truncated ? "output limits" : null, totalNodesAvailable } }
}

export function formatVisualization(result: VisualizationResult): string {
  if (result.format === "json") return JSON.stringify(result, null, 2)
  if (result.format === "html") return DependencyGraphVisualizer.generateHTML({ nodes: result.nodes, links: result.links, excluded: result.excluded })
  // The DEFAULT format is what every caller gets unless they think to ask for JSON,
  // so it must carry the same facts the JSON does. It used to be four lines and 153
  // characters that never mentioned the true symbol total, the declared relationship
  // slice, the node ordering, or the noise exclusion — so the one reply that could
  // not be audited was the default one. Brevity was never the defect; silence was.
  const lines: string[] = []
  lines.push(`graph: ${result.nodes.length} nodes, ${result.links.length} links`)
  lines.push(`scope: ${result.scope}${result.target ? ` (${result.target})` : ""}`)
  if (result.declaredAbsent) {
    lines.push(`absent: ${result.absenceNote ?? "this query matches nothing"}`)
  } else {
    lines.push(
      `available: ${result.totalNodesAvailable} symbol(s) match, ${result.truncation.originalNodes} reached the projection, ${result.nodes.length} returned — limits ${result.truncation.maxNodes} nodes / ${result.truncation.maxLinks} links`,
    )
  }
  if (result.considered) {
    lines.push(
      `edges: ${result.considered.relationshipsBetweenSelectedNodes} relationship(s) connect the selected symbols — complete for this node set${result.considered.relationshipSetTruncated ? ", then cut by maxLinks" : ""}`,
    )
    lines.push(`node selection: ${result.considered.nodeSelection}`)
    if (result.considered.languagesConsidered?.length) {
      lines.push(`language filter: ${result.considered.languagesConsidered.join(", ")} (applied before the limit)`)
    }
  }
  // The exclusion is ALWAYS stated, including when it is empty. "Nothing was
  // excluded" is information a reader needs in order to trust that the graph is
  // the whole project, and a line that appears only when there is something to
  // report makes silence and zero indistinguishable — which is the same class of
  // defect as the slice being called "the original".
  if (result.excluded) {
    const byPattern = Object.entries(result.excluded.byPattern).map(([pattern, n]) => `${pattern} (${n})`).join(", ")
    lines.push(
      result.excluded.symbols > 0
        ? `excluded: ${result.excluded.symbols} symbol(s) as noise by ${byPattern}${result.excluded.includesTestFiles ? "" : " (test sources excluded)"} — this graph is not the whole project`
        : "excluded: nothing — this graph is the whole project (build output and VCS metadata are filtered on whole path segments; test sources are included)",
    )
  }
  if (result.truncation.truncated) {
    lines.push(
      `truncated: yes — ${result.truncation.originalNodes} nodes and ${result.truncation.originalLinks} links reached the projection, the limits kept fewer`,
    )
  }
  lines.push(`provenance: ${result.provenance.source} dangling-links-omitted=${result.provenance.omittedDanglingLinks}`)
  return lines.join("\n")
}
