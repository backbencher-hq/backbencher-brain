// script/m26/webview-harness.ts — M26.V1: the ONE headless render harness
// (issue #514).
//
// DOM-level assertions over a rendered graph document, checked against the
// MODEL and the declared renderer laws (W1/W4/W6) — independent of which
// renderer produced the DOM. The real core passes; a renderer that lies
// (fabricates an edge, drops an edge, mislabels a tier, miscounts a
// truncation marker, hides truncation) FAILS. Contract §6 UI mutation gates.
//
// One-library rule: every M26 leg (and later milestones) consumes THIS
// harness; per-leg re-implementations are banned.
//
// Assertions (each returns a finding; empty findings = pass):
//   A1 nodes:        every model node present exactly once; no fabricated nodes
//   A2 edges:        no fabricated edge ever; when the model is complete the
//                    edge set must match exactly (drops caught); when the model
//                    declares truncation, rendered edges must be a declared
//                    subset (shown/total) — row-id traceability preserved
//   A3 badges:       every edge carries a badge whose tier+confidence agree
//                    with the edge's data-tier (W4 law)
//   A4 truncation:   truncated == marker present with real counts;
//                    complete == NO marker (both directions)
//   A5 legend:       five-tier legend present and complete (W4 law)
//   A6 escaping:     repo-controlled strings appear only escaped (W6 law)
//   A7 determinism:  two renders of the same model are byte-identical (W1 law)
//
// Run: imported by script/m26/verify-webview-harness.ts

export interface HarnessNode {
  tag: string
  className: string
  attrs: Record<string, string>
  textContent: string
  children: HarnessNode[]
}

export interface HarnessModelNode {
  id: string
  name: string
}

export interface HarnessModelEdge {
  from: string
  to: string
  relationshipType: string
  confidence: number
  rowId?: string
  expectedTier: string
}

export interface HarnessModel {
  nodes: HarnessModelNode[]
  edges: HarnessModelEdge[]
  truncated: boolean
  shownCount?: number
  totalCountIfKnown?: number | null
}

export interface Finding {
  assertion: string
  ok: boolean
  detail: string
}

function walk(node: HarnessNode, visit: (n: HarnessNode) => void): void {
  visit(node)
  for (const c of node.children) walk(c, visit)
}

function find(node: HarnessNode, className: string): HarnessNode | null {
  let hit: HarnessNode | null = null
  walk(node, (n) => {
    if (!hit && n.className.split(" ").includes(className)) hit = n
  })
  return hit
}

function findAll(node: HarnessNode, className: string): HarnessNode[] {
  const out: HarnessNode[] = []
  walk(node, (n) => {
    if (n.className.split(" ").includes(className)) out.push(n)
  })
  return out
}

