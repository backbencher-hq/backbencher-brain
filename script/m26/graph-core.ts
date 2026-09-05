// script/m26/graph-core.ts — M26.W1: the ONE graph renderer (issue #509).
//
// One HTML/JS renderer reused across all IDEs; per-IDE forks are banned
// (decision record). The core is import-pure: zero node/platform imports,
// zero editor imports — all DOM access goes through the injected `GraphDom`
// port, so the same file runs in a webview and in the headless harness
// (M26.V1) without any adapter inside the core.
//
// Declared decisions (gated by script/m26/verify-webview-core.ts):
//   budget:      500 nodes / 2000 edges pinned fixture budget; render budget
//                300 ms warm / 1000 ms cold is measured by the CALLER
//                (contract §3) — this core is deterministic and does no
//                I/O, so its cost is the render.
//   layout:      deterministic — root centered, callers left column and
//                callees right column, rows ordered by (depth, edge index).
//                No Math.random, no Date.now inside render.
//   tiers:       every edge renders with exactly one tier class
//                (structural / import_based / usage_contextual /
//                reference_qualified / inferred) from
//                metadata.evidenceClass when present, else the declared
//                derivation rule below. The five classes are visually
//                distinct by construction (distinct class + data-tier).
//   truncation:  budget-exhausted graphs render a first-class marker
//                (`bb-truncation-marker`) with declared shown/total counts.
//                Silent truncation is a defect, not a strategy.
//   model:       consumes GraphTraversalResult (src/intelligence/contracts.ts)
//                shaped data only; edges may carry `rowId` (brain_relationship
//                id, W2) — the renderer renders it as a data attribute and
//                never invents one.
//
// W6 contract (issue #547): every repo-controlled string is HTML-escaped by
// the adapter before insertion; this core therefore only ever assigns
// textContent / data attributes and never builds HTML strings — structural
// escaping, enforced structurally by the DOM port shape.

export const RENDER_BUDGET = {
  maxNodes: 500,
  maxEdges: 2000,
  warmMs: 300,
  coldMs: 1000,
} as const

export const EDGE_TIERS = ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"] as const
export type EdgeTier = (typeof EDGE_TIERS)[number]

export interface GraphNodeLike {
  id: string
  name: string
  symbolType: string
  file: string
  line: number
  lineEnd: number
  language: string
  isExternal: boolean
}

export interface GraphEdgeLike {
  from: string
  to: string
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  bridgeMechanism?: string
  callSite: { file: string; line: number }
  depth: number
  rowId?: string
  /** Stored metadata: the analyzer's evidenceClass PLUS (M42.H3) the
   *  enrichment pass's fields. Structural so the import-pure core can read
   *  them without importing the server's Enrichment type. */
  metadata?: {
    evidenceClass?: string
    enrichment?: {
      inferredAt?: number
      role?: string
      pattern?: string
      layerFlow?: string
      criticality?: string
      frequency?: string
    }
  }
}

export interface GraphResultLike {
  root: GraphNodeLike
  callers: GraphEdgeLike[]
  callees: GraphEdgeLike[]
  nodes: Record<string, GraphNodeLike>
  summary: {
    totalCallers: number
    totalCallees: number
    truncated: boolean
    truncationReason?: string
    crossLanguageEdges: number
  }
  /** M28.A2 (D-6): the root symbol's agent/human annotations, author-labeled.
   *  Optional for backward compatibility; when present and non-empty, the
   *  renderer attaches the annotation badge to the root node element. */
  annotations?: Array<{ author_class: string; tool_identity: string; body: string; time_updated: number }>
}

/** The DOM port: the minimal surface the renderer needs. The webview adapts
 *  the real DOM/SVG; the harness adapts an inspectable stub. Escaping is
 *  structural: the port has no innerHTML member at all. */
export interface GraphDomElement {
  tagName: string
  className: string
  children: GraphDomElement[]
  textContent: string
  attrs: Record<string, string>
  style: Record<string, string>
  setAttribute(name: string, value: string): void
  appendChild(child: GraphDomElement): GraphDomElement
  addClass(name: string): void
}

