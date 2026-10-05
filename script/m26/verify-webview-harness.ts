// script/m26/verify-webview-harness.ts — M26.V1 verifier + mutation suite.
//
// Proves the ONE harness (script/m26/webview-harness.ts) catches lying
// renderers, and that the REAL core passes it clean.
//
//   P1 positive:     the real W1 core renders the fixture model — every
//                    harness assertion passes (A1–A7)
//   P2 negative:     hand-built LYING documents (fabricated edge, dropped
//                    edge, wrong tier label, wrong count, missing truncation
//                    marker) each FAIL the corresponding assertion — the
//                    harness can fail, both directions proven
//   M1–M5:           the issue's five mutants planted in the REAL core
//                    (fabricated edge, dropped edge, wrong tier label, wrong
//                    count, missing truncation marker) — each caught
//   P3 budget:       harness run over the pinned 500/2000 fixture within the
//                    contract §3 render budget (headless regime)
//   P4 wiring:       the harness is wired into verify (this verifier runs in
//                    the M26 gate chain; asserted via the ledger in G1)
//
// Run: npx tsx script/m26/verify-webview-harness.ts
// Evidence: validation/m26/results/V1.json (machine-emitted)

import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CORE = join(ROOT, "script", "m26", "graph-core.ts")
const HARNESS = join(ROOT, "script", "m26", "webview-harness.ts")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

