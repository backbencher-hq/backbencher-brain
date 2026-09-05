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
  metadata?: { evidenceClass?: string }
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
  // W4: the visible badge — tier name + confidence, class-distinct per tier.
  // Rendered from the SAME tier resolution as the edge class, so a badge can
  // never disagree with the edge it sits on.
  const badge = dom.create("span")
  badge.addClass("bb-edge-badge")
  badge.addClass(`bb-badge-${tier}`)
  badge.setAttribute("data-badge-tier", tier)
  badge.setAttribute("data-badge-confidence", String(edge.confidence))
  badge.textContent = `${tier} · ${edge.confidence}`
  el.appendChild(badge)
  return el
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
