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
// --- M42.H5 (issue #653) / M44.U1 (issue #688): hub laws over GROUPED rows -
// The hub renders ONE row per caller/callee SYMBOL group (server-grouped by
// M44.U1) carrying its full stored-row inventory (data-row-ids), per-type
// occurrence chips with the SAME tier resolution as edges, enrichment
// presence labeling, declared truncation, and enforced empty honesty. A hub
// renderer that lies — fabricates a symbol row, drops a row id from a
// group's inventory, repeats a symbol, miscounts a type chip, misgroups,
// hides truncation — FAILS these assertions.

export interface HubHarnessRow {
  /** The symbol group's identity (one rendered row per symbol). */
  symbolId: string
  dir: "caller" | "callee"
  name: string
  /** "" = external. */
  file: string
  line: number
  /** Full stored-row inventory — nothing dropped (L3 differential). */
  rowIds: string[]
  /** Per relationship-type chips: type + occurrence count + tier resolution
   *  of that type's rows ("mixed" when the type's rows disagree). */
  types: Array<{ type: string; occurrences: number; tier: string }>
  /** Presence-gated: any stored row enriched => the row renders the
   *  annotation; none enriched => none renders. */
  enriched: boolean
}

export interface HubHarnessModel {
  rows: HubHarnessRow[]
  truncated: boolean
  shownCount?: number
  /** null => the honest "unknown" total (never a fabricated number). */
  totalIfKnown?: number | null
}

function symbolKey(r: HubHarnessRow): string {
  return `${r.symbolId}:${r.dir}`
}

export interface HubChipCollected {
  type: string
  occurrences: number
  tier: string
}

export interface HubRowCollected {
  key: string
  rowIds: string[]
  occurrences: number
  chips: HubChipCollected[]
  enriched: boolean
  groupName: string | null
  node: HarnessNode
}

function collectHub(doc: HarnessNode, sectionClass: string, group?: string): { section: HarnessNode | null; rows: HubRowCollected[] } {
  const sections = findAll(doc, sectionClass)
  const section = group === undefined ? sections[0] ?? null : sections.find((s) => s.attrs["data-group"] === group) ?? null
  if (section === null) return { section: null, rows: [] }
  const rows: HubRowCollected[] = []
  for (const row of findAll(section, "bb-hub-row")) {
    const dir = row.attrs["data-dir"] ?? ""
    const symbolId = row.attrs["data-symbol-id"] ?? ""
    const key = `${symbolId}:${dir}`
    const rowIds = (row.attrs["data-row-ids"] ?? "").split(" ").filter(Boolean)
    const occurrences = Number(row.attrs["data-occurrences"] ?? -1)
    const chips: HubChipCollected[] = findAll(row, "bb-hub-relchip").map((c) => ({
      type: c.attrs["data-rel-type"] ?? "",
      occurrences: Number(c.attrs["data-occurrences"] ?? -1),
      tier: c.attrs["data-tier"] ?? "",
    }))
    const enriched = row.attrs["data-enriched"] === "1" && find(row, "bb-hub-enrichment") !== null
    const parent = section.children.find((c) => c.children.includes(row) && c.className.split(" ").includes("bb-hub-group"))
    rows.push({ key, rowIds, occurrences, chips, enriched, groupName: parent ? parent.attrs["data-group-name"] ?? null : null, node: row })
  }
  return { section, rows }
}

function modelInventory(model: HubHarnessModel): { byKey: Map<string, HubHarnessRow>; allRowIds: Set<string> } {
  const byKey = new Map<string, HubHarnessRow>()
  const allRowIds = new Set<string>()
  for (const r of model.rows) {
    byKey.set(symbolKey(r), r)
    for (const id of r.rowIds) allRowIds.add(id)
  }
  return { byKey, allRowIds }
}

/** AH1: rendered symbol rows == model symbol rows (no fabricated, no
 *  repeated, no dropped when complete); the union of every row's stored-row
 *  inventory equals the model inventory (L3: nothing dropped, nothing
 *  invented); drops allowed only under declared truncation with real counts. */
