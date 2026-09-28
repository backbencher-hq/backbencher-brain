// script/m26/verify-webview-core.ts — M26.W1 verifier + mutation suite.
//
// Proves the ONE renderer (script/m26/graph-core.ts) honors its declared
// decisions, and proves the suite CAN FAIL by planting defects.
//
//   P1  import-purity:      zero imports; no innerHTML / Date.now( /
//                           Math.random( usage in the core's CODE (comments
//                           stripped before linting)
//   P2  tier rendering:     five evidence tiers render distinctly; stored
//                           evidenceClass wins; declared derivation
//                           otherwise; 0.7 inheritance floor respected
//   P3  determinism:        same input -> byte-identical DOM tree twice
//   P4  budget+truncation:  500/2000 budget enforced; exhausted budgets
//                           render a visible marker with real counts
//   P5  model honesty:      malformed results throw; rowId rendered only
//                           when present, never invented
//
// Mutants (each must be CAUGHT — the oracle must detect the mutated core):
//   M1 hidden truncation     (marker never rendered)
//   M2 wrong tier label      (inferred rendered as structural)
//   M3 stored class ignored  (metadata.evidenceClass dropped)
//   M4 nondeterminism        (Math.random ordering inside render)
//   M5 fabricated rowId      (edge gets an invented data-row-id)
//   M6 budget lifted         (maxEdges limit removed)
//
// Run: npx tsx script/m26/verify-webview-core.ts
// Evidence: validation/m26/results/W1.json (machine-emitted)

import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