export interface GraphDom {
  create(tagName: string): GraphDomElement
  root(): GraphDomElement
}

export interface RenderStats {
  nodesRendered: number
  nodesTotal: number
  edgesRendered: number
  edgesTotal: number
  nodesTruncated: boolean
  edgesTruncated: boolean
}

const STRUCTURAL_TYPES = new Set(["calls", "inherits", "implements", "overrides"])
const IMPORT_TYPES = new Set(["imports", "import"])

/** Tier meanings in UI terms — the legend vocabulary. Documented decision:
 *  the 0.7 confidence floor mirrors patterns.ts inheritance — at or above it
 *  a structural claim is stored/derived; below it the edge is a guess and
 *  MUST render as inferred. Kept in sync with the hover gloss
 *  (src/lsp/cross_language_hover.ts) — the W4 verifier drift-gates the two. */
export const TIER_MEANINGS: Record<EdgeTier, string> = {
  structural: "stored or derived structure (calls/extends/implements/overrides at confidence >= 0.7) — safe to trust for navigation",
  import_based: "derived from import statements — the module relationship is real, the use may be indirect",
  usage_contextual: "usage-site evidence — the name appears in context, not guaranteed to be a call",
  reference_qualified: "reference with qualifier evidence — stronger than usage_contextual, weaker than structure",
  inferred: "a guess (heuristic or confidence < 0.7) — treat as a hint, never as fact",
}

/** Tier for an edge: stored evidenceClass wins; else the declared derivation.
 *  The 0.7 confidence floor mirrors the inheritance threshold decision in
 *  patterns.ts — below it, an edge is a guess and must render as inferred. */
export function tierForEdge(edge: GraphEdgeLike): EdgeTier {
  const stored = edge.metadata?.evidenceClass
  if (stored && (EDGE_TIERS as readonly string[]).includes(stored)) return stored as EdgeTier
  const t = edge.relationshipType
  if (STRUCTURAL_TYPES.has(t)) return edge.confidence >= 0.7 ? "structural" : "inferred"
  if (IMPORT_TYPES.has(t)) return "import_based"
  if (t === "references") return "usage_contextual"
  if (t === "references_qualified") return "reference_qualified"
  return "inferred"
}

function nodeElement(node: GraphNodeLike, dom: GraphDom, role: string): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-node")
  el.addClass(`bb-node-${role}`)
  el.setAttribute("data-id", node.id)
  el.setAttribute("data-kind", node.symbolType)
  el.setAttribute("data-lang", node.language)
  if (node.isExternal) el.addClass("bb-node-external")
  const label = dom.create("span")
  label.addClass("bb-node-name")
  label.textContent = node.name
  const meta = dom.create("span")
  meta.addClass("bb-node-meta")
  meta.textContent = node.file ? `${node.file}:${node.line}` : "external"
  el.appendChild(label)
  el.appendChild(meta)
  return el
}

function edgeElement(edge: GraphEdgeLike, index: number, dom: GraphDom): GraphDomElement {
  const el = dom.create("div")
  const tier = tierForEdge(edge)
  el.addClass("bb-edge")
  el.addClass(`bb-edge-${tier}`)
  el.setAttribute("data-edge-index", String(index))
  el.setAttribute("data-from", edge.from)
  el.setAttribute("data-to", edge.to)
  el.setAttribute("data-tier", tier)
  el.setAttribute("data-confidence", String(edge.confidence))
  if (edge.rowId) el.setAttribute("data-row-id", edge.rowId)
  if (edge.isCrossLanguage) el.addClass("bb-edge-cross-language")
  const text = dom.create("span")
  text.addClass("bb-edge-label")
  text.textContent = `${edge.relationshipType} (${tier}, ${edge.confidence})`
  el.appendChild(text)
  appendEvidenceBadge(el, edge, tier, "bb-edge-badge", dom)
  // M42.H3: enrichment annotation — a distinct chip, never a tier change.
  // The tier badge above is UNTOUCHED (enrichment is an annotation, not an
  // evidence class, §12.3). Raw stored fields ride as data attributes; the
  // chip text is a compact renderer-side read of the same fields.
  appendEnrichmentChip(el, edge, dom)
  return el
}

