import { BrainDatabase } from "../../brain/database"
import { DependencyGraphVisualizer } from "../../ast/dependency-graph-visualizer"
import { renderCodeMapDocument, assertCodeMapParses } from "../../ast/visualization/code-map-renderer"
import { renderClassDocument, assertClassDiagramParses } from "../../ast/visualization/class-diagram-renderer"

export type VisualizationScope = "project" | "file" | "module" | "symbol" | "feature"
export type VisualizationFormat = "text" | "json" | "html"
/** Which picture of the project the answer draws. Independent of `format`, so
 *  every view is available in every delivery form. */
export type VisualizationView = "graph" | "codemap" | "class"

export interface VisualizationRequest {
  scope?: VisualizationScope
  target?: string
  format?: VisualizationFormat
  view?: VisualizationView
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
  view: VisualizationView
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

/**
 * The CODE MAP view.
 *
 * One rectangle per SYMBOL, sized by the lines it spans, nested inside its file and
 * its top-level directory, in a squarified treemap. This is the Sourcegraph
 * Chromium-map shape, and the honest difference is stated in the view itself: the
 * index stores symbols with line spans and kinds, not tokens, so this paints
 * symbols and says so on its own legend. A view that let a reader believe it was
 * token-level would be worse than no view at all.
 */
function renderCodeMap(result: VisualizationResult): string {
  assertCodeMapParses()
  return renderCodeMapDocument({
    // The code map draws SYMBOLS, so it needs the symbol shape rather than the
    // node/link projection the dependency map uses. Nodes already carry everything
    // it needs -- name, kind, language, file, line span, qualified name, gravity,
    // stale -- so nothing is refetched and nothing is invented.
    symbols: result.nodes,
    excluded: result.excluded,
    scope: result.scope,
    target: result.target,
    // What the map does NOT show, declared on its face. A rectangle map makes it
    // especially easy to believe you are seeing the whole project.
    totalNodesAvailable: result.totalNodesAvailable,
    shownNodes: result.nodes.length,
  })
}

/**
 * The UML-style CLASS view.
 *
 * Boxes for the class-like symbols the index actually has -- class, interface,
 * struct, enum -- with inheritance, implementation and containment edges. UML is
 * only as complete as the index that draws it, and this states plainly how much of
 * what it found it could not resolve. Measured on cargo: most `extends` and
 * `implements` relationships point at symbols the project scope did not select, so
 * the diagram says "N relationships left the frame" instead of drawing a partial
 * picture that looks complete.
 */
function renderClassDiagram(result: VisualizationResult): string {
  assertClassDiagramParses()
  const CLASSY = new Set(["class", "struct", "interface", "enum", "trait", "type", "protocol", "object"])
  const EDGEY = new Set(["extends", "implements", "contains", "instantiates", "imports"])
  const classes = result.nodes.filter((n: any) => CLASSY.has(String(n.type)))
  const classIds = new Set(classes.map((n: any) => n.id))
  const edges = result.links.filter(
    (l: any) => EDGEY.has(l.type) && classIds.has(l.source) && classIds.has(l.target),
  )
  // Two DIFFERENT things get left undrawn, and conflating them made the diagram
  // lie about itself.
  //
  // MEASURED on cargo at `scope: module, target: src/compiler`: the warning read
  // "969 inheritance or containment relationship(s) point at types outside this
  // scope and are NOT drawn". The stored breakdown is 2 implements, 834 contains,
  // 134 instantiates. So the claim that 969 *inheritance* relationships left the
  // frame was false -- there were TWO. Nearly all of it was `contains` pointing at
  // properties and methods, which are a class's FIELDS, not types: those are
  // undrawn because this renderer draws relationships between types and nothing else.
  // Reporting them as lost inheritance would make a reader conclude the index had no
  // class hierarchy here, when the truth is the opposite.
  //
  // So the undrawn set is split by WHY, and both halves are declared:
  //   outside -- an endpoint is not in the node set at all, so a type the index holds
  //              was not selected. This is the one that says "widen the scope".
  //   members -- an endpoint IS selected but is a property, method or enum member.
  //              A field, not a missing class.
  const nodeIds = new Set(result.nodes.map((n: any) => n.id))
  const byId = new Map(result.nodes.map((n: any) => [n.id, n]))
  let outside = 0
  let members = 0
  const membersByClass: Record<string, { name: string; type: string; stale?: boolean }[]> = {}
  for (const l of result.links as any[]) {
    if (!EDGEY.has(l.type)) continue
    if (classIds.has(l.source) && classIds.has(l.target)) continue
    const sIn = nodeIds.has(l.source)
    const tIn = nodeIds.has(l.target)
    if (!sIn || !tIn) {
      outside++
      continue
    }
    members++
    // A `contains` link from a type to a non-type IS that type's member. Rather than
    // counting it as undrawn, it goes in the box: the payload already holds it.
    if (l.type === "contains") {
      const host = classIds.has(l.source) ? l.source : l.target
      const child = byId.get(classIds.has(l.source) ? l.target : l.source)
      if (!child) continue
      const list = membersByClass[host] ?? (membersByClass[host] = [])
      if (list.length < 200 && !list.some((m) => m.name === child.name && m.type === child.type)) {
        list.push({ name: String(child.name), type: String(child.type), stale: Boolean(child.stale) })
      }
    }
  }
  // A class diagram shows a HIERARCHY, so it draws the types that are IN one.
  //
  // MEASURED on cargo's src/compiler: of 1,087 type-like symbols, only 217 appear in
  // any type-to-type relationship. 870 are isolated -- 80% of the boxes on screen were
  // connected to nothing, and 176 edges were stretched between the rest, which is six
  // dead boxes per arrow. Drawing every type is how the diagram became a hairball with
  // names in it; capping the boxes did not help either, because the cap kept filling up
  // with orphans (measured: cap 150 keeps 31 edges, cap 1,087 keeps 176 -- the edge
  // count barely moves while the clutter grows sixfold).
  //
  // So the boxes are the CONNECTED types: those the stored relationships actually
  // connect. That is a selection, so it is declared -- `connectedOnly` says how many
  // types in scope were left out for having no relationship at all, and they remain in
  // the JSON answer and the search. A diagram of a hierarchy that has none still draws
  // boxes rather than an empty canvas, so the reader learns the scope matched and the
  // index simply stores no hierarchy here.
  const connectedIds = new Set<string>()
  for (const e of edges as any[]) {
    connectedIds.add(e.source)
    connectedIds.add(e.target)
  }
  const byGravity = (a: any, b: any) => (b.gravity ?? 0) - (a.gravity ?? 0)
  const connected = classes.filter((n: any) => connectedIds.has(n.id)).sort(byGravity)
  const isolated = classes.filter((n: any) => !connectedIds.has(n.id)).sort(byGravity)
  const connectedOnly = isolated.length > 0 && connected.length > 0
  // The ceiling still exists, for a hierarchy large enough to be its own hairball, but
  // it now only ever cuts connected types, so it can never spend the budget on orphans.
  const BOX_CEILING = 400
  const shown = (connectedOnly ? connected : classes.slice().sort(byGravity)).slice(0, BOX_CEILING)
  const shownIds = new Set(shown.map((n: any) => n.id))
  const boxesOmitted = (connectedOnly ? connected : classes).length - shown.length
  const isolatedOmitted = connectedOnly ? isolated.length : 0
  // Re-derive the edges against the boxes actually drawn, so a connector is never
  // drawn to a box that is not on screen.
  const shownEdges = edges.filter((e: any) => shownIds.has(e.source) && shownIds.has(e.target))
  return renderClassDocument({
    classes: shown,
    edges: shownEdges,
    boxesOmitted,
    isolatedOmitted,
    outside,
    members,
    membersByClass,
    totalNodesAvailable: result.totalNodesAvailable,
    excluded: result.excluded,
    scope: result.scope,
    target: result.target,
  })
}

/**
 * The ORDER BY for a scope that ranks by importance.
 *
 * `class` ranks TYPES FIRST. Measured on cargo at `scope: module, target:
 * src/compiler`: with the plain gravity ordering the class view drew 1
 * relationship out of 1,095, because gravity on a real project belongs to the
 * functions that do the work and the classes inheritance connects never reach the
 * node set. The view then correctly declared that 1,094 relationships left the
 * frame -- honest, and useless.
 *
 * A dependency map wants the busiest code. A class diagram wants the TYPES. So the
 * class view orders type-like symbols first, and only then by gravity. It does NOT
 * filter them in: dropping every method would make the diagram a lie about what is
 * in scope, and the tools in this repo do not quietly narrow what they report.
 *
 * The narrower scopes (file, module, symbol) order by source position, which is
 * already the right order for a reader of one file, so they are untouched.
 */
/**
 * The symbol kinds a class box is drawn for.
 *
 * One list, used by BOTH the SQL that orders the class view's selection and the
 * in-memory sort that survives its budget cut. They were separate string literals
 * before, which is exactly the shape of bug where the two drift: MEASURED, the query
 * ordered type-like symbols first and the cut then threw them away, and nothing
 * complained because the query had done its job.
 */
const CLASS_LIKE_TYPES = new Set([
  "class", "struct", "interface", "enum", "trait", "type", "protocol", "object",
])

function importanceOrder(view: VisualizationView | undefined): string {
  if (view === "class") {
    return `CASE WHEN s.symbol_type IN ('class','struct','interface','enum','trait','type','protocol','object') THEN 0 ELSE 1 END, s.gravity_score DESC, s.line_start`
  }
  return "s.gravity_score DESC, s.line_start"
}

/**
 * The ORDER BY for a scope that walks source order.
 *
 * Unchanged for every view except `class`, because source order IS the right order
 * for a reader of one file. MEASURED: it was the wrong order for the class view. The
 * module query is bounded, and the types sat past the bound behind thousands of
 * methods -- so they were cut before the renderer ever saw them, and widening had no
 * budget left to spend. Ordering type-like symbols first puts every type in the frame
 * and leaves room beside them.
 */
function scopedOrder(view: VisualizationView | undefined, base: string): string {
  if (view !== "class") return base
  return `CASE WHEN s.symbol_type IN ('class','struct','interface','enum','trait','type','protocol','object') THEN 0 ELSE 1 END, ${base}`
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
  if (scope === "file") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (f.relative_path=? OR f.path=? OR f.relative_path LIKE ?) ORDER BY ${scopedOrder(request.view, "s.line_start")} LIMIT ?`).all(projectId, ...lang.params, target, target, segmentPrefix(stripped), maxNodes * 2) as any[]
  else if (scope === "module") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (f.relative_path LIKE ? OR f.relative_path LIKE ?) ORDER BY ${scopedOrder(request.view, "f.relative_path,s.line_start")} LIMIT ?`).all(projectId, ...lang.params, segmentPrefix(stripped), segmentPrefix(leaf), maxNodes * 2) as any[]
  else if (scope === "symbol") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (s.name=? OR s.qualified_name=?) ORDER BY ${scopedOrder(request.view, "s.line_start")} LIMIT ?`).all(projectId, ...lang.params, target, target, maxNodes * 2) as any[]
  else if (scope === "feature") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ?) ORDER BY ${importanceOrder(request.view)} LIMIT ?`).all(projectId, ...lang.params, needle, needle, maxNodes * 2) as any[]
  else symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where} ORDER BY ${importanceOrder(request.view)} LIMIT ?`).all(projectId, ...lang.params, maxNodes * 2) as any[]
  // A class diagram whose boxes are the types INSIDE the scope, but whose arrows
  // point at types OUTSIDE it, is the same picture as no diagram at all.
  //
  // MEASURED on cargo at `scope: module, target: src/compiler`: 112 types in scope,
  // 990 inheritance/containment relationships touching them, and exactly ONE
  // drawable arrow, because cargo's compiler types extend and implement types from
  // std and rustc that no module scope will ever contain. The view reported the 989
  // it could not draw, which is honest and useless.
  //
  // So for the class view the node set is widened by the types inheritance actually
  // needs, taken from the project index, up to the same node budget. They are added
  // to the SELECTED set before the edge query, so the arrows resolve. They are not
  // hidden: the count is declared in nodeSelection, and the diagram states how many
  // types came from outside the scope.
  //
  // Widening by NAME would be fabrication, so this does not do that: it selects real,
  // stored, type-like symbols from the index and lets the stored relationships decide
  // which of them connect. A type that still fails to connect simply is not drawn.
  let classWidening = 0
  if (request.view === "class" && scope !== "project" && symbols.length > 0) {
    const already = new Set(symbols.map((symbol) => symbol.id))
    const budget = Math.max(0, maxNodes * 2 - symbols.length)
    if (budget > 0) {
      const extra = raw
        .prepare(
          `SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file
             FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
            WHERE s.project_id=?${lang.where}
              AND s.symbol_type IN ('class','struct','interface','enum','trait','type','protocol','object')
            ORDER BY s.gravity_score DESC,s.line_start LIMIT ?`,
        )
        .all(projectId, ...lang.params, budget + already.size) as any[]
      const chosen: any[] = []
      for (const candidate of extra) {
        if (already.has(candidate.id)) continue
        chosen.push(candidate)
        if (chosen.length >= budget) break
      }
      if (chosen.length > 0) {
        classWidening = chosen.length
        symbols = symbols.concat(chosen)
      }
    }
  }
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
  // The class view must survive its OWN budget cut.
  //
  // MEASURED, and this quietly undid the widening above. `symbols` was widened with
  // 952 type-like symbols from elsewhere in the project so that inheritance pointing
  // out of a module scope could be drawn -- and then `slice(0, maxNodes)` took the
  // first maxNodes of the graph's nodes, which are the SCOPE's symbols in source
  // order, and discarded every widened one. MEASURED: the declared selection said 952
  // extra types had been added, and the returned node set contained 135 types, the
  // same 135 as before the widening existed. A declaration that describes work whose
  // result is then discarded is worse than no declaration.
  //
  // So for the class view the node set is ordered TYPE-LIKE FIRST before the cut. The
  // cut still happens, because the budget is the budget, but it now cuts members
  // rather than types -- and a type's members are re-derivable from the containment
  // links, while a type that is cut is simply gone.
  let ordered = graph.nodes
  if (request.view === "class") {
    ordered = graph.nodes.slice().sort((a: any, b: any) => {
      const at = CLASS_LIKE_TYPES.has(String(a.type)) ? 0 : 1
      const bt = CLASS_LIKE_TYPES.has(String(b.type)) ? 0 : 1
      if (at !== bt) return at - bt
      return (b.gravity ?? 0) - (a.gravity ?? 0)
    })
  }
  const nodes = ordered.slice(0, maxNodes)
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
    nodeSelectionNote = request.view === "class"
      ? "type-like symbols first (class, struct, interface, enum, trait, type, protocol, object), then the highest-gravity symbols \u2014 a class diagram needs the TYPES, and gravity on a real project belongs to the functions that do the work"
      : "the highest-gravity symbols first, so the graph is the project's busiest core rather than a sample"
  } else if (scope === "file") {
    nodeSelectionNote = "every symbol in the file, in source order"
  } else if (scope === "module") {
    nodeSelectionNote = "every symbol under the module directory, in source order"
  } else {
    nodeSelectionNote = `every symbol named ${target}, in source order`
  }
  // The class view's widening is a change to the SELECTION, so it is named in the
  // selection rather than left for the reader to infer from a count.
  if (classWidening > 0) {
    nodeSelectionNote += `, plus the ${classWidening} highest-gravity type-like symbol(s) from elsewhere in the project, added so that inheritance pointing out of this scope can be drawn rather than merely counted`
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
  return { scope, target: target || null, format: request.format ?? "text", view: request.view ?? "graph", nodes, links, excluded: graph.excluded, declaredAbsent, absenceNote, totalNodesAvailable, provenance: { source: "canonical-graph-engine", indexedProject: projectId, omittedDanglingLinks }, considered: { relationshipsBetweenSelectedNodes, relationshipSelection: `every relationship connecting two of the ${nodeIds.size} returned nodes — complete for this node set, not a slice of the relationship table`, relationshipSetTruncated: originalLinks > links.length, nodeSelection: nodeSelectionNote, languagesConsidered: request.languages?.length ? request.languages : null }, truncation: { truncated, originalNodes, originalLinks, maxNodes, maxLinks, reason: truncated ? "output limits" : null, totalNodesAvailable } }
}

export function formatVisualization(result: VisualizationResult): string {
  if (result.format === "json") return JSON.stringify(result, null, 2)
  if (result.format === "html") {
    // The view chooses the picture; the format chooses the delivery. A new view is
    // therefore one entry here rather than three new format values.
    if (result.view === "codemap") return renderCodeMap(result)
    if (result.view === "class") return renderClassDiagram(result)
    return DependencyGraphVisualizer.generateHTML({ nodes: result.nodes, links: result.links, excluded: result.excluded })
  }
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