// --- Test DOM (the harness stub; V1 reuses this shape) --------------------
class El {
  tagName: string
  className = ""
  children: El[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
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
  serialize(): string {
    const attrs = Object.entries(this.attrs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${v}"`).join(" ")
    const cls = this.className ? ` class="${this.className}"` : ""
    const open = `<${this.tagName}${cls}${attrs ? " " + attrs : ""}`
    if (!this.children.length) return this.textContent ? `${open}>${this.textContent}</${this.tagName}>` : `${open}></${this.tagName}>`
    return `${open}>${this.children.map((c) => c.serialize()).join("")}</${this.tagName}>`
  }
  find(className: string): El | null {
    if (this.className.split(" ").includes(className)) return this
    for (const c of this.children) {
      const hit = c.find(className)
      if (hit) return hit
    }
    return null
  }
  findAll(className: string): El[] {
    const out: El[] = []
    if (this.className.split(" ").includes(className)) out.push(this)
    for (const c of this.children) out.push(...c.findAll(className))
    return out
  }
}

/** A fresh DOM whose root() always returns the SAME owned element — the
 *  webview contract (the adapter owns the container). */
function makeDom(): { create: (tag: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (tag: string) => new El(tag), root: () => el, el }
}

// --- Fixture ----------------------------------------------------------------
type Edge = {
  from: string
  to: string
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  // M62.A2 (issue #876): the address shape the owner derives — a fixture may
  // only construct an address the owner could have produced.
  callSite: { kind: "call-site" | "declaration" | "unknown"; file: string; line: number | null; note?: string }
  depth: number
  rowId?: string
  metadata?: { evidenceClass?: string }
}
function fixture(overrides: { edgeCount?: number; tierOverride?: string; confidenceOverride?: number } = {}): {
  root: unknown
  callers: Edge[]
  callees: Edge[]
  nodes: Record<string, unknown>
  summary: { totalCallers: number; totalCallees: number; truncated: boolean; crossLanguageEdges: number }
} {
  const n = overrides.edgeCount ?? 3
  const mk = (i: number) => ({
    id: `sym:c${i}`,
    name: `caller${i}`,
    symbolType: "function",
    file: `src/c${i}.ts`,
    line: i + 1,
    lineEnd: i + 4,
    language: "typescript",
    isExternal: false,
  })
  const rootNode = { id: "sym:root", name: "root", symbolType: "function", file: "src/r.ts", line: 1, lineEnd: 9, language: "typescript", isExternal: false }
  const nodes: Record<string, unknown> = { "sym:root": rootNode }
  const callers = Array.from({ length: n }, (_, i) => {
    const node = mk(i)
    nodes[node.id] = node
    const e: Edge = {
      from: node.id,
      to: "sym:root",
      relationshipType: "calls",
      confidence: overrides.confidenceOverride ?? 0.95,
      isCrossLanguage: false,
      callSite: { kind: "call-site", file: node.file, line: node.line },
      depth: 0,
    }
    if (overrides.tierOverride) e.metadata = { evidenceClass: overrides.tierOverride }
    return e
  })
  return {
    root: rootNode,
    callers,
    callees: [],
    nodes,
    summary: { totalCallers: n, totalCallees: 0, truncated: false, crossLanguageEdges: 0 },
  }
}

async function main(): Promise<void> {
  const core = await import(CORE)
  const rawSource = readFileSync(CORE, "utf8")
  // Strip comments before purity linting so doc mentions don't false-positive.
  const source = rawSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")

  // --- P1: import purity ----------------------------------------------------
  const imp = rawSource.match(/^import .*$/gm) ?? []
  check("P1: core has zero imports (port-injected, import-pure)", imp.length === 0, imp.join("; "))
  check("P1: core never touches innerHTML in code", !source.includes("innerHTML"))
  check("P1: core has no hidden clock in code", !source.includes("Date.now("))
  check("P1: core has no randomness in code", !source.includes("Math.random("))

  // --- P2: tier rendering ---------------------------------------------------
  const tiers = core.EDGE_TIERS as readonly string[]
  check("P2: five declared tiers", tiers.length === 5 && tiers.includes("structural") && tiers.includes("inferred"))

  const d1 = makeDom()
  core.renderGraph(fixture(), d1 as never)
  check("P2: call edges above the floor render structural", d1.el.findAll("bb-edge-structural").length === 3)
  check("P2: each edge carries exactly one data-tier", d1.el.findAll("bb-edge").every((e) => (e.attrs["data-tier"] ?? "").length > 0))

  const dSt = makeDom()
  core.renderGraph(fixture({ tierOverride: "inferred", confidenceOverride: 0.99 }), dSt as never)
  check("P2: stored evidenceClass overrides derivation", dSt.el.findAll("bb-edge-inferred").length === 3 && dSt.el.findAll("bb-edge-structural").length === 0)

  const dLow = makeDom()
  core.renderGraph(fixture({ confidenceOverride: 0.69 }), dLow as never)
  check("P2: sub-floor call edges render inferred", dLow.el.findAll("bb-edge-inferred").length === 3)

  const dImp = makeDom()
  const fxi = fixture()
  fxi.callers[0]!.relationshipType = "imports"
  fxi.callers[1]!.relationshipType = "references"
  fxi.callers[2]!.relationshipType = "references_qualified"
  core.renderGraph(fxi, dImp as never)
  check(
    "P2: import/references derivations render their tiers",
    dImp.el.findAll("bb-edge-import_based").length === 1 && dImp.el.findAll("bb-edge-usage_contextual").length === 1 && dImp.el.findAll("bb-edge-reference_qualified").length === 1,
  )

  // --- P3: determinism ------------------------------------------------------
  const dA = makeDom()
  core.renderGraph(fixture({ edgeCount: 50 }), dA as never)
  const dB = makeDom()
  core.renderGraph(fixture({ edgeCount: 50 }), dB as never)
  check("P3: same input renders byte-identical DOM twice", dA.el.serialize() === dB.el.serialize())

  // --- P4: budget + truncation ---------------------------------------------
  check("P4: budget pinned at 500 nodes / 2000 edges", core.RENDER_BUDGET.maxNodes === 500 && core.RENDER_BUDGET.maxEdges === 2000)

  const dBig = makeDom()
  const stats = core.renderGraph(fixture({ edgeCount: 2100 }), dBig as never)
  check("P4: edge budget enforced at 2000", stats.edgesRendered === 2000 && stats.edgesTotal === 2100, `rendered=${stats.edgesRendered} total=${stats.edgesTotal}`)
  const marker = dBig.el.findAll("bb-truncation-marker").find((m) => m.attrs["data-truncated"] === "edges")
  check("P4: exhausted budget renders a visible marker", marker !== null)
  check("P4: marker declares real shown/total counts", marker !== null && marker!.textContent.includes("2000") && marker!.textContent.includes("2100"))

  const dNodes = makeDom()
  const manyNodes = fixture({ edgeCount: 0 })
  for (let i = 0; i < 510; i++) manyNodes.nodes[`sym:x${i}`] = { id: `sym:x${i}`, name: `x${i}`, symbolType: "function", file: `f${i}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false }
  manyNodes.callees = Array.from({ length: 510 }, (_, i) => ({ from: "sym:root", to: `sym:x${i}`, relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: "r.ts", line: 1 }, depth: 0 }))
  manyNodes.summary = { totalCallers: 0, totalCallees: 510, truncated: false, crossLanguageEdges: 0 }
  const statsNodes = core.renderGraph(manyNodes as never, dNodes as never)
  check("P4: node budget enforced at 500", statsNodes.nodesRendered === 500 && statsNodes.nodesTruncated === true)
  check("P4: node truncation also renders a marker", dNodes.el.find("bb-truncation-marker") !== null)

  // --- P5: model honesty ----------------------------------------------------
  let threw = false
  try {
    core.renderGraph({} as never, makeDom() as never)
  } catch {
    threw = true
  }
  check("P5: malformed result throws instead of rendering a guess", threw)

  const dRow = makeDom()
  const withRow = fixture({ edgeCount: 1 })
  withRow.callers[0]!.rowId = "rel-abc-123"
  core.renderGraph(withRow, dRow as never)
  check("P5: rowId renders as data-row-id when present", dRow.el.findAll("bb-edge").some((e) => e.attrs["data-row-id"] === "rel-abc-123"))

  const dNoRow = makeDom()
  core.renderGraph(fixture({ edgeCount: 1 }), dNoRow as never)
  check("P5: no rowId is ever invented", dNoRow.el.findAll("bb-edge").every((e) => !("data-row-id" in e.attrs)))

  // --- P6: render budget (contract section 3) -------------------------------
  // The core is deterministic, I/O-free compute, so wall-clock over the
  // pinned full-budget fixture IS the render cost (headless regime: no real
  // DOM/CSS — the in-editor regime is measured by the editor legs and
  // declared as a limitation). Warm p95 over 30 renders of the 500-node /
  // 2000-edge fixture must hold the 300 ms warm budget.
  const dBudget = makeDom()
  const fullFixture = fixture({ edgeCount: 0 })
  // Exactly the pinned budget: 1 root + 499 nodes = 500; 750 + 1250 = 2000
  // edges (multiple edges may share endpoints — budget is about render cost).
  for (let i = 0; i < 499; i++) fullFixture.nodes[`sym:n${i}`] = { id: `sym:n${i}`, name: `n${i}`, symbolType: "function", file: `f${i}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false }
  fullFixture.callers = Array.from({ length: 750 }, (_, i) => ({ from: `sym:n${i % 499}`, to: "sym:root", relationshipType: "calls", confidence: 0.95, isCrossLanguage: false, callSite: { kind: "call-site", file: "p.ts", line: 1 }, depth: 0 }))
  fullFixture.callees = Array.from({ length: 1250 }, (_, i) => ({ from: "sym:root", to: `sym:n${i % 499}`, relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: "r.ts", line: 1 }, depth: 0 }))
  fullFixture.summary = { totalCallers: 750, totalCallees: 1250, truncated: false, crossLanguageEdges: 0 }
  const samples: number[] = []
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now()
    core.renderGraph(fullFixture as never, dBudget as never)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  check("P6: warm p95 render within the 300 ms budget on the pinned fixture", p95 < core.RENDER_BUDGET.warmMs, `p95=${p95.toFixed(2)}ms max=${Math.max(...samples).toFixed(2)}ms`)
  check("P6: budget fixture actually full-size (500 nodes / 2000 edges)", Object.keys(fullFixture.nodes).length === 500 && fullFixture.callers.length + fullFixture.callees.length === 2000)

  // --- Mutants ---------------------------------------------------------------
  const mutants: Array<{ name: string; from: string; to: string }> = [
    {
      name: "M1 hidden truncation",
      from: '  if (nodesTruncated) layer.appendChild(truncationMarker("nodes", nodesRendered, nodesTotal, dom))\n  if (edgesTruncated) layer.appendChild(truncationMarker("edges", edgesRendered, edgesTotal, dom))',
      to: '  if (false) layer.appendChild(truncationMarker("nodes", nodesRendered, nodesTotal, dom))\n  if (false) layer.appendChild(truncationMarker("edges", edgesRendered, edgesTotal, dom))',
    },
    { name: "M2 wrong tier label (sub-floor calls as structural)", from: 'return edge.confidence >= 0.7 ? "structural" : "inferred"', to: 'return edge.confidence >= 0.7 ? "structural" : "structural"' },
    { name: "M3 stored class ignored", from: "if (stored && (EDGE_TIERS as readonly string[]).includes(stored)) return stored as EdgeTier", to: "if (false) return stored as EdgeTier" },
    { name: "M4 nondeterminism", from: "const allEdges: GraphEdgeLike[] = [...result.callers, ...result.callees]", to: "const allEdges: GraphEdgeLike[] = [...result.callers, ...result.callees].sort(() => Math.random() - 0.5)" },
    { name: "M5 fabricated rowId", from: 'if (edge.rowId) el.setAttribute("data-row-id", edge.rowId)', to: 'el.setAttribute("data-row-id", edge.rowId ?? "fabricated-" + index)' },
    { name: "M6 budget lifted", from: "if (edgesRendered >= RENDER_BUDGET.maxEdges) {", to: "if (edgesRendered >= Number.MAX_SAFE_INTEGER) {" },
  ]

  /** Probe a mutant: return true when the mutated core shows the defect the
   *  suite's positive expectations would flag (i.e. the mutant is detectable
   *  as a regression). */
  function probe(m: typeof core, name: string): boolean {
    if (name.startsWith("M1")) {
      const d = makeDom()
      m.renderGraph(fixture({ edgeCount: 2100 }) as never, d as never)
      return d.el.findAll("bb-truncation-marker").length === 0 // all markers gone => defect visible
    }
    if (name.startsWith("M2")) {
      const d = makeDom()
      m.renderGraph(fixture({ confidenceOverride: 0.69 }) as never, d as never)
      return d.el.findAll("bb-edge-structural").length === 3 && d.el.findAll("bb-edge-inferred").length === 0 // mislabeled
    }
    if (name.startsWith("M3")) {
      const d = makeDom()
      m.renderGraph(fixture({ tierOverride: "inferred", confidenceOverride: 0.99 }) as never, d as never)
      return d.el.findAll("bb-edge-structural").length === 3 // stored tier dropped
    }
    if (name.startsWith("M4")) {
      let differ = false
      for (let i = 0; i < 20 && !differ; i++) {
        const da = makeDom()
        const db = makeDom()
        m.renderGraph(fixture({ edgeCount: 50 }) as never, da as never)
        m.renderGraph(fixture({ edgeCount: 50 }) as never, db as never)
        differ = da.el.serialize() !== db.el.serialize()
      }
      return differ
    }
    if (name.startsWith("M5")) {
      const d = makeDom()
      m.renderGraph(fixture({ edgeCount: 1 }) as never, d as never)
      return d.el.findAll("bb-edge").every((e) => "data-row-id" in e.attrs) // fabricated ids everywhere
    }
    if (name.startsWith("M6")) {
      const d = makeDom()
      const stats = m.renderGraph(fixture({ edgeCount: 2100 }) as never, d as never)
      const edgesMarker = d.el.findAll("bb-truncation-marker").some((mk) => mk.attrs["data-truncated"] === "edges")
      return stats.edgesRendered === 2100 && !edgesMarker // edge budget gone, edge marker gone
    }
    return false
  }

  let caught = 0
  let mutantsTotal = 0
  for (const mutant of mutants) {
    if (!rawSource.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    mutantsTotal++
    const mutantPath = path.join(ROOT, "validation/m26", `graph-core.mutant.${Date.now()}.${mutantsTotal}.ts`)
    writeFileSync(mutantPath, rawSource.replace(mutant.from, mutant.to))
    let detected = false
    try {
      const m = await import(mutantPath)
      detected = probe(m, mutant.name)
    } catch {
      detected = true // load failure counts as caught
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

  check("mutation suite: every planted defect is caught", caught === mutantsTotal && mutantsTotal >= 5, `${caught}/${mutantsTotal}`)

  // --- Persist evidence ------------------------------------------------------
  const failed = checks - passed
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result = {
    issue: "M26.W1",
    code: "W1",
    milestone: "M26",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-webview-core.ts",
    evidenceFile: "W1.json",
    generatedAt: new Date().toISOString(),
    limitations: [
      "DOM-port stub is the harness surface; real webview CSS/positioning is verified in-editor by later legs (E5/E6 pattern).",
      "Render budget (300/1000 ms) is measured by the caller per contract section 3; this suite pins the structural budget only.",
    ],
  }
  const dir = path.join(ROOT, "validation/m26/results")
  mkdirSync(dir, { recursive: true })
  writeSealed(path.join(dir, "W1.json"), result)
  console.log(`W1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