// --- DOM stub shared with the W1 suite (the harness consumes its output) ------
class El {
  tagName: string
  className = ""
  children: El[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  constructor(tag: string) {
    this.tagName = tag
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
  }
  appendChild(child: El): El {
    this.children.push(child)
    return child
  }
  addClass(name: string): void {
    this.className = this.className ? `${this.className} ${name}` : name
  }
}

function fixtureModel(edgeCount = 3) {
  const mk = (id: string, name: string) => ({ id, name, symbolType: "function", file: `${name}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false })
  const root = mk("sym:root", "root")
  const callers = Array.from({ length: edgeCount }, (_, i) => mk(`sym:c${i}`, `caller${i}`))
  const nodes: Record<string, any> = { "sym:root": root }
  callers.forEach((c) => (nodes[c.id] = c))
  return {
    root,
    callers: callers.map((c, i) => ({
      from: c.id,
      to: root.id,
      relationshipType: "calls",
      confidence: i === 0 ? 0.4 : 0.9, // first edge sub-floor → inferred
      isCrossLanguage: false,
      callSite: { kind: "call-site", file: c.file, line: 1 },
      depth: 0,
      rowId: `rel-${i}`,
    })),
    callees: [],
    nodes,
    summary: { totalCallers: edgeCount, totalCallees: 0, truncated: false, crossLanguageEdges: 0 },
  }
}

async function main(): Promise<void> {
  const core = await import(CORE)
  const H = await import(HARNESS)

  // --- P1: the real core passes the harness clean ---------------------------
  const model = fixtureModel(3)
  // Shared root: root() must return the SAME element renderGraph populated
  // (W1 lesson — a fresh root per call discards the render).
  const renderOnce = (): any => {
    const r = new El("div")
    const d = { create: (t: string) => new El(t), root: () => r }
    core.renderGraph(model as never, d as never)
    return r
  }
  const doc = renderOnce()
  const toHarness = (el: any): any => ({
    tag: el.tagName,
    className: el.className,
    attrs: el.attrs,
    textContent: el.textContent,
    children: el.children.map(toHarness),
  })
  const harnessModel = {
    nodes: [{ id: "sym:root", name: "root" }, { id: "sym:c0", name: "caller0" }, { id: "sym:c1", name: "caller1" }, { id: "sym:c2", name: "caller2" }],
    edges: model.callers.map((e) => ({ from: e.from, to: e.to, relationshipType: e.relationshipType, confidence: e.confidence, rowId: e.rowId, expectedTier: e.confidence >= 0.7 ? "structural" : "inferred" })),
    truncated: false,
  }
  const findings = H.runHarness(harnessModel, toHarness(doc), {
    render: () => toHarness(renderOnce()),
    hostilePayloads: ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>'],
    expectedTiers: core.EDGE_TIERS as readonly string[],
  })
  for (const f of findings) check(`P1 real core passes — ${f.assertion}`, f.ok, f.detail)

  // --- P2: lying documents FAIL the harness (both directions) -----------------
  // Lying doc builder: shape-compatible with the harness's HarnessNode.
  const el = (tag: string, className: string, attrs: Record<string, string> = {}, text = "", children: any[] = []): any => ({
    tag,
    className,
    attrs,
    textContent: text,
    children,
  })
  const baseDoc = () => {
    const root = el("div", "bb-graph")
    const nodes = el("div", "bb-nodes")
    nodes.children.push(el("div", "bb-node bb-node-root", { "data-id": "sym:root", "data-kind": "function", "data-lang": "typescript" }, "root"))
    for (const id of ["sym:c0", "sym:c1", "sym:c2"]) nodes.children.push(el("div", "bb-node", { "data-id": id }, id))
    const edges = el("div", "bb-edges")
    for (const e of harnessModel.edges) {
      const edge = el("div", `bb-edge bb-edge-${e.expectedTier}`, { "data-from": e.from, "data-to": e.to, "data-tier": e.expectedTier, "data-confidence": String(e.confidence), "data-row-id": e.rowId ?? "" }, `${e.relationshipType} (${e.expectedTier}, ${e.confidence})`)
      edge.children.push(el("span", `bb-edge-badge bb-badge-${e.expectedTier}`, { "data-badge-tier": e.expectedTier, "data-badge-confidence": String(e.confidence) }, `${e.expectedTier} · ${e.confidence}`))
      edges.children.push(edge)
    }
    root.children.push(nodes, edges)
    return root
  }
  const legend = (doc2: any): void => {
    const lg = el("div", "bb-legend", { "data-legend": "edge-evidence-tiers" })
    for (const t of core.EDGE_TIERS as readonly string[]) {
      const item = el("div", `bb-legend-item bb-legend-${t}`)
      item.children.push(el("span", "bb-legend-swatch bb-badge-" + t, { "data-legend-tier": t }))
      item.children.push(el("span", "bb-legend-meaning", {}, `${t}: meaning`))
      lg.children.push(item)
    }
    doc2.children.push(lg)
  }

  // fabricated edge: harness must flag it
  const fabDoc = baseDoc()
  const fabEdge = el("div", "bb-edge bb-edge-structural", { "data-from": "sym:ghost", "data-to": "sym:root", "data-tier": "structural", "data-confidence": "0.9" }, "calls (structural, 0.9)")
  fabEdge.children.push(el("span", "bb-edge-badge bb-badge-structural", { "data-badge-tier": "structural", "data-badge-confidence": "0.9" }, "structural · 0.9"))
  fabDoc.children[1].children.push(fabEdge)
  const fabFindings = H.runHarness(harnessModel, fabDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 fabricated edge — A2 fails", fabFindings.find((f) => f.assertion.startsWith("A2"))?.ok === false)

  // dropped edge: A2 must fail
  const dropDoc = baseDoc()
  dropDoc.children[1].children.pop()
  const dropFindings = H.runHarness(harnessModel, dropDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 dropped edge — A2 fails", dropFindings.find((f) => f.assertion.startsWith("A2"))?.ok === false)

  // wrong tier label: A2 (tier in edge key) and A3 (badge mismatch) fail
  const wrongTierDoc = baseDoc()
  const wtEdge = wrongTierDoc.children[1].children[0]
  wtEdge.className = "bb-edge bb-edge-structural"
  wtEdge.attrs["data-tier"] = "structural"
  wtEdge.children[0].className = "bb-edge-badge bb-badge-inferred"
  wtEdge.children[0].attrs["data-badge-tier"] = "inferred"
  const wtFindings = H.runHarness(harnessModel, wrongTierDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 wrong tier label — A2/A3 fail", wtFindings.find((f) => f.assertion.startsWith("A2"))?.ok === false || wtFindings.find((f) => f.assertion.startsWith("A3"))?.ok === false)

  // wrong count on the truncation marker: A4 must fail
  const wrongCountDoc = baseDoc()
  wrongCountDoc.children.push(el("div", "bb-truncation-marker", { "data-truncated": "edges", "data-shown": "99", "data-total-if-known": "999" }, "Showing 99 of 999 edges (render budget exhausted)"))
  const wcFindings = H.runHarness({ ...harnessModel, truncated: true, shownCount: 3, totalCountIfKnown: 3 }, wrongCountDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 wrong truncation count — A4 fails", wcFindings.find((f) => f.assertion === "A4 truncation declared")?.ok === false)

  // missing truncation marker: A4 must fail
  const noMarkerDoc = baseDoc()
  const nmFindings = H.runHarness({ ...harnessModel, truncated: true, shownCount: 3, totalCountIfKnown: 3 }, noMarkerDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 missing truncation marker — A4 fails", nmFindings.find((f) => f.assertion === "A4 truncation declared")?.ok === false)

  // phantom marker on a complete set: A4 must fail
  const phantomDoc = baseDoc()
  phantomDoc.children.push(el("div", "bb-truncation-marker", { "data-truncated": "edges" }, "Showing 3 of 3 edges"))
  const phFindings = H.runHarness(harnessModel, phantomDoc, { expectedTiers: core.EDGE_TIERS as readonly string[] })
  check("P2 phantom marker on complete set — A4 fails", phFindings.find((f) => f.assertion.startsWith("A4"))?.ok === false)

  // hostile payload leaking raw: A6 must fail
  const leakDoc = baseDoc()
  leakDoc.children[0].children.push(el("div", "bb-node", { "data-id": "sym:x" }, '<script>alert(1)</script>'))
  const leakFindings = H.runHarness(harnessModel, leakDoc, { expectedTiers: core.EDGE_TIERS as readonly string[], hostilePayloads: ["<script>alert(1)</script>"] })
  check("P2 raw hostile payload — A6 fails", leakFindings.find((f) => f.assertion.startsWith("A6"))?.ok === false)

  // --- M1–M5: the issue's five mutants planted in the REAL core ---------------
  // Truncation fixture: 505 unique caller nodes overflow the 500-node render
  // budget by a DECLARED amount (summary.truncated + reason), so the model the
  // harness receives is a declared-truncation profile and the M4/M5 code paths
  // actually execute. Truthful render: 500 nodes shown of 505.
  const truncFixture = fixtureModel(0)
  for (let i = 0; i < 504; i++) truncFixture.nodes[`sym:t${i}`] = { id: `sym:t${i}`, name: `t${i}`, symbolType: "function", file: `t${i}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false }
  truncFixture.callers = Array.from({ length: 504 }, (_, i) => ({ from: `sym:t${i}`, to: "sym:root", relationshipType: "calls", confidence: 0.95, isCrossLanguage: false, callSite: { kind: "call-site", file: "t.ts", line: 1 }, depth: 0, rowId: `rel-t${i}` }))
  truncFixture.summary = { totalCallers: 504, totalCallees: 0, truncated: true, truncationReason: "node-budget-exhausted", crossLanguageEdges: 0 }
  const truncModel = {
    nodes: Object.values(truncFixture.nodes).map((n: any) => ({ id: n.id, name: n.name })),
    edges: truncFixture.callers.map((e: any) => ({ from: e.from, to: e.to, relationshipType: e.relationshipType, confidence: e.confidence, rowId: e.rowId, expectedTier: "structural" })),
    truncated: true,
    shownCount: 500,
    totalCountIfKnown: 505,
  }
  const coreSource = readFileSync(CORE, "utf8")
  const mutants: Array<{ name: string; from: string; to: string; model?: unknown }> = [
    {
      name: "M1 fabricated edge",
      from: "let edgesRendered = 0",
      to: "let edgesRendered = 0\n  {\n    const ghost = dom.create(\"div\")\n    ghost.addClass(\"bb-edge bb-edge-structural\")\n    ghost.setAttribute(\"data-from\", \"sym:ghost\")\n    ghost.setAttribute(\"data-to\", result.root.id)\n    ghost.setAttribute(\"data-tier\", \"structural\")\n    ghost.setAttribute(\"data-confidence\", \"1\")\n    const t = dom.create(\"span\")\n    t.addClass(\"bb-edge-label\")\n    t.textContent = \"calls (structural, 1)\"\n    ghost.appendChild(t)\n    edgesEl.appendChild(ghost)\n  }",
    },
    {
      name: "M2 dropped edge",
      from: "for (const edge of allEdges) {\n    if (edgesRendered >= RENDER_BUDGET.maxEdges) {\n      edgesTruncated = true\n      break\n    }\n    edgesEl.appendChild(edgeElement(edge, edgesRendered, dom))\n    edgesRendered++\n  }",
      to: "for (const edge of allEdges) {\n    if (edgesRendered >= RENDER_BUDGET.maxEdges) {\n      edgesTruncated = true\n      break\n    }\n    if (edgesRendered === 0) {\n      edgesRendered++\n      continue\n    }\n    edgesEl.appendChild(edgeElement(edge, edgesRendered, dom))\n    edgesRendered++\n  }",
    },
    {
      name: "M3 wrong tier label",
      from: 'return edge.confidence >= 0.7 ? "structural" : "inferred"',
      to: 'return "structural"',
    },
    {
      name: "M4 wrong count",
      from: 'el.textContent = `Showing ${shown} of ${total} ${kind} (render budget exhausted — not all data is displayed)`',
      to: 'el.textContent = `Showing ${shown + 1} of ${total + 2} ${kind} (render budget exhausted — not all data is displayed)`',
      model: truncModel,
    },
    {
      name: "M5 missing truncation marker",
      from: 'if (nodesTruncated) layer.appendChild(truncationMarker("nodes", nodesRendered, nodesTotal, dom))',
      to: 'if (false) layer.appendChild(truncationMarker("nodes", nodesRendered, nodesTotal, dom))',
      model: truncModel,
    },
  ]

  let caught = 0
  let mutantsTotal = 0
  for (const mutant of mutants) {
    if (!coreSource.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    mutantsTotal++
    const mutantPath = join(ROOT, "validation/m26", `core.v1mutant.${Date.now()}.${mutantsTotal}.ts`)
    writeFileSync(mutantPath, coreSource.replace(mutant.from, mutant.to))
    let detected = false
    try {
      const m = await import(mutantPath)
      // Render the fixture through the mutant and run the full harness: any
      // failing assertion on a truthful model = the lie is caught.
      const r = new El("div")
      const d = { create: (t: string) => new El(t), root: () => r }
      const expectedModel = (mutant.model as typeof truncModel | undefined) ?? harnessModel
      m.renderGraph((mutant.model ? truncFixture : model) as never, d as never)
      const findingsM = H.runHarness(expectedModel, toHarness(r), {
        render: () => {
          const r2 = new El("div")
          const d2 = { create: (t: string) => new El(t), root: () => r2 }
          m.renderGraph((mutant.model ? truncFixture : model) as never, d2 as never)
          return toHarness(r2)
        },
        expectedTiers: (m.EDGE_TIERS ?? core.EDGE_TIERS) as readonly string[],
      })
      detected = findingsM.some((f) => !f.ok)
    } catch {
      detected = true
    } finally {
      try {
        rmSync(mutantPath, { force: true })
      } catch {}
    }
    if (detected) {
      caught++
      console.log(`  caught: ${mutant.name}`)
    } else {
      console.log(`  SURVIVED: ${mutant.name}`)
    }
  }
  check("M1–M5: every core mutant is caught by the harness", caught === mutantsTotal && mutantsTotal >= 5, `${caught}/${mutantsTotal}`)

  // --- P3: harness budget on the pinned fixture --------------------------------
  // Full-budget fixture AT the ceiling: 500 nodes / 2000 edges render
  // completely — the declared truncation profile is `truncated: false`, and
  // the harness must agree with a clean, marker-free document.
  const big = fixtureModel(0)
  for (let i = 0; i < 499; i++) big.nodes[`sym:n${i}`] = { id: `sym:n${i}`, name: `n${i}`, symbolType: "function", file: `f${i}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false }
  big.callees = Array.from({ length: 1250 }, (_, i) => ({ from: "sym:root", to: `sym:n${i % 499}`, relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: "r.ts", line: 1 }, depth: 0, rowId: `rel-b${i}` }))
  big.callers = Array.from({ length: 750 }, (_, i) => ({ from: `sym:n${i % 499}`, to: "sym:root", relationshipType: "calls", confidence: 0.95, isCrossLanguage: false, callSite: { kind: "call-site", file: "p.ts", line: 1 }, depth: 0, rowId: `rel-a${i}` }))
  big.summary = { totalCallers: 750, totalCallees: 1250, truncated: false, crossLanguageEdges: 0 }
  const samples: number[] = []
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now()
    const r = new El("div")
    const d = { create: (t: string) => new El(t), root: () => r }
    core.renderGraph(big as never, d as never)
    const findingsB = H.runHarness(
      { nodes: Object.values(big.nodes).map((n: any) => ({ id: n.id, name: n.name })), edges: [...big.callers, ...big.callees].map((e: any) => ({ from: e.from, to: e.to, relationshipType: e.relationshipType, confidence: e.confidence, rowId: e.rowId, expectedTier: "structural" })), truncated: false },
      toHarness(r),
      { expectedTiers: core.EDGE_TIERS as readonly string[] },
    )
    samples.push(performance.now() - t0)
    if (i === 0) check("P3: full-budget fixture passes the harness clean (at-ceiling, complete render)", findingsB.every((f) => f.ok), findingsB.filter((f) => !f.ok).map((f) => `${f.assertion}: ${f.detail}`).join("; "))
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("P3: render+harness p95 within the 300 ms budget on the pinned fixture", p95 < 300, `p95=${p95.toFixed(2)}ms`)


  // --- P5 (M42.H5): the hub laws — real core passes, liars fail ---------------
  // The hub renders USAGE ROWS (list by file / list by caller / call tree)
  // over the same model class. Positive: real renderHubList/renderHubTree
  // satisfy AH1–AH5. Negative: hand-built lying hub documents (fabricated
  // row, dropped row, wrong grouping, unbadged edge, hidden truncation,
  // phantom rows on an empty model) each FAIL their assertion.  console.log("  P5: hub laws (M42.H5 / M44.U1 grouped)")
  {
    // Grouped fixture: caller1 (one enriched row), caller2, callee x.
    const hubModel = {
      root: { symbolId: "sym:root", name: "root", file: "root.ts", language: "typescript", line: 1 },
      callers: [
        { symbolId: "sym:c1", name: "caller1", file: "caller1.ts", language: "typescript", symbolType: "function", line: 1, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "rel-0", relationshipType: "calls", depth: 0, confidence: 0.4, parentSymbolId: "sym:root", parentName: "root", enrichment: { role: "consumer", inferredAt: 1 } }] },
        { symbolId: "sym:c2", name: "caller2", file: "caller2.ts", language: "typescript", symbolType: "function", line: 1, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "rel-1", relationshipType: "calls", depth: 0, confidence: 0.9, parentSymbolId: "sym:root", parentName: "root" }] },
      ],
      callees: [{ symbolId: "sym:x", name: "x", file: "x.ts", language: "typescript", symbolType: "function", line: 1, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "rel-2", relationshipType: "calls", depth: 0, confidence: 0.8, parentSymbolId: "sym:root", parentName: "root" }] }],
      fileLevel: { imports: [], exports: [] },
      counts: { callerGroups: 2, calleeGroups: 1, callerRows: 2, calleeRows: 1, fileLevelRows: 0 },
      summary: { truncated: false, crossLanguageGroups: 0 },
    }
    const HUB_ROWS: H.HubHarnessRow[] = [
      { symbolId: "sym:c1", dir: "caller", name: "caller1", file: "caller1.ts", line: 1, rowIds: ["rel-0"], types: [{ type: "calls", occurrences: 1, tier: "inferred" }], enriched: true },
      { symbolId: "sym:c2", dir: "caller", name: "caller2", file: "caller2.ts", line: 1, rowIds: ["rel-1"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false },
      { symbolId: "sym:x", dir: "callee", name: "x", file: "x.ts", line: 1, rowIds: ["rel-2"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false },
    ]
    const hubHarnessModel: H.HubHarnessModel = { rows: HUB_ROWS, truncated: false, totalIfKnown: null, headerCounts: { callers: 2, callees: 1 } }

    const renderHubOnce = (fn: (r: any, d: any, group?: any) => any, group?: any): H.HarnessNode => {
      const r = new El("div")
      const d = { create: (t: string) => new El(t), root: () => r }
      fn(hubModel as never, d as never, group)
      return toHarness(r)
    }
    const listFile = renderHubOnce(core.renderHubList, "file")
    const findingsListFile = H.runHubHarness(hubHarnessModel, listFile, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
    check("P5: real core list-by-file passes AH1–AH11 clean (grouped)", findingsListFile.every((f) => f.ok), findingsListFile.filter((f) => !f.ok).map((f) => `${f.assertion}: ${f.detail}`).join("; "))
    const listCaller = renderHubOnce(core.renderHubList, "caller")
    const findingsListCaller = H.runHubHarness(hubHarnessModel, listCaller, { sectionClass: "bb-hub-list", group: "caller", assertGrouping: true })
    check("P5: real core list-by-caller passes AH1–AH11 clean (grouped)", findingsListCaller.every((f) => f.ok), findingsListCaller.filter((f) => !f.ok).map((f) => `${f.assertion}: ${f.detail}`).join("; "))
    const tree = renderHubOnce(core.renderHubTree)
    const findingsTree = H.runHubHarness(hubHarnessModel, tree, { sectionClass: "bb-hub-tree" })
    check("P5: real core call tree passes AH1–AH11 clean (grouped)", findingsTree.every((f) => f.ok), findingsTree.filter((f) => !f.ok).map((f) => `${f.assertion}: ${f.detail}`).join("; "))
    // U4 positive: the legend ships with every hub render — five tiers +
    // enrichment + the full staleness section — and the stale fixture law.
    const legendFindings = H.assertHubLegend(listFile, hubHarnessModel, "hub")
    check("P5: hub list ships the ONE legend (5 tiers + enrichment + 4 staleness statuses)", legendFindings.ok, legendFindings.detail)
    // Stale fixture: render the same deterministic document and append the
    // whole-panel stale marker exactly as the panel core renders it.
    const staleRoot = new El("div")
    core.renderHubList(hubModel as never, { create: (t: string) => new El(t), root: () => staleRoot } as never, "file")
    const staleMarkerEl = new El("div")
    staleMarkerEl.addClass("bb-stale-marker"); staleMarkerEl.setAttribute("data-stale", "true"); staleMarkerEl.setAttribute("data-status", "stale"); staleMarkerEl.textContent = "⚠️ stale — file changed since indexing (stale)"
    staleRoot.appendChild(staleMarkerEl)
    const staleModel: H.HubHarnessModel = { ...hubHarnessModel, staleMarker: { status: "stale" } }
    const staleFindings = H.assertHubLegend(toHarness(staleRoot), staleModel, "hub")
    check("P5: stale fixture with marker passes AH11", staleFindings.ok, staleFindings.detail)
    const freshMarkerFindings = H.assertHubLegend(listFile, staleModel, "hub")
    check("P5: stale model without a marker fails AH11 (positive-law check)", !freshMarkerFindings.ok)
    check("P5: hub renders are deterministic (tree twice byte-identical)", H.serializeHarnessNode(renderHubOnce(core.renderHubTree)) === H.serializeHarnessNode(renderHubOnce(core.renderHubTree)))

    // --- Liars: hand-built hub documents that MUST fail the harness --------
    const mkRow = (symbolId: string, dir: string, name: string, file: string, line: number, rowIds: string[], types: Array<{ type: string; occurrences: number; tier: string }>, enriched = false): El => {
      const el = new El("div")
      el.addClass("bb-hub-row")
      el.addClass("bb-hub-symrow")
      el.setAttribute("data-symbol-id", symbolId)
      el.setAttribute("data-dir", dir)
      el.setAttribute("data-depth", "0")
      const navigable = file.length > 0
      if (navigable) el.setAttribute("data-file", file)
      el.setAttribute("data-clickable", navigable ? "1" : "0")
      if (navigable) el.setAttribute("tabindex", "0")
      el.setAttribute("data-line", String(line))
      el.setAttribute("data-symbol", name)
      el.setAttribute("data-row-ids", rowIds.join(" "))
      el.setAttribute("data-occurrences", String(rowIds.length))
      const main = new El("span"); main.addClass("bb-hub-row-main")
      const n = new El("span"); n.addClass("bb-hub-row-name"); n.textContent = name
      const m = new El("span"); m.addClass("bb-hub-row-meta"); m.textContent = navigable ? `${file}:${line}` : "(external)"
      main.appendChild(n); main.appendChild(m); el.appendChild(main)
      const chips = new El("span"); chips.addClass("bb-hub-relchips")
      for (const t of types) {
        const c = new El("span"); c.addClass("bb-hub-relchip"); c.addClass(`bb-badge-${t.tier}`)
        c.setAttribute("data-rel-type", t.type); c.setAttribute("data-occurrences", String(t.occurrences)); c.setAttribute("data-tier", t.tier)
        c.textContent = `${t.type} ×${t.occurrences}`
        chips.appendChild(c)
      }
      el.appendChild(chips)
      if (enriched) { el.addClass("bb-hub-enriched"); el.setAttribute("data-enriched", "1"); const c = new El("span"); c.addClass("bb-hub-enrichment"); c.textContent = "⌾ enriched (consumer)"; el.appendChild(c) }
      const chev = new El("span"); chev.addClass("bb-hub-chevron"); chev.textContent = navigable ? "›" : "·"; el.appendChild(chev)
      return el
    }
    const mkSection = (): El => {
      const s = new El("div"); s.addClass("bb-hub"); s.addClass("bb-hub-list"); s.setAttribute("data-group", "file")
      const sum = new El("div"); sum.addClass("bb-hub-summary"); sum.textContent = "2 callers · 1 callee"; s.appendChild(sum)
      return s
    }
    const withGroups = (s: El, groups: Array<[string, El[]]>, counts?: number[]) => {
      let i = 0
      for (const [name, rows] of groups) {
        const g = new El("div"); g.addClass("bb-hub-group"); g.setAttribute("data-group-name", name)
        const l = new El("span"); l.addClass("bb-hub-group-label"); l.setAttribute("data-group-count", String(counts ? counts[i] : rows.length)); l.textContent = name; g.appendChild(l)
        rows.forEach((r) => g.appendChild(r)); s.appendChild(g)
        i++
      }
      return s
    }
    const rowC1 = () => mkRow("sym:c1", "caller", "caller1", "caller1.ts", 1, ["rel-0"], [{ type: "calls", occurrences: 1, tier: "inferred" }], true)
    const rowC2 = () => mkRow("sym:c2", "caller", "caller2", "caller2.ts", 1, ["rel-1"], [{ type: "calls", occurrences: 1, tier: "structural" }])
    const rowX = () => mkRow("sym:x", "callee", "x", "x.ts", 1, ["rel-2"], [{ type: "calls", occurrences: 1, tier: "structural" }])
    // liar 1: fabricated symbol row
    {
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1()]], ["x.ts", [rowX()]], ["FABRICATED.ts", [mkRow("sym:fab", "caller", "ghost", "FABRICATED.ts", 1, ["rel-fab"], [{ type: "calls", occurrences: 1, tier: "structural" }])]]])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
      check("P5 liar: fabricated symbol row caught (AH1)", findings.some((f) => !f.ok && f.assertion.startsWith("AH1")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 2: dropped row id from a group's inventory (rel-1's row gone)
    {
      const s = mkSection()
      const dropped = mkRow("sym:c2", "caller", "caller2", "caller2.ts", 1, ["rel-9"], [{ type: "calls", occurrences: 1, tier: "structural" }]) // wrong inventory id
      const doc = withGroups(s, [["caller1.ts", [rowC1()]], ["caller2.ts", [dropped]], ["x.ts", [rowX()]]])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: dropped row id caught (AH1 inventory)", findings.some((f) => !f.ok && f.assertion.startsWith("AH1")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 3: wrong grouping — rel-1 symbol rendered under caller1.ts
    {
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1(), rowC2()]], ["x.ts", [rowX()]]])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
      check("P5 liar: wrong grouping caught (AH2)", findings.some((f) => !f.ok && f.assertion.startsWith("AH2")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 4: missing type chip — row without its relchip (W4 tier law, grouped)
    {
      const s = mkSection()
      const noChip = mkRow("sym:c1", "caller", "caller1", "caller1.ts", 1, ["rel-0"], [], true) // types: [] -> no chips
      const doc = withGroups(s, [["caller1.ts", [noChip]], ["caller2.ts", [rowC2()]], ["x.ts", [rowX()]]])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: missing type chip caught (AH3)", findings.some((f) => !f.ok && f.assertion.startsWith("AH3")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 5: hidden truncation — truncated model rendered without a marker
    {
      const truncModel: H.HubHarnessModel = { rows: HUB_ROWS.slice(0, 2), truncated: true, shownCount: 2, totalIfKnown: null }
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1()]], ["caller2.ts", [rowC2()]]])
      const findings = H.runHubHarness(truncModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: hidden truncation caught (AH5)", findings.some((f) => !f.ok && f.assertion.startsWith("AH5")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 6: phantom rows on an EMPTY model
    {
      const emptyModel: H.HubHarnessModel = { rows: [], truncated: false, totalIfKnown: 0 }
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1()]]])
      const findings = H.runHubHarness(emptyModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: phantom rows on an empty model caught (AH5)", findings.some((f) => !f.ok), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 7 (M44.U2 §13.3): a CLICKABLE row rendered WITHOUT the affordance —
    // data-clickable removed, no tabindex, no chevron. The row claims to be
    // navigable (data-file set, bridge would navigate it) but the user is
    // never told — the exact "cannot tell what is clickable" defect.
    {
      const dead = mkRow("sym:c2", "caller", "caller2", "caller2.ts", 1, ["rel-1"], [{ type: "calls", occurrences: 1, tier: "structural" }])
      dead.attrs["data-clickable"] = "0"
      delete dead.attrs["tabindex"]
      dead.children = dead.children.filter((c) => !c.className.split(" ").includes("bb-hub-chevron"))
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1()]], ["caller2.ts", [dead]], ["x.ts", [rowX()]]])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: navigable row without a click affordance caught (AH6)", findings.some((f) => !f.ok && f.assertion.startsWith("AH6")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 8 (M44.U2 §13.4): a group header that LIES about its count —
    // header claims 5, renders 1.
    {
      const s = mkSection()
      const doc = withGroups(s, [["caller1.ts", [rowC1()]], ["caller2.ts", [rowC2()]], ["x.ts", [rowX()]]], [5, 1, 1])
      const findings = H.runHubHarness(hubHarnessModel, toHarness(doc), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: group header miscount caught (AH6)", findings.some((f) => !f.ok && f.assertion.startsWith("AH6")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }

    // --- U3 (M44.U3): the call tree nests honestly — AH7–AH9 -------------
    // Positive: the real core nests a deeper caller under its placement
    // parent (never flat, never duplicated) with declared expansion state.
    const nestedHub = {
      root: { symbolId: "sym:root", name: "root", file: "root.ts", language: "typescript", line: 1 },
      callers: [
        { symbolId: "sym:mid", name: "mid", file: "mid.ts", language: "typescript", symbolType: "function", line: 2, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "rel-m", relationshipType: "calls", depth: 0, confidence: 0.9, parentSymbolId: "sym:root", parentName: "root" }] },
        { symbolId: "sym:leaf", name: "leaf", file: "leaf.ts", language: "typescript", symbolType: "function", line: 3, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "rel-l", relationshipType: "calls", depth: 1, confidence: 0.9, parentSymbolId: "sym:mid", parentName: "mid" }] },
      ],
      callees: [],
      fileLevel: { imports: [], exports: [] },
      counts: { callerGroups: 2, calleeGroups: 0, callerRows: 2, calleeRows: 0, fileLevelRows: 0 },
      summary: { truncated: false, crossLanguageGroups: 0 },
    }
    const nestedHarnessModel: H.HubHarnessModel = {
      rows: [
        { symbolId: "sym:mid", dir: "caller", name: "mid", file: "mid.ts", line: 2, rowIds: ["rel-m"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false, depth: 0, treeParent: "" },
        { symbolId: "sym:leaf", dir: "caller", name: "leaf", file: "leaf.ts", line: 3, rowIds: ["rel-l"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false, depth: 1, treeParent: "sym:mid" },
      ],
      truncated: false,
      totalIfKnown: null,
      headerCounts: { callers: 2, callees: 0 },
    }
    const nestedTree = (() => {
      const r = new El("div")
      const d = { create: (t: string) => new El(t), root: () => r }
      core.renderHubTree(nestedHub as never, d as never)
      return toHarness(r)
    })()
    const nestedFindings = H.runHubHarness(nestedHarnessModel, nestedTree, { sectionClass: "bb-hub-tree" })
    check("P5: real core nests a deeper caller under its parent (AH7) with declared expansion (AH8) and honest depth/level (AH9)", nestedFindings.every((f) => f.ok), nestedFindings.filter((f) => !f.ok).map((f) => `${f.assertion}: ${f.detail}`).join("; "))
    // One symbol per placement, exactly once per side: the deeper row's count
    // never double-counts the parent (AH1 dupes guard, exercised positively).
    const treeText = H.serializeHarnessNode(nestedTree)
    check("P5: nested tree renders each symbol exactly once (no DAG duplication)", (treeText.match(/data-symbol-id=\"sym:leaf\"/g) ?? []).length === 1 && (treeText.match(/data-symbol-id=\"sym:mid\"/g) ?? []).length === 1)

    // Tree DOM builders for the U3 liars: a bb-hub-tree section whose rows
    // can nest under parent rows via children wrappers.
    const treeRowEl = (symbolId: string, dir: string, name: string, file: string, line: number, rowIds: string[], parentId: string, parentName: string, level: number, depth: number): any => {
      const row = mkRow(symbolId, dir, name, file, line, rowIds, [{ type: "calls", occurrences: rowIds.length, tier: "structural" }])
      row.addClass("bb-hub-tree-node")
      row.setAttribute("data-level", String(level))
      row.setAttribute("data-depth", String(depth))
      row.setAttribute("data-parent-id", parentId)
      row.setAttribute("data-parent-name", parentName)
      return row
    }
    const treeSection = (): El => {
      const s = new El("div"); s.addClass("bb-hub"); s.addClass("bb-hub-tree")
      const sum = new El("div"); sum.addClass("bb-hub-summary"); sum.textContent = "1 caller · 0 callees"; s.appendChild(sum)
      return s
    }
    const withCallerSubtree = (s: El, top: any, kid: any): El => {
      const sub = new El("div"); sub.addClass("bb-hub-subtree"); sub.setAttribute("data-dir", "caller")
      sub.appendChild(top)
      const wrap = new El("div"); wrap.addClass("bb-hub-children"); wrap.addClass("bb-hub-collapsed")
      top.appendChild(wrap)
      wrap.appendChild(kid)
      s.appendChild(sub)
      return s
    }
    const rowMid = () => treeRowEl("sym:mid", "caller", "mid", "mid.ts", 2, ["rel-m"], "sym:root", "root", 0, 0)
    const rowLeaf = () => treeRowEl("sym:leaf", "caller", "leaf", "leaf.ts", 3, ["rel-l"], "sym:mid", "mid", 1, 1)
    // liar 9 (U3 AH7): a deeper row FLATTENED to the top level — the model
    // says it nests under sym:mid; the liar renders it as a top-level row.
    {
      const s = treeSection()
      const sub = new El("div"); sub.addClass("bb-hub-subtree"); sub.setAttribute("data-dir", "caller")
      sub.appendChild(rowMid())
      sub.appendChild(rowLeaf()) // flattened sibling — fabricates a level
      s.appendChild(sub)
      const findings = H.runHubHarness(nestedHarnessModel, toHarness(s), { sectionClass: "bb-hub-tree" })
      check("P5 liar: deeper row flattened to top level caught (AH7)", findings.some((f) => !f.ok && f.assertion.startsWith("AH7-9")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 10 (U3 AH7): nested under the WRONG parent (data-parent-id says
    // sym:mid but the DOM nests it under a fabricated sym:other node).
    {
      const s = treeSection()
      const other = treeRowEl("sym:other", "caller", "other", "other.ts", 9, ["rel-o"], "sym:root", "root", 0, 0)
      const sub = new El("div"); sub.addClass("bb-hub-subtree"); sub.setAttribute("data-dir", "caller")
      const wrap = new El("div"); wrap.addClass("bb-hub-children")
      other.appendChild(wrap)
      wrap.appendChild(rowLeaf()) // leaf's true parent is mid, not other
      sub.appendChild(rowMid())
      sub.appendChild(other)
      s.appendChild(sub)
      const findings = H.runHubHarness(nestedHarnessModel, toHarness(s), { sectionClass: "bb-hub-tree" })
      check("P5 liar: deeper row nested under a non-parent caught (AH7)", findings.some((f) => !f.ok && f.assertion.startsWith("AH7-9")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 11 (U3 AH8): a parent with model children renders NO expander —
    // the subtree exists but the user is never told it can open.
    {
      const noExp = treeRowEl("sym:mid", "caller", "mid", "mid.ts", 2, ["rel-m"], "sym:root", "root", 0, 0)
      const s = withCallerSubtree(treeSection(), noExp, rowLeaf())
      const findings = H.runHubHarness(nestedHarnessModel, toHarness(s), { sectionClass: "bb-hub-tree" })
      check("P5 liar: parent without a declared expander caught (AH8)", findings.some((f) => !f.ok && f.assertion.startsWith("AH7-9")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 12 (U3 AH1): the same symbol rendered TWICE in the tree (DAG-style
    // duplication would double-count usages, §13.2).
    {
      const s = treeSection()
      const sub = new El("div"); sub.addClass("bb-hub-subtree"); sub.setAttribute("data-dir", "caller")
      const midRow = rowMid()
      const dupLeaf = rowLeaf()
      const wrap = new El("div"); wrap.addClass("bb-hub-children")
      midRow.appendChild(wrap)
      wrap.appendChild(dupLeaf) // leaf nested under mid (its true parent)
      sub.appendChild(midRow)
      sub.appendChild(dupLeaf) // ...and rendered AGAIN at the top level
      s.appendChild(sub)
      const findings = H.runHubHarness(nestedHarnessModel, toHarness(s), { sectionClass: "bb-hub-tree" })
      check("P5 liar: duplicated tree symbol caught (AH1 dupes)", findings.some((f) => !f.ok && f.assertion.startsWith("AH1")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // --- U4 (M44.U4): header counts + the ONE legend — AH10/AH11 -----------
    const listSection = (callers: number, callees: number): El => {
      const s = new El("div"); s.addClass("bb-hub"); s.addClass("bb-hub-list")
      const sum = new El("div"); sum.addClass("bb-hub-summary"); sum.setAttribute("data-callers", String(callers)); sum.setAttribute("data-callees", String(callees)); sum.textContent = `${callers} callers · ${callees} callees`
      s.appendChild(sum)
      return s
    }
    const listGroups = (s: El, count: number): El => {
      const sub = new El("div"); sub.addClass("bb-hub-subtree"); sub.setAttribute("data-dir", "caller")
      for (let i = 0; i < count; i++) sub.appendChild(rowC1())
      s.appendChild(sub)
      return s
    }
    // liar 13 (U4 AH10): header trusts a server count while rendering fewer
    // groups — data-callers=3 over two rendered rows (the eye-verifiable
    // number is the rendered one, §13.4).
    {
      const s = listGroups(listSection(3, 0), 2)
      const findings = H.runHubHarness(hubHarnessModel, toHarness(s), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: header count disagrees with rendered groups caught (AH10)", findings.some((f) => !f.ok && f.assertion.startsWith("AH10")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 14 (U4 AH11): a legend MISSING the staleness section — tiers only.
    {
      const s = listGroups(listSection(1, 0), 1)
      const lg = new El("div"); lg.addClass("bb-legend"); lg.setAttribute("data-legend", "edge-evidence-tiers")
      const item = new El("div"); item.addClass("bb-legend-item")
      const sw = new El("span"); sw.addClass("bb-legend-swatch"); sw.setAttribute("data-legend-tier", "structural"); item.appendChild(sw)
      lg.appendChild(item)
      s.appendChild(lg)
      const findings = H.runHubHarness(hubHarnessModel, toHarness(s), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: legend without the staleness section caught (AH11)", findings.some((f) => !f.ok && f.assertion.startsWith("AH11")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
    // liar 15 (U4 AH11): a FRESH fixture rendering a stale marker (phantom
    // staleness — the mirror of hiding one).
    {
      const s = listGroups(listSection(1, 0), 1)
      const lg = new El("div"); lg.addClass("bb-legend")
      s.appendChild(lg)
      const mk = new El("div"); mk.addClass("bb-stale-marker"); mk.setAttribute("data-stale", "true"); mk.setAttribute("data-status", "stale")
      s.appendChild(mk)
      const findings = H.runHubHarness(hubHarnessModel, toHarness(s), { sectionClass: "bb-hub-list", group: "file" })
      check("P5 liar: phantom stale marker on a fresh fixture caught (AH11)", findings.some((f) => !f.ok && f.assertion.startsWith("AH11")), findings.map((f) => `${f.assertion}:${f.ok}`).join("; "))
    }
  }

  // --- Persist evidence -----------------------------------------------------------
  const failed = checks - passed
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result = {
    issue: "M26.V1",
    code: "V1",
    milestone: "M26",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-webview-harness.ts",
    ...fingerprintFields(["m26.V1"], ROOT),
    evidenceFile: "V1.json",
    generatedAt: new Date().toISOString(),
    limitations: [
      "The harness asserts the DOM contract (classes, data attributes, counts) over a stub DOM; CSS/paint is per-editor presentation.",
      "Full-budget A4 profile: the pinned fixture's traversal truncation is declared, so the marker assertions are the expected failures there.",
    ],
  }
  const dir = join(ROOT, "validation/m26/results")
  mkdirSync(dir, { recursive: true })
  writeSealed(join(dir, "V1.json"), result)
  console.log(`V1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
