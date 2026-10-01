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

/** M62.A2 (issue #876): the address mirror of
 *  `CallSiteAddress` (src/intelligence/contracts.ts). The owner
 *  (`src/intelligence/graph/line-address.ts`) derives and formats it; this
 *  core stays import-pure (W1), so the shape and the formatter are MIRRORED
 *  here and drift-gated against the owner by script/m62/verify-consumers.ts.
 *  A renderer may never present a position the owner did not derive: a
 *  `declaration` is a labeled substitute and an `unknown` has no position at
 *  all. */
export interface CallSiteAddressLike {
  kind: "call-site" | "declaration" | "unknown"
  file: string
  line: number | null
  note?: string
}

/** Mirror of the owner's `formatAddress` (drift-gated, M62.A2). */
export function formatCallSiteAddress(a: CallSiteAddressLike): string {
  const position = a.line === null ? null : a.file.length > 0 ? `${a.file}:${a.line}` : `line ${a.line}`
  if (a.kind === "call-site") return position ?? "call site not stored"
  const note = a.note ?? "call site not stored"
  if (position === null) return a.file.length > 0 ? `${a.file} — ${note}` : note
  return `${position} — ${note}`
}

export interface GraphEdgeLike {
  from: string
  to: string
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  bridgeMechanism?: string
  callSite: CallSiteAddressLike
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

// M55.T5: the derivation mirror. The owner is src/lsp/evidence_tier.ts
// (the server's ONE classifier); this core is import-pure (verify-webview-core
// P1: zero imports) so it mirrors the rule, and script/m55/verify-tiers.ts
// drift-gates the mirror on a declared case table against the owner. Before
// T5 this set lacked the containment/exports/instantiates facts and the
// `uses`/`usage` kinds, so a hub row whose analyzer stored no class rendered
// `inferred` where the hover card for the same row rendered `structural` /
// `usage_contextual` — a symbol with two tier stories.
const STRUCTURAL_TYPES = new Set([
  "call",
  "calls",
  "extends",
  "inherits",
  "implements",
  "overrides",
  "override",
  "contains",
  "exports",
  "instantiates",
])
const IMPORT_TYPES = new Set(["imports", "import"])
const USAGE_TYPES = new Set(["reference", "references", "use", "uses", "usage"])
const REFERENCE_QUALIFIED_TYPES = new Set(["references_qualified", "reference_qualified"])

/** Tier meanings in UI terms — the legend vocabulary. Documented decision:
 *  the 0.7 confidence floor mirrors patterns.ts inheritance — at or above it
 *  a structural claim is stored/derived; below it the edge is a guess and
 *  MUST render as inferred. Kept in sync with the hover gloss
 *  (src/lsp/cross_language_hover.ts) — the W4 verifier drift-gates the two. */
export const TIER_MEANINGS: Record<EdgeTier, string> = {
  structural: "stored or derived structure (calls/extends/implements/overrides/contains/exports/instantiates at confidence >= 0.7) — safe to trust for navigation",
  import_based: "derived from import statements — the module relationship is real, the use may be indirect",
  usage_contextual: "usage-site evidence — the name appears in context, not guaranteed to be a call",
  reference_qualified: "reference with qualifier evidence — stronger than usage_contextual, weaker than structure",
  inferred: "a guess or an unrecognized relationship kind (heuristic, or confidence < 0.7) — treat as a hint, never as fact",
}

/** Tier for an edge: a STORED legend-tier evidenceClass wins; else the
 *  declared derivation (the owner's rule, mirrored — see STRUCTURAL_TYPES).
 *  A stored label outside the legend is not a tier claim (M55.T5), so the
 *  edge's own kind decides, exactly as src/lsp/evidence_tier.ts does.
 *  The 0.7 confidence floor mirrors the inheritance threshold decision in
 *  patterns.ts — below it, an edge is a guess and must render as inferred. */
export function tierForEdge(edge: GraphEdgeLike): EdgeTier {
  const stored = edge.metadata?.evidenceClass
  if (stored && (EDGE_TIERS as readonly string[]).includes(stored)) return stored as EdgeTier
  const t = edge.relationshipType.trim().toLowerCase()
  if (STRUCTURAL_TYPES.has(t)) return edge.confidence >= 0.7 ? "structural" : "inferred"
  if (IMPORT_TYPES.has(t)) return "import_based"
  if (USAGE_TYPES.has(t)) return "usage_contextual"
  if (REFERENCE_QUALIFIED_TYPES.has(t)) return "reference_qualified"
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

/** The ONE tier -> badge-class mapping (M55.T5 acceptance 4): the legend
 *  swatch and every evidence badge derive their class from this single
 *  function, so the rendering path can never disagree with the legend it
 *  ships. Before T5 the template was written twice (legend + badge) and the
 *  two could drift silently; script/m55/verify-tiers.ts asserts the template
 *  appears exactly once in this source. */
export function badgeClassForTier(tier: EdgeTier): string {
  return `bb-badge-${tier}`
}

/** W4 badge: tier name + confidence, class-distinct per tier, rendered from
 *  the SAME tier resolution as the element it sits on (a badge can never
 *  disagree). Shared by graph edges and hub usage rows (M42.H5). */
function appendEvidenceBadge(parent: GraphDomElement, edge: GraphEdgeLike, tier: EdgeTier, badgeClass: string, dom: GraphDom): void {
  const badge = dom.create("span")
  badge.addClass(badgeClass)
  badge.addClass(badgeClassForTier(tier))
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
    swatch.addClass(badgeClassForTier(tier))
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
  // M44.U4: the staleness legend — the marker semantics shared by the hub
  // panel, graph, and impact surfaces. Statuses mirror the server's
  // StaleMarker (src/lsp/freshness.ts): fresh | stale | missing | unknown.
  // The legend never claims freshness — it explains what each marker means.
  const staleTitle = dom.create("span")
  staleTitle.addClass("bb-legend-title")
  staleTitle.textContent = "Staleness:"
  legend.appendChild(staleTitle)
  const staleMeanings: Array<[string, string]> = [
    ["fresh", "fresh — indexed data matches the files on disk; no marker is shown"],
    ["stale", "⚠️ stale — the file changed since indexing (or a reindex is pending); the data may be outdated — refresh before trusting it"],
    ["missing", "missing — an indexed file is no longer on disk; the data refers to a file that moved or was deleted"],
    ["unknown", "unknown — freshness cannot be claimed for this file; declared unknown, never silently fresh"],
  ]
  for (const [status, meaning] of staleMeanings) {
    const item = dom.create("div")
    item.addClass("bb-legend-item")
    item.addClass(`bb-legend-stale-${status}`)
    item.setAttribute("data-legend-status", status)
    const swatch = dom.create("span")
    swatch.addClass("bb-legend-swatch")
    swatch.addClass(`bb-stale-swatch-${status}`)
    const meaningEl = dom.create("span")
    meaningEl.addClass("bb-legend-meaning")
    meaningEl.textContent = meaning
    item.appendChild(swatch)
    item.appendChild(meaningEl)
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
  /** M63.T1: how the requested name became the root this walk started at.
   *  Optional so hand-built fixtures keep type-checking; a surface that
   *  receives it says so out loud (see renderImpact). */
  rootMatch?: { requested: string; via: "exact" | "fuzzy-containment" | "owning-declaration"; nameMatches: number }
}

/** M55.T1 (Truth Rule 2): a declared substitution is rendered on EVERY surface
 *  that names the target — ONE helper, called by impact, the hub list and the
 *  hub tree. Machine-readable attributes plus a visible note; an unlabeled
 *  substitution is the defect this exists to prevent (the filing run: the
 *  constructor graph opened titled `Store` with nothing said). The wording is
 *  passed in so each surface keeps its own declared noun and the M44.U5
 *  impact rendering stays byte-identical. */
export function appendResolutionNote(
  layer: GraphDomElement,
  dom: GraphDom,
  result: { resolution?: { through?: string; memberName?: string; ownerName?: string } },
  text: (member: string, owner: string) => string,
): GraphDomElement | null {
  const resolution = result.resolution
  if (resolution === undefined || resolution.through !== "owning-declaration") return null
  layer.setAttribute("data-resolution-through", "owning-declaration")
  if (resolution.memberName) layer.setAttribute("data-resolution-member", resolution.memberName)
  if (resolution.ownerName) layer.setAttribute("data-resolution-owner", resolution.ownerName)
  const note = dom.create("div")
  note.addClass("bb-resolution-note")
  note.setAttribute("data-resolution", "owning-declaration")
  note.textContent = text(resolution.memberName ?? "member", resolution.ownerName ?? "")
  layer.appendChild(note)
  return note
}

/** Render the impact set into the DOM port. Truncation renders a visible
 *  marker with declared counts (shown vs total-if-known, or "unknown") —
 *  silent truncation is impossible by construction here. */
export function renderImpact(result: ImpactResultLike, dom: GraphDom): { nodesRendered: number; marker: GraphDomElement | null } {
  const layer = dom.root()
  layer.addClass("bb-impact")
  layer.setAttribute("data-impact-root", result.root.id)
  // M44.U5: the declared resolution rides the render — a member target
  // rooted through its owning declaration SAYS so (never a silent relabel
  // of what the user clicked). Machine-readable attr + visible note.
  const impactNote = appendResolutionNote(
    layer,
    dom,
    result as { resolution?: { through?: string; memberName?: string; ownerName?: string } },
    (member, owner) => `"${member}" has no dependencies of its own — showing the impact of its owner ${owner}`,
  )
  if (impactNote !== null) impactNote.addClass("bb-impact-resolution-note")
  // M63.T1: a name that did not resolve to an exact stored symbol is a
  // SUBSTITUTION too, and the same law applies: the panel says which symbol
  // the question was actually asked about, and how many stored symbols share
  // the name. Measured on the bb_impact corpus lane: an agent asked about
  // graphql-js `push` (141 stored relationships point at a `push`) gets the
  // impact of a different `push` — here an empty set — and a panel that shows
  // only the numbers is indistinguishable from "nothing depends on this".
  // The owning-declaration case already has its own note above, so this only
  // speaks when the name itself was not an exact hit.
  const match = result.rootMatch
  if (match && match.via !== "exact" && match.via !== "owning-declaration") {
    layer.setAttribute("data-root-match", match.via)
    layer.setAttribute("data-root-requested", match.requested)
    layer.setAttribute("data-root-name-matches", String(match.nameMatches))
    const note = dom.create("div")
    note.addClass("bb-root-match-note")
    note.setAttribute("data-root-match", match.via)
    note.textContent = `"${match.requested}" is not a stored symbol on its own — showing the impact of ${result.root.name}${result.root.file ? ` (${result.root.file})` : ""}`
    layer.appendChild(note)
  }
  for (const dep of result.impact) {
    const el = dom.create("div")
    el.addClass("bb-impact-node")
    el.setAttribute("data-id", dep.id)
    el.setAttribute("data-depth", String(dep.depth))
    el.textContent = `${dep.name} (${dep.file || "external"})`
    layer.appendChild(el)
  }
  // Declared empty-state (owner live test, 2026-09-12): a resolved root with
  // zero stored reverse dependencies renders a visible note — never
  // legend-only silence, which reads as a broken panel. Absence is declared,
  // not assumed: the note states what absence means and how to refresh.
  if (result.impact.length === 0) {
    const emptyNote = dom.create("div")
    emptyNote.addClass("bb-impact-empty")
    emptyNote.setAttribute("data-empty", "impact")
    emptyNote.textContent =
      "No reverse dependencies stored for this symbol — nothing in the index calls or references it (declared absence; re-index if the code recently changed)."
    layer.appendChild(emptyNote)
  }
  // U4: the ONE badge legend ships with the impact surface too (§13.9).
  layer.appendChild(renderLegend(dom))
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

// --- M42.H5 (issue #653) / M44.U1 (issue #688): the hub — grouped usages ---
// The hub renders the usages-mode result three ways (list by file, list by
// caller, call tree) through this ONE import-pure core. M44.U1 made the
// SERVER group usages per symbol (src/lsp/graph_usages.ts) — the renderers
// below consume that grouped shape: ONE visual row per caller/callee symbol
// with declared relationship-type counts (§13.1/§13.2), file-level and
// external rows in labeled sections (§13.5), and header counts that equal
// the rendered group count (§13.4). The panel pre-renders all three from a
// single query and a tiny local script toggles between them. Laws:
// deterministic (no Math.random/Date.now); every group row is
// model-traceable via data-symbol-id + data-row-ids (its full stored-row
// inventory — nothing dropped); every relationship type renders a chip whose
// tier is the SAME tier resolution as edges (uniform, else declared
// "mixed"); no fabricated rows; truncation + empty honesty declared.
//
// The grouped types below are a STRUCTURAL mirror of src/lsp/graph_usages.ts
// (GroupedUsages & friends): this core keeps its zero-import law (W1), and
// hub-panel passes the server-typed value through — tsc checks the shapes
// agree at that call site (a compile-time drift gate).

export interface GroupedHubRow {
  rowId: string
  relationshipType: string
  /** M62.A2: the owner-derived address (never a bare fabricated line). */
  callSite?: CallSiteAddressLike
  depth: number
  confidence: number
  isCrossLanguage: boolean
  bridgeMechanism?: string
  evidenceClass?: string
  enrichment?: {
    inferredAt?: number
    role?: string
    pattern?: string
    layerFlow?: string
    criticality?: string
    frequency?: string
  }
  /** M44.U3: the tree parent symbol id this row's edge hangs under (the
   *  endpoint one hop toward the root). Depth-0 rows parent to the root
   *  symbol. Optional at the TYPE level so hand-built list fixtures stay
   *  valid; renderHubTree requires it for depth ≥ 1 (a deeper row without a
   *  parent cannot nest — declared error, never a fabricated position). */
  parentSymbolId?: string
  parentName?: string
}

export interface GroupedHubEntry {
  symbolId: string
  name: string
  file: string
  language: string
  symbolType: string
  line: number
  isExternal: boolean
  relationshipTypes: Array<{ type: string; occurrences: number }>
  occurrences: number
  rows: GroupedHubRow[]
}

export interface GroupedHubFileLevelRow {
  rowId: string
  relationshipType: string
  moduleSpecifier: string
  confidence: number
}

export interface GroupedHub {
  root: { symbolId: string; name: string; file: string; language: string; line: number }
  callers: GroupedHubEntry[]
  callees: GroupedHubEntry[]
  fileLevel: { imports: GroupedHubFileLevelRow[]; exports: GroupedHubFileLevelRow[] }
  counts: {
    callerGroups: number
    calleeGroups: number
    callerRows: number
    calleeRows: number
    fileLevelRows: number
  }
  summary: { truncated: boolean; truncationReason?: string; crossLanguageGroups: number }
  annotations?: Array<{ author_class: string; tool_identity: string; body: string; time_updated: number }>
}

/** Tier for a relationship TYPE inside a group: uniform when every stored
 *  row of that type resolves to one tier, else "mixed" — declared, never a
 *  fabricated single answer (a mixed type is mixed, honestly). */
export function tierForTypeRows(rows: GroupedHubRow[]): EdgeTier | "mixed" {
  const tiers = new Set(
    rows.map((r) =>
      tierForEdge({
        relationshipType: r.relationshipType,
        confidence: r.confidence,
        metadata: { evidenceClass: r.evidenceClass },
      } as GraphEdgeLike),
    ),
  )
  return tiers.size === 1 ? [...tiers][0]! : "mixed"
}

function relChips(entry: GroupedHubEntry, parent: GraphDomElement, dom: GraphDom): void {
  const wrap = dom.create("span")
  wrap.addClass("bb-hub-relchips")
  for (const rt of entry.relationshipTypes) {
    const typeRows = entry.rows.filter((r) => r.relationshipType === rt.type)
    const tier = tierForTypeRows(typeRows)
    const chip = dom.create("span")
    chip.addClass("bb-hub-relchip")
    // M55.T5: the chip's class comes from the ONE mapping (badgeClassForTier),
    // never a second literal template — the legend, the edge badge and the hub
    // chip must be incapable of disagreeing.
    chip.addClass(tier === "mixed" ? "bb-badge-mixed" : badgeClassForTier(tier))
    chip.setAttribute("data-rel-type", rt.type)
    chip.setAttribute("data-occurrences", String(rt.occurrences))
    chip.setAttribute("data-tier", tier)
    chip.textContent = `${rt.type} ×${rt.occurrences}`
    wrap.appendChild(chip)
  }
  parent.appendChild(wrap)
}

/** M62.A2: the declared address kind of one stored row ("none" when the row
 *  carries no address). A renderer that shows a position must say which kind
 *  it is showing. */
export function callSiteKindOf(row: GroupedHubRow): string {
  return row.callSite?.kind ?? "none"
}

/** The address kinds present across a group's stored rows, sorted — the
 *  machine-readable claim the hub row makes about its positions. One kind when
 *  the rows agree; several when they differ (the row shows more than one
 *  claim, and says so rather than picking one). */
export function callSiteKindsOfEntry(entry: GroupedHubEntry): string {
  const kinds = [...new Set(entry.rows.map(callSiteKindOf))].sort()
  return kinds.length > 0 ? kinds.join(",") : "none"
}

/** Enrichment is stored per ROW; a group is enriched when any member row is.
 *  The labeled chip lists the DISTINCT roles present (never an invented
 *  single answer); data-enriched is presence-gated. */
function groupEnrichment(entry: GroupedHubEntry, parent: GraphDomElement, dom: GraphDom): void {
  const enriched = entry.rows.filter((r) => r.enrichment?.inferredAt !== undefined)
  if (enriched.length === 0) return
  parent.addClass("bb-hub-enriched")
  parent.setAttribute("data-enriched", "1")
  const roles = [...new Set(enriched.map((r) => r.enrichment?.role).filter((x): x is string => !!x))].sort()
  if (roles.length > 0) parent.setAttribute("data-enrich-roles", roles.join(","))
  const chip = dom.create("span")
  chip.addClass("bb-hub-enrichment")
  chip.textContent = roles.length > 0 ? `⌾ enriched (${roles.join(", ")})` : "⌾ enriched"
  parent.appendChild(chip)
}

function groupRow(entry: GroupedHubEntry, dir: "caller" | "callee", dom: GraphDom): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-hub-row")
  el.addClass("bb-hub-symrow")
  el.setAttribute("data-dir", dir)
  el.setAttribute("data-symbol-id", entry.symbolId)
  el.setAttribute("data-row-ids", entry.rows.map((r) => r.rowId).join(" "))
  el.setAttribute("data-occurrences", String(entry.occurrences))
  if (entry.rows.length > 0) el.setAttribute("data-depth", String(Math.min(...entry.rows.map((r) => r.depth))))
  // M62.A2: the row declares which address kinds it is showing.
  el.setAttribute("data-callsite-kinds", callSiteKindsOfEntry(entry))
  // H6 machine click targets: index-resolved file/line/symbol — the bridge
  // navigates from these attrs, never from the display text (issue #654).
  const navigable = entry.file.length > 0
  if (navigable) el.setAttribute("data-file", entry.file)
  el.setAttribute("data-line", String(entry.line))
  el.setAttribute("data-symbol", entry.name)
  // U2 §13.3: the click affordance is DECLARED — data-clickable=1 iff the
  // bridge can actually navigate this row (file + line resolved). A clickable
  // target rendered without the affordance, or an affordance on a row the
  // bridge cannot navigate, is a lying renderer (harness AH1-negative).
  el.setAttribute("data-clickable", navigable ? "1" : "0")
  // U2 keyboard parity: a navigable row is focusable and Enter/Space posts
  // the same navigate message as a click (bridge-generated from the same
  // module). A non-navigable row stays out of the tab order.
  if (navigable) el.setAttribute("tabindex", "0")
  else el.addClass("bb-hub-row-unclickable")
  if (entry.isExternal) el.addClass("bb-hub-row-external")
  // Name-first anatomy (U2): name → meta → chips, chevron last. The whole
  // row is the click target (the bridge walks up from ev.target to the row).
  const main = dom.create("span")
  main.addClass("bb-hub-row-main")
  const name = dom.create("span")
  name.addClass("bb-hub-row-name")
  name.textContent = entry.name
  const meta = dom.create("span")
  meta.addClass("bb-hub-row-meta")
  meta.textContent = entry.file.length > 0 ? `${entry.file}:${entry.line}` : "(external)"
  main.appendChild(name)
  main.appendChild(meta)
  el.appendChild(main)
  relChips(entry, el, dom)
  groupEnrichment(entry, el, dom)
  const chevron = dom.create("span")
  chevron.addClass("bb-hub-chevron")
  chevron.setAttribute("aria-hidden", "true")
  chevron.textContent = navigable ? "›" : "·"
  el.appendChild(chevron)
  return el
}

/** Summary line + declared truncation; shared by every hub section. Header
 *  counts are DERIVED FROM THE RENDERED GROUPS (U4, §13.4) — the number the
 *  eye can verify against the rows below — never trusted from the server
 *  counts block; the server's own group/row counts ride as declared
 *  data-server-* attributes so any drift between the two is visible, not
 *  hidden. Row counts are derived from the rendered rows' declared
 *  multiplicity. */
function hubSummary(grouped: GroupedHub, layer: GraphDomElement, dom: GraphDom): void {
  const callerGroups = grouped.callers.length
  const calleeGroups = grouped.callees.length
  const callerRows = grouped.callers.reduce((n, g) => n + g.rows.length, 0)
  const calleeRows = grouped.callees.reduce((n, g) => n + g.rows.length, 0)
  const fileLevelRows = grouped.fileLevel.imports.length + grouped.fileLevel.exports.length
  const summary = dom.create("div")
  summary.addClass("bb-hub-summary")
  summary.setAttribute("data-callers", String(callerGroups))
  summary.setAttribute("data-callees", String(calleeGroups))
  summary.setAttribute("data-caller-rows", String(callerRows))
  summary.setAttribute("data-callee-rows", String(calleeRows))
  summary.setAttribute("data-file-level-rows", String(fileLevelRows))
  summary.setAttribute("data-server-callers", String(grouped.counts.callerGroups))
  summary.setAttribute("data-server-callees", String(grouped.counts.calleeGroups))
  summary.textContent = `${callerGroups} caller${callerGroups === 1 ? "" : "s"} · ${calleeGroups} callee${calleeGroups === 1 ? "" : "s"}`
  layer.appendChild(summary)
  if (grouped.summary.truncated) {
    const shown = grouped.counts.callerGroups + grouped.counts.calleeGroups
    const marker = dom.create("div")
    marker.addClass("bb-truncation-marker")
    marker.setAttribute("data-truncated", "hub")
    marker.setAttribute("data-shown", String(shown))
    marker.setAttribute("data-total-if-known", "unknown")
    marker.textContent = `Showing ${shown} usage groups (traversal truncated${grouped.summary.truncationReason ? `: ${grouped.summary.truncationReason}` : ""} — more usages exist but the total is not computed)`
    layer.appendChild(marker)
  }
}

/** File-level sections: declared, labeled, never merged into symbol rows
 *  (§13.5). Rendered only when such rows exist — presence-gated absence. */
function fileLevelSections(grouped: GroupedHub, layer: GraphDomElement, dom: GraphDom): void {
  const all = [...grouped.fileLevel.imports, ...grouped.fileLevel.exports]
  if (all.length === 0) return
  const box = dom.create("div")
  box.addClass("bb-hub-filelevel")
  box.setAttribute("data-file-level-rows", String(all.length))
  const title = dom.create("span")
  title.addClass("bb-hub-filelevel-title")
  title.textContent = `file-level ${grouped.fileLevel.imports.length > 0 ? "imports" : ""}${grouped.fileLevel.imports.length > 0 && grouped.fileLevel.exports.length > 0 ? " / " : ""}${grouped.fileLevel.exports.length > 0 ? "exports" : ""} (module specifiers — no symbol endpoint in the index)`
  box.appendChild(title)
  for (const row of [...grouped.fileLevel.imports, ...grouped.fileLevel.exports]) {
    const el = dom.create("div")
    el.addClass("bb-hub-flrow")
    el.setAttribute("data-row-id", row.rowId)
    el.setAttribute("data-fl-type", row.relationshipType)
    el.setAttribute("data-module", row.moduleSpecifier)
    el.textContent = `${row.relationshipType} ${row.moduleSpecifier || "(module not recorded)"}`
    box.appendChild(el)
  }
  layer.appendChild(box)
}

function hubSection(grouped: GroupedHub, dom: GraphDom, sectionClass: string): GraphDomElement {
  const section = dom.root()
  section.addClass("bb-hub")
  section.addClass(sectionClass)
  section.setAttribute("data-symbol", grouped.root.name)
  hubSummary(grouped, section, dom)
  fileLevelSections(grouped, section, dom)
  return section
}

function hubEmpty(section: GraphDomElement, dom: GraphDom): void {
  const empty = dom.create("div")
  empty.addClass("bb-hub-empty")
  empty.textContent = "no indexed usages for this symbol"
  section.appendChild(empty)
}

function allEntries(grouped: GroupedHub): Array<{ entry: GroupedHubEntry; dir: "caller" | "callee" }> {
  return [
    ...grouped.callers.map((entry) => ({ entry, dir: "caller" as const })),
    ...grouped.callees.map((entry) => ({ entry, dir: "callee" as const })),
  ]
}

/** List view: one row per symbol group, sectioned by file (group="file") or
 *  by caller name (group="caller"). Group headers carry per-group row counts
 *  (U2: counts that match what is rendered, §13.4). Empty set renders the
 *  declared empty state (never fabricated rows). */
export function renderHubList(grouped: GroupedHub, dom: GraphDom, group: "file" | "caller"): RenderStats {
  const section = hubSection(grouped, dom, "bb-hub-list")
  section.setAttribute("data-group", group)
  // M55.T1: a member target rooted through its owning declaration is LABELED
  // here too, through the same helper the impact surface uses (one label rule,
  // one wording per surface). The hub is where the silent relabel was found.
  appendResolutionNote(section, dom, grouped as { resolution?: { through?: string; memberName?: string; ownerName?: string } }, (member, owner) =>
    `"${member}" has no graph of its own — showing the usages of its owning declaration ${owner}`,
  )
  const all = allEntries(grouped)
  if (all.length === 0) {
    hubEmpty(section, dom)
    return { nodesRendered: 0, nodesTotal: 0, edgesRendered: 0, edgesTotal: 0, nodesTruncated: false, edgesTruncated: false }
  }
  const byKey = new Map<string, Array<{ entry: GroupedHubEntry; dir: "caller" | "callee" }>>()
  for (const item of all) {
    const key = group === "file" ? (item.entry.file.length > 0 ? item.entry.file : "(external)") : (item.entry.name.length > 0 ? item.entry.name : "(external)")
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(item)
  }
  const keys = [...byKey.keys()].sort()
  for (const key of keys) {
    const g = dom.create("div")
    g.addClass("bb-hub-group")
    g.setAttribute("data-group-name", key)
    const items = byKey.get(key)!
    items.sort((a, b) => a.entry.file.localeCompare(b.entry.file) || a.entry.name.localeCompare(b.entry.name) || a.entry.symbolId.localeCompare(b.entry.symbolId))
    // U2 §13.4: the header count is what the eye can verify — the number of
    // rows the group actually renders below it.
    const label = dom.create("span")
    label.addClass("bb-hub-group-label")
    label.setAttribute("data-group-count", String(items.length))
    label.textContent = `${key} · ${items.length}`
    g.appendChild(label)
    for (const item of items) g.appendChild(groupRow(item.entry, item.dir, dom))
    section.appendChild(g)
  }
  // U4: the ONE badge legend ships with the hub list too (§13.9).
  section.appendChild(renderLegend(dom))
  return { nodesRendered: all.length, nodesTotal: all.length, edgesRendered: 0, edgesTotal: 0, nodesTruncated: false, edgesTruncated: false }
}

/** The tree's nesting law (U3): every symbol group renders EXACTLY ONCE per
 *  side (a second render would double-count usages, §13.2), hung under the
 *  group's placement parent. The placement parent is the parent of the
 *  group's shallowest row — tie-break prefers root, then the lexicographic
 *  (parentName, rowId) — and is always honest: caller-side rows can target
 *  root's class/members via the engine cascade (depth-0, unrendered: fold
 *  to the root level, the engine treats cascade(root) as root) while every
 *  depth-≥1 traced symbol is itself a rendered group (the walk only recurses
 *  into sources of pushed edges). A renderer that nests under a symbol that
 *  is not the row's declared parent fabricates a level (AH7-negative). */
interface TreeSide {
  dir: "caller" | "callee"
  groups: GroupedHubEntry[]
  byId: Map<string, GroupedHubEntry>
}

/** Concrete placement parent for RENDERING (M55): the row type keeps
 *  `parentSymbolId`/`parentName` optional so hand-built LIST fixtures stay
 *  valid, but the tree's nesting law (U3) requires them for every depth-≥1
 *  row. A depth-≥1 row without them is a declared error — never an
 *  `undefined` that silently becomes the key "undefined" and nests a group
 *  under a phantom parent. Depth-0 rows fold to the root level (the engine
 *  treats cascade(root) as root — declared, not guessed). */
function placementParentOf(entry: GroupedHubEntry, rootId: string): { symbolId: string; name: string } {
  const row = placementOf(entry, rootId)
  if (row.depth === 0) {
    return { symbolId: row.parentSymbolId ?? rootId, name: row.parentName ?? "" }
  }
  if (row.parentSymbolId === undefined || row.parentName === undefined) {
    throw new Error(
      `bb/graph: tree placement is missing the parent fields on a depth-${row.depth} row (${entry.name}) — the index emitted a row the tree cannot nest honestly (declared error)`,
    )
  }
  return { symbolId: row.parentSymbolId, name: row.parentName }
}

function sideGroups(grouped: GroupedHub, dir: "caller" | "callee"): TreeSide {
  const groups = dir === "caller" ? grouped.callers : grouped.callees
  const byId = new Map<string, GroupedHubEntry>()
  for (const g of groups) byId.set(g.symbolId, g)
  return { dir, groups, byId }
}

/** Placement parent of a group: the parent id of the shallowest row
 *  (preferring a root-id row among equals), else declared lexicographic
 *  (parentName, rowId) — the SAME selection every run must make. */
function placementOf(entry: GroupedHubEntry, rootId: string): GroupedHubRow {
  if (entry.rows.length === 0) throw new Error("bb/graph: tree placement on an empty group — a group without rows cannot nest")
  let best = entry.rows[0]!
  for (const r of entry.rows) {
    // The parent fields are optional at the TYPE level (hand-built list
    // fixtures). The tie-break needs a total order, so an absent name sorts
    // as "" — and placementParentOf below is what refuses to render a depth
    // ≥ 1 row without them (a declared error, never a phantom parent key).
    const rank = (x: GroupedHubRow): [number, number, string, string] => [
      x.depth,
      x.parentSymbolId === rootId ? 0 : 1,
      x.parentName ?? "",
      x.rowId,
    ]
    const a = rank(r)
    const b = rank(best)
    if (a[0] !== b[0]) best = a[0] < b[0] ? r : best
    else if (a[1] !== b[1]) best = a[1] < b[1] ? r : best
    else if (a[2] !== b[2]) best = a[2] < b[2] ? r : best
    else if (a[3] !== b[3]) best = a[3] < b[3] ? r : best
  }
  return best
}

/** Emit one nested tree branch (callers or callees). Root symbol id anchors
 *  the top level; children of a group are the groups whose placement parent
 *  is that group's symbol. Children beyond the first level start collapsed
 *  (declared data-expanded=0 + bb-hub-collapsed) and every parent carries an
 *  expander control — expansion is the client's toggle, never a re-render. */
function treeSideInto(
  side: TreeSide,
  rootId: string,
  host: GraphDomElement,
  dom: GraphDom,
  anchorKids: Map<string, GroupedHubEntry[]>,
  rowsRendered: { count: number },
): void {
  const header = dom.create("div")
  header.addClass("bb-hub-subtree")
  header.setAttribute("data-dir", side.dir)
  header.setAttribute("data-group-count", String(side.groups.length))
  const label = dom.create("span")
  label.addClass("bb-hub-subtree-label")
  label.textContent = `${side.dir === "caller" ? "callers" : "callees"} (${side.groups.length})`
  header.appendChild(label)
  host.appendChild(header)

  const emit = (entry: GroupedHubEntry, level: number, parentEl: GraphDomElement): void => {
    rowsRendered.count += 1
    const p = placementParentOf(entry, rootId)
    const folded = p.symbolId !== rootId && !side.byId.has(p.symbolId)
    const row = treeRow(entry, side.dir, level, p.symbolId, p.name, folded, dom)
    parentEl.appendChild(row)
    const kids = anchorKids.get(entry.symbolId)
    if (kids && kids.length > 0) {
      row.setAttribute("data-has-children", "1")
      row.setAttribute("data-expanded", "0")
      const expander = dom.create("span")
      expander.addClass("bb-hub-expander")
      expander.setAttribute("data-action", "bb-expand")
      expander.setAttribute("role", "button")
      expander.setAttribute("aria-expanded", "false")
      expander.setAttribute("tabindex", "0")
      expander.textContent = "▸"
      row.appendChild(expander)
      const wrap = dom.create("div")
      wrap.addClass("bb-hub-children")
      // Collapsed-by-default beyond the first level (acceptance: declared
      // expansion, never hidden data).
      if (level >= 1) wrap.addClass("bb-hub-collapsed")
      row.appendChild(wrap)
      const ordered = [...kids].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name) || a.symbolId.localeCompare(b.symbolId))
      for (const kid of ordered) emit(kid, level + 1, wrap)
    }
  }

  // Top level: every group whose placement parent is root (or an unrendered
  // depth-0 cascade target — folded to root, declared) emits here. Deeper
  // groups emit through their parent's recursion, so every group renders
  // exactly once per side.
  for (const g of side.groups) {
    const p = placementParentOf(g, rootId)
    if (p.symbolId === rootId || !side.byId.has(p.symbolId)) emit(g, 0, header)
  }
}

/** Tree row anatomy: name-first like the list row (U2), plus the declared
 *  tree attrs — data-parent-id/data-parent-name (the true edge endpoint),
 *  data-depth (min stored row depth) and data-level (visual nesting depth,
 *  root children = 0). Clicking navigates via the same H6 machine attrs as
 *  the list; the expander is a separate control (never a navigation target). */
function treeRow(
  entry: GroupedHubEntry,
  dir: "caller" | "callee",
  level: number,
  parentId: string,
  parentName: string,
  folded: boolean,
  dom: GraphDom,
): GraphDomElement {
  const el = dom.create("div")
  el.addClass("bb-hub-row")
  el.addClass("bb-hub-symrow")
  el.addClass("bb-hub-tree-node")
  el.setAttribute("data-dir", dir)
  el.setAttribute("data-level", String(level))
  el.setAttribute("data-symbol-id", entry.symbolId)
  el.setAttribute("data-row-ids", entry.rows.map((r) => r.rowId).join(" "))
  el.setAttribute("data-occurrences", String(entry.occurrences))
  // The true tree edge: this node hangs under its placement parent (a
  // rendered same-side node, or the root). A cascade fold declares the
  // unrendered parent id/name — the fold is root-level because the engine
  // treats cascade(root) as root, and the attrs never lie about the stored
  // edge endpoint.
  el.setAttribute("data-parent-id", parentId)
  el.setAttribute("data-parent-name", parentName)
  if (folded) el.setAttribute("data-fold", "cascade")
  const minDepth = entry.rows.length > 0 ? Math.min(...entry.rows.map((r) => r.depth)) : 0
  el.setAttribute("data-depth", String(minDepth))
  // M62.A2: same declared address kinds as the list view.
  el.setAttribute("data-callsite-kinds", callSiteKindsOfEntry(entry))
  const navigable = entry.file.length > 0
  if (navigable) el.setAttribute("data-file", entry.file)
  el.setAttribute("data-line", String(entry.line))
  el.setAttribute("data-symbol", entry.name)
  el.setAttribute("data-clickable", navigable ? "1" : "0")
  if (navigable) el.setAttribute("tabindex", "0")
  else el.addClass("bb-hub-row-unclickable")
  if (entry.isExternal) el.addClass("bb-hub-row-external")
  const main = dom.create("span")
  main.addClass("bb-hub-row-main")
  const name = dom.create("span")
  name.addClass("bb-hub-row-name")
  name.textContent = entry.name
  const meta = dom.create("span")
  meta.addClass("bb-hub-row-meta")
  meta.textContent = entry.file.length > 0 ? `${entry.file}:${entry.line}` : "(external)"
  main.appendChild(name)
  main.appendChild(meta)
  el.appendChild(main)
  relChips(entry, el, dom)
  groupEnrichment(entry, el, dom)
  const chevron = dom.create("span")
  chevron.addClass("bb-hub-chevron")
  chevron.setAttribute("aria-hidden", "true")
  chevron.textContent = navigable ? "›" : "·"
  el.appendChild(chevron)
  return el
}

/** Tree view (U3): a real expandable tree. Each side is its own branch under
 *  the root symbol; nesting follows the placement law above; every row
 *  renders exactly once inside its symbol's node. */
export function renderHubTree(grouped: GroupedHub, dom: GraphDom): RenderStats {
  const section = hubSection(grouped, dom, "bb-hub-tree")
  // M55.T1: the same declared-substitution label as the list and impact
  // surfaces — the tree is not allowed to quietly drop it.
  appendResolutionNote(section, dom, grouped as { resolution?: { through?: string; memberName?: string; ownerName?: string } }, (member, owner) =>
    `"${member}" has no graph of its own — showing the usages of its owning declaration ${owner}`,
  )
  const all = allEntries(grouped)
  if (all.length === 0) {
    hubEmpty(section, dom)
    return { nodesRendered: 0, nodesTotal: 0, edgesRendered: 0, edgesTotal: 0, nodesTruncated: false, edgesTruncated: false }
  }
  section.setAttribute("data-root-symbol", grouped.root.symbolId)
  const callers = sideGroups(grouped, "caller")
  const callees = sideGroups(grouped, "callee")
  // Anchor map per side: group G (side S) hangs under its placement parent
  // when that parent is a rendered group on the SAME side; otherwise G is a
  // top-level child of the root (its parent is root or an unrendered depth-0
  // cascade target — fold declared, never fabricated). One group has exactly
  // one placement parent, so the child relation is a function — a strict
  // tree, never a DAG (a second render would double-count usages, §13.2).
  const callerKids = new Map<string, GroupedHubEntry[]>()
  const calleeKids = new Map<string, GroupedHubEntry[]>()
  for (const side of [callers, callees]) {
    const map = side.dir === "caller" ? callerKids : calleeKids
    for (const g of side.groups) {
      const p = placementParentOf(g, grouped.root.symbolId)
      if (p.symbolId !== grouped.root.symbolId && side.byId.has(p.symbolId)) {
        if (!map.has(p.symbolId)) map.set(p.symbolId, [])
        map.get(p.symbolId)!.push(g)
      }
    }
  }
  const rowsRendered = { count: 0 }
  treeSideInto(callers, grouped.root.symbolId, section, dom, callerKids, rowsRendered)
  treeSideInto(callees, grouped.root.symbolId, section, dom, calleeKids, rowsRendered)
  // U4: the ONE badge legend ships with the tree too — same core function as
  // graphs, hub list, and impact (single legend law, §13.9).
  section.appendChild(renderLegend(dom))
  const total = grouped.counts.callerGroups + grouped.counts.calleeGroups
  return { nodesRendered: rowsRendered.count, nodesTotal: total, edgesRendered: 0, edgesTotal: 0, nodesTruncated: grouped.summary.truncated, edgesTruncated: grouped.summary.truncated }
}