/** W4 badge: tier name + confidence, class-distinct per tier, rendered from
 *  the SAME tier resolution as the element it sits on (a badge can never
 *  disagree). Shared by graph edges and hub usage rows (M42.H5). */
function appendEvidenceBadge(parent: GraphDomElement, edge: GraphEdgeLike, tier: EdgeTier, badgeClass: string, dom: GraphDom): void {
  const badge = dom.create("span")
  badge.addClass(badgeClass)
  badge.addClass(`bb-badge-${tier}`)
  badge.setAttribute("data-badge-tier", tier)
  badge.setAttribute("data-badge-confidence", String(edge.confidence))
  badge.textContent = `${tier} · ${edge.confidence}`
  parent.appendChild(badge)
}

/** H3 enrichment chip: an annotation, never a tier change. Raw stored fields
 *  ride as data attributes; the chip text is a compact renderer-side read. */
function appendEnrichmentChip(
  parent: GraphDomElement,
  edge: GraphEdgeLike,
  dom: GraphDom,
  enrichedClass = "bb-edge-enriched",
  chipClass = "bb-edge-enrichment",
): void {
  const enr = edge.metadata?.enrichment
  if (!enr || enr.inferredAt === undefined) return
  parent.addClass(enrichedClass)
  parent.setAttribute("data-enriched", "1")
  if (enr.role) parent.setAttribute("data-enrich-role", enr.role)
  if (enr.pattern) parent.setAttribute("data-enrich-pattern", enr.pattern)
  if (enr.layerFlow) parent.setAttribute("data-enrich-layer", enr.layerFlow)
  if (enr.criticality) parent.setAttribute("data-enrich-criticality", enr.criticality)
  if (enr.frequency) parent.setAttribute("data-enrich-frequency", enr.frequency)
  const chip = dom.create("span")
  chip.addClass(chipClass)
  const bits: string[] = []
  if (enr.role) bits.push(`role ${enr.role}`)
  if (enr.layerFlow) bits.push(enr.layerFlow)
  if (enr.criticality) bits.push(`${enr.criticality} criticality`)
  if (enr.frequency) bits.push(enr.frequency)
  chip.textContent = `⌾ ${bits.join(" · ")}`
  parent.appendChild(chip)
}

/** The tier legend — rendered with every graph, in UI terms. Inferred is
 *  always visually distinct by class (bb-badge-inferred / bb-edge-inferred). */
export function renderLegend(dom: GraphDom): GraphDomElement {
  const legend = dom.create("div")
  legend.addClass("bb-legend")
  legend.setAttribute("data-legend", "edge-evidence-tiers")
  const title = dom.create("span")
  title.addClass("bb-legend-title")
  title.textContent = "Edge evidence tiers:"
  legend.appendChild(title)
  for (const tier of EDGE_TIERS) {
    const item = dom.create("div")
    item.addClass("bb-legend-item")
    item.addClass(`bb-legend-${tier}`)
    const swatch = dom.create("span")
    swatch.addClass("bb-legend-swatch")
    swatch.addClass(`bb-badge-${tier}`)
    swatch.setAttribute("data-legend-tier", tier)
    const meaning = dom.create("span")
    meaning.addClass("bb-legend-meaning")
    meaning.textContent = `${tier}: ${TIER_MEANINGS[tier]}`
    item.appendChild(swatch)
    item.appendChild(meaning)
    legend.appendChild(item)
  }
  // M42.H3: the enrichment annotation legend — vocabulary EXTENDED, tiers
  // unchanged. Enrichment chips (⌾) are index-inferred annotations; they are
  // never an evidence class and never change the tier badge.
  const enrTitle = dom.create("span")
  enrTitle.addClass("bb-legend-title")
  enrTitle.textContent = "Enrichment annotations:"
  legend.appendChild(enrTitle)
  const enrItem = dom.create("div")
  enrItem.addClass("bb-legend-item")
  enrItem.addClass("bb-legend-enriched")
  enrItem.setAttribute("data-legend-enrichment", "1")
  const enrMeaning = dom.create("span")
  enrMeaning.addClass("bb-legend-meaning")
  enrMeaning.textContent = "⌾ role/pattern/layer/criticality — inferred by the index enrichment pass (M40); an annotation, never an evidence tier."
  enrItem.appendChild(enrMeaning)
  legend.appendChild(enrItem)
  return legend
}