export function assertHubRows(doc: HarnessNode, model: HubHarnessModel, sectionClass: string, group?: string): Finding {
  const { section, rows } = collectHub(doc, sectionClass, group)
  if (section === null) return { assertion: `AH1 rows == model (${sectionClass})`, ok: false, detail: "section missing" }
  const { byKey, allRowIds } = modelInventory(model)
  const renderedKeys = rows.map((r) => r.key)
  const missing = [...byKey.keys()].filter((k) => !renderedKeys.includes(k))
  const extra = renderedKeys.filter((k, i) => renderedKeys.indexOf(k) === i && !byKey.has(k))
  const dupes = renderedKeys.filter((k, i) => renderedKeys.indexOf(k) !== i)
  if (!model.truncated) {
    const ok = missing.length === 0 && extra.length === 0 && dupes.length === 0
    if (!ok) return { assertion: `AH1 rows == model usages (${sectionClass})`, ok, detail: `missing=[${missing}] extra=[${extra}] dupes=[${dupes}]` }
    const renderedIds = new Set<string>()
    for (const r of rows) for (const id of r.rowIds) renderedIds.add(id)
    const dropped = [...allRowIds].filter((id) => !renderedIds.has(id))
    const invented = [...renderedIds].filter((id) => !allRowIds.has(id))
    const okInv = dropped.length === 0 && invented.length === 0
    return { assertion: `AH1 row inventory == model (${sectionClass})`, ok: okInv, detail: okInv ? `rows=${rows.length} rowIds=${renderedIds.size}` : `dropped=[${dropped}] invented=[${invented}]` }
  }
  // Declared truncation: rendered rows are a subset with a real marker whose
  // data-shown equals the rendered count.
  const shown = renderedKeys.length
  const marker = find(doc, "bb-truncation-marker")
  const declaredShown = marker ? Number(marker.attrs["data-shown"] ?? -1) : -1
  const ok = extra.length === 0 && dupes.length === 0 && marker !== null && declaredShown === shown && shown < byKey.size
  return { assertion: `AH1 truncated subset declared (${sectionClass})`, ok, detail: `shown=${shown} markerShown=${declaredShown} expected=${byKey.size}` }
}

/** AH2 grouping integrity: every row sits under a group whose data-group-name
 *  equals the row's file (mode file) or symbol name (mode caller); every row
 *  is in exactly one group. */
export function assertHubGrouping(doc: HarnessNode, model: HubHarnessModel, group: "file" | "caller"): Finding {
  const { section, rows } = collectHub(doc, "bb-hub-list", group)
  if (section === null) return { assertion: `AH2 grouping by ${group}`, ok: false, detail: "section missing" }
  const groups = findAll(section, "bb-hub-group")
  const problems: string[] = []
  for (const g of groups) {
    const key = g.attrs["data-group-name"] ?? ""
    for (const row of findAll(g, "bb-hub-row")) {
      const file = row.attrs["data-file"] ?? ""
      const name = row.attrs["data-symbol"] ?? ""
      const expectKey = group === "file" ? (file.length > 0 ? file : "(external)") : (name.length > 0 ? name : "(external)")
      if (expectKey !== key) problems.push(`row ${row.attrs["data-symbol-id"]} in group "${key}" but its ${group} is "${expectKey}"`)
    }
  }
  const ungrouped = findAll(section, "bb-hub-row").filter((r) => !groups.some((g) => g.children.includes(r)))
  if (ungrouped.length > 0) problems.push(`${ungrouped.length} rows outside any group`)
  if (rows.length === 0 && !model.truncated) problems.push("no rows rendered for a non-empty model")
  return { assertion: `AH2 grouping by ${group}`, ok: problems.length === 0, detail: problems.join("; ") }
}

/** AH3 chips: every rendered symbol row carries a per-type chip for EVERY
 *  model type of that symbol with the model's occurrence count and tier —
 *  a dropped type, a miscounted type, or a chip whose tier disagrees with
 *  the model FAILS (the W4 tier law, grouped flavor). */