export function serializeHarnessNode(node: HarnessNode): string {
  const attrs = Object.entries(node.attrs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${v}"`).join(" ")
  const cls = node.className ? ` class="${node.className}"` : ""
  const open = `<${node.tag}${cls}${attrs ? " " + attrs : ""}`
  if (!node.children.length) return node.textContent ? `${open}>${node.textContent}</${node.tag}>` : `${open}></${node.tag}>`
  return `${open}>${node.children.map(serializeHarnessNode).join("")}</${node.tag}>`
}

/** A1: model nodes each present exactly once; nothing fabricated. */
export function assertNodes(doc: HarnessNode, model: HarnessModel): Finding {
  const rendered = findAll(doc, "bb-node").map((n) => n.attrs["data-id"] ?? "")
  const modelIds = model.nodes.map((n) => n.id)
  const missing = modelIds.filter((id) => !rendered.includes(id))
  const extra = rendered.filter((id) => !modelIds.includes(id))
  const dupes = rendered.filter((id, i) => rendered.indexOf(id) !== i)
  const ok = missing.length === 0 && extra.length === 0 && dupes.length === 0
  return { assertion: "A1 nodes == model nodes", ok, detail: `missing=[${missing}] extra=[${extra}] dupes=[${dupes}]` }
}

/** A2: no fabricated edge ever; drops only when the model declares
 *  truncation (rendered edges must then be a subset with declared counts).
 *  Multiset comparison via a counter map — O(n), duplicate-tolerant. */
export function assertEdges(doc: HarnessNode, model: HarnessModel): Finding {
  const rendered = findAll(doc, "bb-edge").map((e) => `${e.attrs["data-from"]}->${e.attrs["data-to"]}:${e.attrs["data-tier"]}:${e.attrs["data-row-id"] ?? "-"}`)
  const expected = model.edges.map((e) => `${e.from}->${e.to}:${e.expectedTier}:${e.rowId ?? "-"}`)
  const counts = new Map<string, number>()
  for (const k of expected) counts.set(k, (counts.get(k) ?? 0) + 1)
  const fabricated: string[] = []
  for (const a of rendered) {
    const c = counts.get(a) ?? 0
    if (c > 0) counts.set(a, c - 1)
    else fabricated.push(a)
  }
  const dropped: string[] = []
  for (const [k, c] of counts) for (let i = 0; i < c; i++) dropped.push(k)
  let ok = fabricated.length === 0
  if (ok && !model.truncated) ok = dropped.length === 0
  if (ok && model.truncated && model.shownCount !== undefined) ok = rendered.length === model.shownCount
  return {
    assertion: "A2 edges == model edges (no fabricated; drops only when declared)",
    ok,
    detail: `fabricated=[${fabricated.slice(0, 5)}] dropped=${dropped.length}${model.truncated ? ` (declared: shown=${model.shownCount})` : ""}`,
  }
}

/** A3: badge per edge, tier+confidence agreeing with the edge (W4). */
export function assertBadges(doc: HarnessNode, _model: HarnessModel): Finding {
  const edges = findAll(doc, "bb-edge")
  const bad: string[] = []
  for (const edge of edges) {
    const badges = edge.children.filter((c) => c.className.split(" ").includes("bb-edge-badge"))
    const badge = badges[0]
    if (badges.length !== 1 || !badge) {
      bad.push(`${edge.attrs["data-from"]}->${edge.attrs["data-to"]}:badge-count=${badges.length}`)
      continue
    }
    if (badge.attrs["data-badge-tier"] !== edge.attrs["data-tier"] || badge.attrs["data-badge-confidence"] !== edge.attrs["data-confidence"]) {
      bad.push(`${edge.attrs["data-from"]}->${edge.attrs["data-to"]}:badge=${badge.attrs["data-badge-tier"]}/${badge.attrs["data-badge-confidence"]} edge=${edge.attrs["data-tier"]}/${edge.attrs["data-confidence"]}`)
    }
  }
  return { assertion: "A3 every edge badge agrees with its edge", ok: bad.length === 0, detail: bad.join("; ") }
}

/** A4: truncation truthfulness in BOTH directions. */
export function assertTruncation(doc: HarnessNode, model: HarnessModel): Finding {
  const marker = find(doc, "bb-truncation-marker")
  if (model.truncated) {
    if (!marker) return { assertion: "A4 truncation declared", ok: false, detail: "truncated model rendered without a marker" }
    const shown = marker.attrs["data-shown"] ?? marker.textContent.match(/Showing (\d+)/)?.[1] ?? ""
    const total = marker.attrs["data-total-if-known"] ?? ""
    const countsReal =
      model.shownCount === undefined || shown === String(model.shownCount) || marker.textContent.includes(`Showing ${model.shownCount}`)
    const totalReal = model.totalCountIfKnown === undefined || model.totalCountIfKnown === null || total === String(model.totalCountIfKnown) || total === "unknown" || marker.textContent.includes("unknown")
    return { assertion: "A4 truncation declared", ok: countsReal && totalReal, detail: `shown=${shown} total=${total}` }
  }
  return { assertion: "A4 complete set renders no marker", ok: marker === null, detail: marker ? "phantom truncation marker on a complete set" : "clean" }
}

/** A5: the five-tier legend ships and is complete (W4). */
export function assertLegend(doc: HarnessNode, expectedTiers: readonly string[]): Finding {
  const legend = find(doc, "bb-legend")
  if (!legend) return { assertion: "A5 legend present", ok: false, detail: "no legend in the document" }
  const tiers = findAll(legend, "bb-legend-swatch").map((s) => s.attrs["data-legend-tier"] ?? "")
  const missing = expectedTiers.filter((t) => !tiers.includes(t))
  return { assertion: "A5 legend lists all tiers", ok: missing.length === 0, detail: `missing=[${missing}]` }
}

/** A6: repo-controlled strings appear only escaped (W6 law). The harness
 *  checks that NO rendered text node contains a raw payload from the model's
 *  hostile-name list. */
export function assertEscaped(doc: HarnessNode, hostilePayloads: string[]): Finding {
  const leaks: string[] = []
  walk(doc, (n) => {
    for (const payload of hostilePayloads) {
      if (payload !== "" && (n.textContent.includes(payload) || JSON.stringify(n.attrs).includes(payload))) {
        leaks.push(payload)
      }
    }
  })
  return { assertion: "A6 hostile payloads render escaped only", ok: leaks.length === 0, detail: `leaks=[${[...new Set(leaks)]}]` }
}

/** A7: byte-identical determinism (W1 law). */
export function assertDeterministic(render: () => HarnessNode): Finding {
  const a = serializeHarnessNode(render())
  const b = serializeHarnessNode(render())
  return { assertion: "A7 same model renders byte-identical twice", ok: a === b, detail: a === b ? "identical" : "DOM differs between renders" }
}

/** Run the full assertion set. */
export function runHarness(model: HarnessModel, doc: HarnessNode, opts: { render?: () => HarnessNode; hostilePayloads?: string[]; expectedTiers: readonly string[] }): Finding[] {
  const findings = [
    assertNodes(doc, model),
    assertEdges(doc, model),
    assertBadges(doc, model),
    assertTruncation(doc, model),
    assertLegend(doc, opts.expectedTiers),
    assertEscaped(doc, opts.hostilePayloads ?? []),
  ]
  if (opts.render) findings.push(assertDeterministic(opts.render))
  return findings
}