function truncationMarker(kind: string, shown: number, total: number, dom: GraphDom): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-truncation-marker")
  el.setAttribute("data-truncated", kind)
  el.setAttribute("data-shown", String(shown))
  el.setAttribute("data-total-if-known", String(total))
  el.textContent = `Showing ${shown} of ${total} ${kind} (render budget exhausted — not all data is displayed)`
  return el
}

/** M28.A2 (D-6): the annotation badge for the root node. Author-labeled so
 *  an agent note never reads as index-derived fact; escaper-owned text.
 *  null when there are no annotations — no badge is rendered at all. */
export function renderAnnotationBadge(
  annotations: NonNullable<GraphResultLike["annotations"]>,
  rootSymbolName: string,
  dom: GraphDom,
): GraphDomElement | null {
  if (!Array.isArray(annotations) || annotations.length === 0) return null
  const badge = dom.create("div")
  badge.addClass("bb-annotation-badge")
  badge.setAttribute("data-annotation-count", String(annotations.length))
  const authors = [...new Set(annotations.map((a) => a.author_class))].sort()
  badge.setAttribute("data-annotation-authors", authors.join(","))
  // The badge names the node it belongs to — the defensive pairing rule.
  badge.setAttribute("data-node-symbol", rootSymbolName)
  const label = dom.create("span")
  label.addClass("bb-annotation-label")
  label.textContent = `${annotations.length} note${annotations.length === 1 ? "" : "s"} (${authors.join(",")})`
  badge.appendChild(label)
  for (const a of annotations) {
    const item = dom.create("div")
    item.addClass("bb-annotation-item")
    item.setAttribute("data-author-class", a.author_class)
    const who = dom.create("span")
    who.addClass("bb-annotation-meta")
    who.textContent = `${a.author_class} note by ${a.tool_identity}`
    const body = dom.create("span")
    body.addClass("bb-annotation-body")
    body.textContent = a.body
    item.appendChild(who)
    item.appendChild(body)
    badge.appendChild(item)
  }
  return badge
}

/** Render a graph result into the injected DOM. Deterministic; throws on a
 *  malformed result rather than rendering a guess. */