export function assertHubBadges(doc: HarnessNode, model: HubHarnessModel, sectionClass: string, group?: string): Finding {
  const { byKey } = modelInventory(model)
  const { rows } = collectHub(doc, sectionClass, group)
  const problems: string[] = []
  for (const r of rows) {
    const expect = byKey.get(r.key)
    if (expect === undefined) continue // fabricated rows are AH1's finding
    for (const t of expect.types) {
      const chip = r.chips.find((c) => c.type === t.type)
      if (chip === undefined) problems.push(`symbol ${expect.symbolId} missing chip for type ${t.type}`)
      else if (chip.occurrences !== t.occurrences) problems.push(`symbol ${expect.symbolId} chip ${t.type} occurrences=${chip.occurrences} expected=${t.occurrences}`)
      else if (chip.tier !== t.tier) problems.push(`symbol ${expect.symbolId} chip ${t.type} tier=${chip.tier} expected=${t.tier}`)
    }
    for (const chip of r.chips) {
      if (expect.types.find((t) => t.type === chip.type) === undefined) problems.push(`symbol ${expect.symbolId} renders chip for unknown type ${chip.type}`)
    }
    if (r.chips.length === 0) problems.push(`symbol ${expect.symbolId} has NO type chips`)
  }
  return { assertion: `AH3 hub type chips == model (${sectionClass})`, ok: problems.length === 0, detail: problems.join("; ") }
}

/** AH4 enrichment: enriched model rows render data-enriched + chip; others
 *  render none. */
export function assertHubEnrichment(doc: HarnessNode, model: HubHarnessModel, sectionClass: string, group?: string): Finding {
  const { byKey } = modelInventory(model)
  const { rows } = collectHub(doc, sectionClass, group)
  const problems: string[] = []
  for (const r of rows) {
    const expect = byKey.get(r.key)
    if (expect === undefined) continue
    if (expect.enriched && !r.enriched) problems.push(`symbol ${expect.symbolId}: enriched in model but rendered without the enrichment annotation`)
    if (!expect.enriched && r.enriched) problems.push(`symbol ${expect.symbolId}: un-enriched in model but rendered with an enrichment annotation`)
  }
  return { assertion: `AH4 enrichment labeled per model (${sectionClass})`, ok: problems.length === 0, detail: problems.join("; ") }
}

/** AH5 truncation + empty honesty: complete non-empty -> NO marker; truncated
 *  -> marker with declared shown (total "unknown" when the model cannot know
 *  it — never a fabricated number); empty model -> declared bb-hub-empty. */
export function assertHubTruncationEmpty(doc: HarnessNode, model: HubHarnessModel, sectionClass: string, group?: string): Finding {
  const { section } = collectHub(doc, sectionClass, group)
  if (section === null) return { assertion: `AH5 truncation/empty (${sectionClass})`, ok: false, detail: "section missing" }
  const marker = find(section, "bb-truncation-marker")
  const empty = find(section, "bb-hub-empty")
  const expectEmpty = model.rows.length === 0 && !model.truncated
  if (expectEmpty) {
    const ok = empty !== null && marker === null && findAll(section, "bb-hub-row").length === 0
    return { assertion: `AH5 empty honesty (${sectionClass})`, ok, detail: ok ? "declared empty" : `empty=${empty !== null} marker=${marker !== null}` }
  }
  if (model.truncated) {
    const shownOk = marker !== null && marker.attrs["data-truncated"] === "hub" && marker.attrs["data-shown"] === String(model.shownCount)
    if (model.totalIfKnown === null || model.totalIfKnown === undefined) {
      const ok = shownOk && marker.attrs["data-total-if-known"] === "unknown"
      return { assertion: `AH5 truncation declared (${sectionClass})`, ok, detail: ok ? "declared (total unknown)" : `marker=${marker !== null}` }
    }
    const ok = shownOk && marker.attrs["data-total-if-known"] === String(model.totalIfKnown)
    return { assertion: `AH5 truncation declared (${sectionClass})`, ok, detail: ok ? "declared" : `marker=${marker !== null}` }
  }
  const ok = marker === null && empty === null
  return { assertion: `AH5 complete renders no marker (${sectionClass})`, ok, detail: ok ? "clean" : "phantom marker or empty on a complete set" }
}

/** Run the full hub assertion set over one section. */
export function runHubHarness(
  model: HubHarnessModel,
  doc: HarnessNode,
  opts: { sectionClass: string; group?: string; assertGrouping?: boolean },
): Finding[] {
  const findings: Finding[] = []
  findings.push(assertHubRows(doc, model, opts.sectionClass, opts.group))
  findings.push(assertHubBadges(doc, model, opts.sectionClass, opts.group))
  findings.push(assertHubEnrichment(doc, model, opts.sectionClass, opts.group))
  findings.push(assertHubTruncationEmpty(doc, model, opts.sectionClass, opts.group))
  if (opts.assertGrouping && opts.group !== undefined) {
    findings.push(assertHubGrouping(doc, model, opts.group))
  }
  return findings
}
