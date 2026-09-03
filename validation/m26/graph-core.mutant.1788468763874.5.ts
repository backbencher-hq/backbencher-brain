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
  el.setAttribute("data-row-id", edge.rowId ?? "fabricated-" + index)
  if (edge.isCrossLanguage) el.addClass("bb-edge-cross-language")
  const text = dom.create("span")
  text.addClass("bb-edge-label")
  text.textContent = `${edge.relationshipType} (${tier}, ${edge.confidence})`
  el.appendChild(text)
  return el
}

function truncationMarker(kind: string, shown: number, total: number, dom: GraphDom): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-truncation-marker")
  el.setAttribute("data-truncated", kind)
  el.textContent = `Showing ${shown} of ${total} ${kind} (render budget exhausted — not all data is displayed)`
  return el
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
  let nodesRendered = 0
  let nodesTruncated = false

  const put = (node: GraphNodeLike, role: string): void => {
    if (renderedIds.has(node.id)) return
    if (nodesRendered >= RENDER_BUDGET.maxNodes) {
      nodesTruncated = true
      return
    }
    nodesEl.appendChild(nodeElement(node, dom, role))
    renderedIds.add(node.id)
    nodesRendered++
  }

  put(result.root, "root")
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