export function renderGraph(result: GraphResultLike, dom: GraphDom): RenderStats {
  if (!result || !result.root || typeof result.nodes !== "object") throw new Error("renderGraph: malformed graph result")
  if (!Array.isArray(result.callers) || !Array.isArray(result.callees)) throw new Error("renderGraph: malformed edge lists")

  const layer = dom.root()
  layer.addClass("bb-graph")

  const allEdges: GraphEdgeLike[] = [...result.callers, ...result.callees]
  const nodesTotal = Object.keys(result.nodes).length
  const edgesTotal = allEdges.length

  const nodesEl = dom.create("div")
  nodesEl.addClass("bb-nodes")
  const edgesEl = dom.create("div")
  edgesEl.addClass("bb-edges")

  // Deterministic node render order: root first, then callers, then callees,
  // each in edge order — the same input always yields the same DOM.
  const renderedIds = new Set<string>()
  const renderedRoots = new Map<string, GraphDomElement>()
  let nodesRendered = 0
  let nodesTruncated = false

  const put = (node: GraphNodeLike, role: string): void => {
    if (renderedIds.has(node.id)) return
    if (nodesRendered >= RENDER_BUDGET.maxNodes) {
      nodesTruncated = true
      return
    }
    const el = nodeElement(node, dom, role)
    nodesEl.appendChild(el)
    renderedRoots.set(node.id, el)
    renderedIds.add(node.id)
    nodesRendered++
  }

  put(result.root, "root")
  // M28.A2: the root's annotation badge rides ON the root node element —
  // a badge that could disagree with its node is a declared defect, so it
  // is attached to the node itself (W4 badge law, annotations flavor).
  const rootEl = renderedRoots.get(result.root.id)
  if (rootEl) {
    const badge = renderAnnotationBadge(result.annotations ?? [], result.root.name, dom)
    if (badge) rootEl.appendChild(badge)
  }
  for (const edge of result.callers) {
    const n = result.nodes[edge.from]
    if (n) put(n, "caller")
  }
  for (const edge of result.callees) {
    const n = result.nodes[edge.to]
    if (n) put(n, "callee")
  }

  let edgesRendered = 0
  let edgesTruncated = false
  for (const edge of allEdges) {
    if (edgesRendered >= RENDER_BUDGET.maxEdges) {
      edgesTruncated = true
      break
    }
    edgesEl.appendChild(edgeElement(edge, edgesRendered, dom))
    edgesRendered++
  }

  layer.appendChild(nodesEl)
  layer.appendChild(edgesEl)
  // W4: the legend ships with every graph — tier meanings are UI law, not a
  // docs garnish.
  layer.appendChild(renderLegend(dom))

  // Truncation is always declared in-UI, with real counts.
  if (nodesTruncated) layer.appendChild(truncationMarker("nodes", nodesRendered, nodesTotal, dom))
  if (edgesTruncated) layer.appendChild(truncationMarker("edges", edgesRendered, edgesTotal, dom))
  if (result.summary?.truncated && !result.summary.truncationReason) {
    // The model claims truncation without a reason: declared defect, surfaced.
    const el = dom.create("div")
    el.addClass("bb-truncation-marker")
    el.setAttribute("data-truncated", "traversal")
    el.textContent = "Traversal reported truncation without a declared reason"
    layer.appendChild(el)
  }

  return { nodesRendered, nodesTotal, edgesRendered, edgesTotal, nodesTruncated, edgesTruncated }
}

// --- M42.H4 (issue #652): impact rendering in the ONE core -------------------
// The hover's "Impact analysis" action opens the impact webview; rendering it
// belongs HERE (the one renderer core, import-pure) — not in a second
// server-side renderer that webviews could fork. The DOM contract was born in
// src/lsp/impact.ts's W5 law checks and is preserved verbatim (same classes,
// attributes, and marker text) so the W5 render laws still hold; only the
// home moved.

/** Structural model: the W5 ImpactResult (src/lsp/impact.ts). Declared
 *  locally so this core keeps its zero-import law. */
export interface ImpactResultLike {
  root: { id: string; name: string; file: string }
  impact: Array<{ id: string; name: string; file: string; depth: number; relationshipType: string; confidence: number }>
  shownCount: number
  /** null = the honest "unknown" total (never a fabricated number) */
  totalCountIfKnown: number | null
  truncated: boolean
  truncationReason: string | null
}

/** Render the impact set into the DOM port. Truncation renders a visible
 *  marker with declared counts (shown vs total-if-known, or "unknown") —
 *  silent truncation is impossible by construction here. */
export function renderImpact(result: ImpactResultLike, dom: GraphDom): { nodesRendered: number; marker: GraphDomElement | null } {
  const layer = dom.root()
  layer.addClass("bb-impact")
  layer.setAttribute("data-impact-root", result.root.id)
  for (const dep of result.impact) {
    const el = dom.create("div")
    el.addClass("bb-impact-node")
    el.setAttribute("data-id", dep.id)
    el.setAttribute("data-depth", String(dep.depth))
    el.textContent = `${dep.name} (${dep.file || "external"})`
    layer.appendChild(el)
  }
  let marker: GraphDomElement | null = null
  if (result.truncated) {
    marker = dom.create("div")
    marker.addClass("bb-impact-truncation-marker")
    marker.setAttribute("data-truncated", "impact")
    marker.setAttribute("data-shown", String(result.shownCount))
    marker.setAttribute("data-total-if-known", result.totalCountIfKnown === null ? "unknown" : String(result.totalCountIfKnown))
    marker.textContent =
      result.totalCountIfKnown === null
        ? `Showing ${result.shownCount} reverse dependencies (more exist — total unknown; render budget exhausted)`
        : `Showing ${result.shownCount} of ${result.totalCountIfKnown} reverse dependencies (render budget exhausted)`
    layer.appendChild(marker)
  }
  return { nodesRendered: result.impact.length, marker }
}

// --- M42.H5 (issue #653): the hub — usages as list/tree --------------------
// The hub renders the SAME usages-mode traversal result three ways (list by
// file, list by caller, call tree) through this ONE import-pure core. The
// panel pre-renders all three from a single query and a tiny local script
// toggles between them (docs/m42/HUB.md — the authored contract). Laws:
// deterministic (no Math.random/Date.now), every row model-traceable via
// data-row-id, every row badged with the SAME tier resolution as edges, no
// fabricated rows, truncation + empty honesty declared.

export interface HubUsageRow {
  dir: "caller" | "callee"
  /** endpoint name: the caller (dir=caller) or callee (dir=callee) */
  name: string
  file: string
  line: number
  depth: number
  edge: GraphEdgeLike
}

/** The deterministic usage row set: callers (as traversed) then callees.
 *  An edge whose endpoint node is missing (external/unindexed) still yields
 *  a row with the declared (external) marker — a drop would lie. */
export function hubUsages(result: GraphResultLike): HubUsageRow[] {
  const rows: HubUsageRow[] = []
  for (const edge of result.callers) {
    const node = result.nodes[edge.from]
    rows.push({
      dir: "caller",
      name: node?.name ?? "(external)",
      file: node?.file ?? "",
      line: node?.line ?? 0,
      depth: edge.depth,
      edge,
    })
  }
  for (const edge of result.callees) {
    const node = result.nodes[edge.to]
    rows.push({
      dir: "callee",
      name: node?.name ?? "(external)",
      file: node?.file ?? "",
      line: node?.line ?? 0,
      depth: edge.depth,
      edge,
    })
  }
  return rows
}

export interface HubGroup {
  key: string
  rows: HubUsageRow[]
}

/** Group rows by first-appearance order of the key (deterministic). */
function groupRows(rows: HubUsageRow[], keyOf: (r: HubUsageRow) => string): HubGroup[] {
  const order: string[] = []
  const map = new Map<string, HubUsageRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(row)
  }
  return order.map((key) => ({ key, rows: map.get(key)! }))
}

export const groupUsagesByFile = (rows: HubUsageRow[]): HubGroup[] => groupRows(rows, (r) => (r.file.length > 0 ? r.file : "(external)"))

export const groupUsagesByCaller = (rows: HubUsageRow[]): HubGroup[] => groupRows(rows, (r) => (r.name.length > 0 ? r.name : "(external)"))

/** Row element shared by list and tree layouts. */
function hubRowElement(row: HubUsageRow, dom: GraphDom): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-hub-row")
  el.setAttribute("data-dir", row.dir)
  el.setAttribute("data-depth", String(row.depth))
  if (row.edge.rowId) el.setAttribute("data-row-id", row.edge.rowId)
  const name = dom.create("span")
  name.addClass("bb-hub-row-name")
  name.textContent = row.name
  const meta = dom.create("span")
  meta.addClass("bb-hub-row-meta")
  meta.textContent = row.file.length > 0 ? `${row.file}:${row.line}` : "(external)"
  el.appendChild(name)
  el.appendChild(meta)
  const tier = tierForEdge(row.edge)
  el.setAttribute("data-tier", tier)
  el.setAttribute("data-confidence", String(row.edge.confidence))
  appendEvidenceBadge(el, row.edge, tier, "bb-hub-badge", dom)
  appendEnrichmentChip(el, row.edge, dom, "bb-hub-enriched", "bb-hub-enrichment")
  return el
}

/** Summary line + declared truncation; shared by every hub section. */
function hubSummary(result: GraphResultLike, layer: GraphDomElement, dom: GraphDom): void {
  const summary = dom.create("div")
  summary.addClass("bb-hub-summary")
  summary.setAttribute("data-callers", String(result.callers.length))
  summary.setAttribute("data-callees", String(result.callees.length))
  summary.textContent = `${result.callers.length} caller${result.callers.length === 1 ? "" : "s"} · ${result.callees.length} callee${result.callees.length === 1 ? "" : "s"}`
  layer.appendChild(summary)
  if (result.summary?.truncated) {
    const shown = result.callers.length + result.callees.length
    const total = (result.summary.totalCallers ?? 0) + (result.summary.totalCallees ?? 0)
    const marker = dom.create("div")
    marker.addClass("bb-truncation-marker")
    marker.setAttribute("data-truncated", "hub")
    marker.setAttribute("data-shown", String(shown))
    marker.setAttribute("data-total-if-known", String(total))
    marker.textContent = `Showing ${shown} of ${total} usages (render budget exhausted — not all data is displayed)`
    layer.appendChild(marker)
  }
}

/** The hub section root with its shared header. Renders INTO dom.root() —
 *  the same convention as renderGraph (an orphaned section would make the
 *  hub render empty markup; M26.V1 P5 catches exactly that). */
function hubSection(result: GraphResultLike, dom: GraphDom, sectionClass: string): GraphDomElement {
  const section = dom.root()
  section.addClass("bb-hub")
  section.addClass(sectionClass)
  section.setAttribute("data-symbol", result.root?.name ?? "")
  hubSummary(result, section, dom)
  return section
}

/** List view: usage rows grouped by file or by caller. Empty set renders the
 *  declared empty state (never fabricated rows). */
export function renderHubList(result: GraphResultLike, dom: GraphDom, group: "file" | "caller"): RenderStats {
  const section = hubSection(result, dom, "bb-hub-list")
  section.setAttribute("data-group", group)
  const rows = hubUsages(result)
  if (rows.length === 0) {
    const empty = dom.create("div")
    empty.addClass("bb-hub-empty")
    empty.textContent = "no indexed usages for this symbol"
    section.appendChild(empty)
    return { nodesRendered: 0, nodesTotal: 0, edgesRendered: 0, edgesTotal: 0, nodesTruncated: false, edgesTruncated: false }
  }
  const groups = group === "file" ? groupUsagesByFile(rows) : groupUsagesByCaller(rows)
  for (const group of groups) {
    const g = dom.create("div")
    g.addClass("bb-hub-group")
    g.setAttribute("data-group-name", group.key)
    const label = dom.create("span")
    label.addClass("bb-hub-group-label")
    label.textContent = group.key
    g.appendChild(label)
    for (const row of group.rows) g.appendChild(hubRowElement(row, dom))
    section.appendChild(g)
  }
  return { nodesRendered: rows.length, nodesTotal: rows.length, edgesRendered: rows.length, edgesTotal: rows.length, nodesTruncated: false, edgesTruncated: false }
}

/** Tree view: rows laid out by traversal depth (callers first — who calls
 *  the symbol, recursively — then callees), indented by data-depth. */
export function renderHubTree(result: GraphResultLike, dom: GraphDom): RenderStats {
  const section = hubSection(result, dom, "bb-hub-tree")
  const rows = hubUsages(result)
  if (rows.length === 0) {
    const empty = dom.create("div")
    empty.addClass("bb-hub-empty")
    empty.textContent = "no indexed usages for this symbol"
    section.appendChild(empty)
    return { nodesRendered: 0, nodesTotal: 0, edgesRendered: 0, edgesTotal: 0, nodesTruncated: false, edgesTruncated: false }
  }
  for (const row of rows) section.appendChild(hubRowElement(row, dom))
  return { nodesRendered: rows.length, nodesTotal: rows.length, edgesRendered: rows.length, edgesTotal: rows.length, nodesTruncated: false, edgesTruncated: false }
}
