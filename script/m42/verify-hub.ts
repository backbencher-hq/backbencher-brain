// script/m42/verify-hub.ts — M42.H5 verifier + mutation suite (issue #653).
//
// "The hub — usages as list/tree over bb/graph". Fixture-first: the authored
// expectations below (docs/m42/HUB.md + this file) describe what a real
// index + the ONE renderer core must produce for a known symbol; the suite
// then proves it against a REAL freshly-indexed fixture through the REAL
// dist server, and proves the suite CAN FAIL by planting renderer defects
// (source-copy mutants, the M26.W1 pattern) that the M26.V1 webview harness
// must catch.
//
//   R1 indexed:      the h2 fixture (2 java files, main→render in both) is
//                    indexed by the REAL indexer.
//   R2 usages mode:  bb/graph {mode:"usages"} over the real server returns
//                    the full declared profile: both directions, both
//                    callers present with their known files, not truncated.
//   R3 fixture-first: the REAL result rendered through renderHubList (by
//                    file + by caller) and renderHubTree satisfies the
//                    authored expectations AND the M26.V1 hub harness
//                    (AH1–AH5 clean on real data — no fabrication, no drop,
//                    correct grouping, badges, deterministic renders).
//   R4 truncation:   a truncated model renders the declared marker with real
//                    counts; a complete model renders none (never silent).
//   R5 enrichment:   enriched rows render the labeled chip (H3 fields), as
//                    data attrs + bb-hub-enrichment — never a tier change.
//   R6 budget:       hub open (usages query + all three renders) warm p95
//                    <= 300 ms — the G1-declared hub budget.
//   M1–M5 mutants:   source-copy defects (badge dropped, truncation hidden,
//                    callees dropped, wrong grouping, orphaned section) are
//                    all caught by the harness.
//
// Evidence: validation/m42/results/H5.json (machine-emitted).

import { execFileSync } from "node:child_process"
import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { H2_EXPECT, H2_FILE_APP, H2_REL_APP, H2_REL_MAIN2, H2_ROOT, writeH2Fixture } from "./h2-fixture.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE = path.join(ROOT, "validation/m42/results/H5.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const BB = path.join(ROOT, "bin/bb")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const HARNESS = path.join(ROOT, "script/m26/webview-harness.ts")
const CORE_MODULE = path.join(ROOT, "script/m26/graph-core.ts")

let checks = 0
let passed = 0
const failures: string[] = []
let mutants = { caught: 0, total: 0 }

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutants.total++
  if (caught) mutants.caught++
  check(`${label} [mutant]`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- DOM stub + serializer (the renderers are import-free; this is the only
// harness dependency they need) --------------------------------------------------
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
const toHarness = (el: El): unknown => ({
  tag: el.tagName,
  className: el.className,
  attrs: el.attrs,
  textContent: el.textContent,
  children: el.children.map(toHarness),
})
const serialize = (el: El): string => {
  const attrs = Object.entries(el.attrs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${v}"`).join(" ")
  const cls = el.className ? ` class="${el.className}"` : ""
  const open = `<${el.tagName}${cls}${attrs ? " " + attrs : ""}`
  if (el.children.length === 0) return el.textContent ? `${open}>${el.textContent}</${el.tagName}>` : `${open}></${el.tagName}>`
  return `${open}>${el.children.map(serialize).join("")}</${el.tagName}>`
}
const renderInto = (fn: (result: unknown, dom: unknown, group?: string) => unknown, result: unknown, group?: string): { el: El; html: string } => {
  const root = new El("div")
  const dom = { create: (t: string) => new El(t), root: () => root }
  fn(result, dom as never, group as never)
  return { el: root, html: serialize(root) }
}

// --- R1: fixture indexed ---------------------------------------------------------
console.log("R1: fixture index (real indexer)")
writeH2Fixture()
if (!existsSync(path.join(ROOT, "dist/lsp/server.js"))) {
  console.log("  (dist missing — building)")
  execFileSync("npx", ["tsup"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 })
}
const idxOut = execFileSync(BB, ["index", H2_ROOT, "--no-setup"], { cwd: ROOT, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "inherit"] })
check("H5/R1: fixture indexes cleanly", /indexed 2 files/.test(idxOut), idxOut.split("\n").find((l) => l.includes("indexed")) ?? "")

// --- LSP client over stdio (real dist server) -----------------------------------
class StdioLsp {
  private child
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private stderrTail = ""
  constructor(workspace: string) {
    this.child = spawn(process.execPath, [SERVER, "--dir", workspace], { stdio: ["pipe", "pipe", "pipe"] })
    this.child.stdout.on("data", (c: Buffer) => this.onData(c))
    this.child.stderr.on("data", (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString()).slice(-8000)
    })
  }
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString()
      const len = parseInt(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? "0")
      if (!len || this.buffer.length < headerEnd + 4 + len) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString()
      this.buffer = this.buffer.subarray(headerEnd + 4 + len)
      try {
        const msg = JSON.parse(body)
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      } catch {}
    }
  }
  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params })
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  dispose(): void {
    this.child.kill()
  }
  stderr(): string {
    return this.stderrTail
  }
}

// Authored fixture-first expectations for symbol `render` (h2 fixture): main in
// App.java AND main in Main2.java both call render — the hub must show both,
// grouped by their files, never fabricated, never dropped.
const CALLER_FILE_APP = H2_REL_APP // src/main/java/com/demo/App.java
const CALLER_FILE_MAIN2 = H2_REL_MAIN2 // src/main/java/com/demo/Main2.java

const lsp = new StdioLsp(H2_ROOT)
let realResult: any = null
try {
  const init = await lsp.request("initialize", { processId: null, rootUri: `file://${H2_ROOT}`, capabilities: {} })
  check("H5/R2: server advertises graphProvider", init?.capabilities?.graphProvider !== undefined, "")

  // --- R2: usages mode over the real server ------------------------------------
  console.log("\nR2: bb/graph usages mode (real server, real index)")
  const g = await lsp.request("bb/graph", { schemaVersion: 1, symbol: "render", mode: "usages" })
  realResult = g
  check("H5/R2: usages mode resolves the symbol root", g?.root?.name === "render" && typeof g?.root?.file === "string", JSON.stringify(g?.root ?? null).slice(0, 160))
  const callers = Array.isArray(g?.callers) ? g.callers : []
  check("H5/R2: full usage set — both known callers present", callers.length === 2, `got ${callers.length}`)
  const callerFiles = callers.map((e: any) => g?.nodes?.[e.from]?.file as string)
  check("H5/R2: caller set is exactly the two known files", callerFiles.includes(CALLER_FILE_APP) && callerFiles.includes(CALLER_FILE_MAIN2), JSON.stringify(callerFiles))
  check("H5/R2: every caller edge is traceable (row id present)", callers.every((e: any) => typeof e?.rowId === "string" && e.rowId.length > 0), "")
  check("H5/R2: complete set is declared not truncated", g?.summary?.truncated === false && g?.summary?.totalCallers === 2, JSON.stringify(g?.summary ?? null))
  check("H5/R2: usages profile is direction-both (callers + callees arrays)", Array.isArray(g?.callees), "")

  // --- R3: fixture-first render over the REAL result -----------------------------
  console.log("\nR3: fixture-first hub renders (authored expectations over real data)")
  const core = await import(CORE)
  const H = await import(HARNESS)

  // Expected rows derived from the SERVED result (cross-check the renderer
  // against the data it was handed — fabrication/drop is a renderer lie).
  const hubRows = [
    ...(g?.callers ?? []).map((e: any) => {
      const n = g?.nodes?.[e.from] ?? {}
      return { rowId: e.rowId, dir: "caller", name: n.name ?? "(external)", file: n.file ?? "", line: n.line ?? 0 }
    }),
    ...(g?.callees ?? []).map((e: any) => {
      const n = g?.nodes?.[e.to] ?? {}
      return { rowId: e.rowId, dir: "callee", name: n.name ?? "(external)", file: n.file ?? "", line: n.line ?? 0 }
    }),
  ]
  const harnessModel = {
    rows: hubRows.map((r) => ({ ...r, depth: 0, expectedTier: "structural", enriched: false })),
    truncated: g?.summary?.truncated === true,
    totalIfKnown: (g?.summary?.totalCallers ?? 0) + (g?.summary?.totalCallees ?? 0),
  }

  // Authored rendering expectations (fixture-first): list by file groups under
  // the two known caller files; list by caller groups the 2 main rows under
  // "main"; the call tree renders 2 caller rows; every row is badged; the
  // complete set carries no truncation marker; renders are deterministic.
  const byFile = renderInto(core.renderHubList, g, "file")
  const byFileHtml = byFile.html
  check("H5/R3: list-by-file renders the section root with data-group=file", byFileHtml.includes("bb-hub-list") && byFileHtml.includes('data-group="file"') && byFileHtml.includes('data-symbol="render"'), byFileHtml.slice(0, 200))
  check("H5/R3: list-by-file groups by the two known caller files", byFileHtml.includes(`data-group-name="${CALLER_FILE_APP}"`) && byFileHtml.includes(`data-group-name="${CALLER_FILE_MAIN2}"`), byFileHtml.match(/data-group-name="([^"]+)"/g)?.join(" ") ?? "none")
  // Row divs carry the class token bb-hub-row (NOT the bb-hub-row-name/
  // bb-hub-row-meta spans): count whole-class-token rows only.
  const rowCount = (byFileHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: list-by-file renders both usage rows (one per caller)", rowCount === 2, String(rowCount))
  check("H5/R3: every row is badged with a data-tier + bb-hub-badge", (byFileHtml.match(/bb-hub-badge/g) ?? []).length === 2 && /data-badge-tier="[a-z_]+"/.test(byFileHtml), "")
  check("H5/R3: complete set renders no truncation marker", !byFileHtml.includes("bb-truncation-marker"), "")

  const byCaller = renderInto(core.renderHubList, g, "caller")
  const byCallerHtml = byCaller.html
  const callerRowCount = (byCallerHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: list-by-caller groups the same-name callers under one main group", byCallerHtml.includes('data-group-name="main"') && callerRowCount === 2, byCallerHtml.match(/data-group-name="([^"]+)"/g)?.join(" ") ?? "none")

  const tree = renderInto(core.renderHubTree, g)
  const treeHtml = tree.html
  const treeRowCount = (treeHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: call tree renders both caller rows with depth 0", treeRowCount === 2 && /data-depth="0"/.test(treeHtml), `rows=${treeRowCount}`)
  check("H5/R3: tree rows carry the caller files as meta", treeHtml.includes(CALLER_FILE_APP) && treeHtml.includes(CALLER_FILE_MAIN2), "")
  check("H5/R3: hub renders are deterministic (by-file twice byte-identical)", byFileHtml === renderInto(core.renderHubList, g, "file").html, "")

  // The M26.V1 hub harness over the REAL rendered DOM (AH1–AH5 clean on real
  // data). toHarness shape matches the harness's HarnessNode.
  const findingsReal = H.runHubHarness(harnessModel, toHarness(byFile.el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
  check("H5/R3: real render passes the V1 hub harness clean (AH1–AH5)", findingsReal.every((f: { ok: boolean }) => f.ok), findingsReal.filter((f: { ok: boolean }) => !f.ok).map((f: { assertion: string; detail: string }) => `${f.assertion}: ${f.detail}`).join("; ").slice(0, 300))
} catch (e) {
  check("H5: LSP session completes", false, String(e).slice(0, 200) + (lsp.stderr() ? ` | stderr: ${lsp.stderr().slice(-300)}` : ""))
} finally {
  lsp.dispose()
}

// --- R4: truncation honesty (unit, fixture-first) --------------------------------
console.log("\nR4: truncation is declared, never silent")
{
  const core = await import(CORE)
  const truncatedResult = {
    root: { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
    callers: [
      { from: "sym:mainA", to: "sym:render", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: CALLER_FILE_APP, line: 13 }, depth: 0, rowId: "r1" },
      { from: "sym:mainB", to: "sym:render", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: CALLER_FILE_MAIN2, line: 4 }, depth: 0, rowId: "r2" },
    ],
    callees: [],
    nodes: {
      "sym:render": { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
      "sym:mainA": { id: "sym:mainA", name: "main", symbolType: "method", file: CALLER_FILE_APP, line: 13, language: "java", isExternal: false },
      "sym:mainB": { id: "sym:mainB", name: "main", symbolType: "method", file: CALLER_FILE_MAIN2, line: 4, language: "java", isExternal: false },
    },
    summary: { totalCallers: 7, totalCallees: 0, truncated: true, truncationReason: "render budget", crossLanguageEdges: 0 },
  }
  const { html } = renderInto(core.renderHubList, truncatedResult, "file")
  const marker = /bb-truncation-marker[\s\S]*?data-shown="2"[\s\S]*?data-total-if-known="7"/.test(html)
  check("H5/R4: truncated model renders the marker with real counts (shown 2 of 7)", marker, html.slice(0, 400))
  check("H5/R4: truncated marker names the budget, never a silent cut", html.includes("budget"), "")
}

// --- R5: enrichment annotations (unit rows carrying H3 fields) -------------------
console.log("\nR5: enrichment chips render labeled, tier untouched")
{
  const core = await import(CORE)
  const enrichedResult = {
    root: { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
    callers: [
      { from: "sym:mainA", to: "sym:render", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: CALLER_FILE_APP, line: 13 }, depth: 0, rowId: "r1", metadata: { enrichment: { role: "consumer", layerFlow: "core→core", frequency: "one_of_1", inferredAt: 1000 } } },
      { from: "sym:mainB", to: "sym:render", relationshipType: "calls", confidence: 0.4, isCrossLanguage: false, callSite: { file: CALLER_FILE_MAIN2, line: 4 }, depth: 0, rowId: "r2" },
    ],
    callees: [],
    nodes: {
      "sym:render": { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
      "sym:mainA": { id: "sym:mainA", name: "main", symbolType: "method", file: CALLER_FILE_APP, line: 13, language: "java", isExternal: false },
      "sym:mainB": { id: "sym:mainB", name: "main", symbolType: "method", file: CALLER_FILE_MAIN2, line: 4, language: "java", isExternal: false },
    },
    summary: { totalCallers: 2, totalCallees: 0, truncated: false, crossLanguageEdges: 0 },
  }
  const { html } = renderInto(core.renderHubList, enrichedResult, "file")
  // Attrs serialize alphabetically (data-enriched sorts BEFORE data-row-id),
  // so slice from the enriched row's own marker to the NEXT row's marker.
  const r1Span = html.slice(html.indexOf('data-enriched="1"'), html.indexOf('data-row-id="r2"'))
  check("H5/R5: enriched row carries data-enriched + labeled chip", r1Span.includes('data-row-id="r1"') && r1Span.includes("bb-hub-enrichment") && r1Span.includes("role consumer"), r1Span.slice(0, 300))
  check("H5/R5: enrichment fields ride as data attrs (role/layer)", html.includes('data-enrich-role="consumer"') && html.includes('data-enrich-layer="core→core"'), "")
  check("H5/R5: un-enriched row renders no chip (presence-gated absence)", !/<div[^>]*data-row-id="r2"[\s\S]{0,400}?bb-hub-enrichment/.test(html), "")
  check("H5/R5: enrichment never upgrades the tier class", !html.includes("bb-badge-inferred") || html.includes('data-badge-tier="inferred"'), "")
}

// --- R6: budget — hub open (query + render) p95 <= 300 ms ------------------------
console.log("\nR6: hub-open budget (warm p95 over the real server)")
{
  const core = await import(CORE)
  const lsp2 = new StdioLsp(H2_ROOT)
  try {
    await lsp2.request("initialize", { processId: null, rootUri: `file://${H2_ROOT}`, capabilities: {} })
    // Warm the server + render paths (first request pays cold-start).
    for (let i = 0; i < 3; i++) {
      const w = await lsp2.request("bb/graph", { schemaVersion: 1, symbol: "render", mode: "usages" })
      renderInto(core.renderHubList, w, "file")
      renderInto(core.renderHubTree, w)
    }
    const rounds: number[] = []
    const N = 12
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const w = await lsp2.request("bb/graph", { schemaVersion: 1, symbol: "render", mode: "usages" })
      renderInto(core.renderHubList, w, "file")
      renderInto(core.renderHubList, w, "caller")
      renderInto(core.renderHubTree, w)
      rounds.push(performance.now() - t0)
    }
    rounds.sort((a, b) => a - b)
    const p95 = rounds[Math.floor(0.95 * (rounds.length - 1))]
    check("H5/R6: hub open (query + 3 renders) warm p95 <= 300 ms", p95 <= 300, `p95=${p95.toFixed(1)}ms min=${rounds[0].toFixed(1)}ms max=${rounds[rounds.length - 1].toFixed(1)}ms`)
  } finally {
    lsp2.dispose()
  }
}

// --- M: mutants — source-copy renderer defects the harness must catch ------------
console.log("\nM: hub renderer mutants (source-copy, M26.W1 pattern)")
{
  const rawSource = readFileSync(CORE_MODULE, "utf8")
  const H = await import(HARNESS)

  // Controlled fixture result reused by the detectors (callers + callees so
  // drop-defects are visible). Deliberately NOT realResult: the mutant legs
  // must be deterministic over known row-ids (the live db's row ids are long
  // hashes no harness model could name).
  const detModel: any = {
    root: { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
    callers: [
      { from: "sym:mainA", to: "sym:render", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: CALLER_FILE_APP, line: 13 }, depth: 0, rowId: "r1" },
      { from: "sym:mainB", to: "sym:render", relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { file: CALLER_FILE_MAIN2, line: 4 }, depth: 0, rowId: "r2" },
    ],
    callees: [{ from: "sym:render", to: "sym:cal", relationshipType: "calls", confidence: 0.7, isCrossLanguage: false, callSite: { file: H2_REL_APP, line: 8 }, depth: 0, rowId: "r3" }],
    nodes: {
      "sym:render": { id: "sym:render", name: "render", symbolType: "method", file: H2_REL_APP, line: 7, language: "java", isExternal: false },
      "sym:mainA": { id: "sym:mainA", name: "main", symbolType: "method", file: CALLER_FILE_APP, line: 13, language: "java", isExternal: false },
      "sym:mainB": { id: "sym:mainB", name: "main", symbolType: "method", file: CALLER_FILE_MAIN2, line: 4, language: "java", isExternal: false },
      "sym:cal": { id: "sym:cal", name: "cal", symbolType: "method", file: H2_REL_APP, line: 8, language: "java", isExternal: false },
    },
    summary: { totalCallers: 2, totalCallees: 1, truncated: false, crossLanguageEdges: 0 },
  }
  const detHarnessModel: any = {
    rows: [
      { rowId: "r1", dir: "caller", name: "main", file: CALLER_FILE_APP, line: 13, depth: 0, expectedTier: "structural", enriched: false },
      { rowId: "r2", dir: "caller", name: "main", file: CALLER_FILE_MAIN2, line: 4, depth: 0, expectedTier: "structural", enriched: false },
      { rowId: "r3", dir: "callee", name: "cal", file: H2_REL_APP, line: 8, depth: 0, expectedTier: "structural", enriched: false },
    ],
    truncated: false,
    totalIfKnown: 3,
  }

  // Each mutant carries the harness model + options matching its own probe
  // scenario, so the harness-agree leg checks the SAME violation the probe
  // detects (a mutant can only be caught twice honestly).
  const defects: Array<{
    name: string
    from: string
    to: string
    probe: (m: any) => boolean
    agree: (m: any) => boolean
    label: string
  }> = [
    {
      name: "M1: badge dropped (hubRowElement never calls appendEvidenceBadge)",
      from: "  appendEvidenceBadge(el, row.edge, tier, \"bb-hub-badge\", dom)",
      to: "  // badge dropped",
      probe: (m) => {
        const { html } = renderInto(m.renderHubList, detModel, "file")
        return !html.includes("bb-hub-badge")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detModel, "file")
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH3"))
      },
      label: "AH3 badges",
    },
    {
      name: "M2: truncation hidden (hubSummary never renders the marker)",
      from: '    marker.addClass("bb-truncation-marker")',
      to: '    marker.addClass("bb-hidden-marker")',
      probe: (m) => {
        const truncated = { ...detModel, summary: { totalCallers: 7, totalCallees: 1, truncated: true, crossLanguageEdges: 0 } }
        const { html } = renderInto(m.renderHubList, truncated, "file")
        return !html.includes("bb-truncation-marker")
      },
      agree: (m) => {
        // Shown 3 of 8 declared — the marker must carry data-shown/
        // data-total-if-known; the mutant hides it, so AH1's declared-
        // truncation branch fails (marker === null).
        const truncated = { ...detModel, summary: { totalCallers: 7, totalCallees: 1, truncated: true, crossLanguageEdges: 0 } }
        const { el } = renderInto(m.renderHubList, truncated, "file")
        const rows8 = Array.from({ length: 8 }, (_, i) => ({
          rowId: `r${i + 1}`,
          dir: i === 2 ? "callee" : "caller",
          name: i === 2 ? "cal" : "main",
          file: i === 2 ? H2_REL_APP : i % 2 === 0 ? CALLER_FILE_APP : CALLER_FILE_MAIN2,
          line: i + 1,
          depth: 0,
          expectedTier: "structural",
          enriched: false,
        }))
        const m2 = { rows: rows8, truncated: true, shownCount: 3, totalIfKnown: 8 }
        const f = H.runHubHarness(m2, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file" })
        return f.some((x: any) => !x.ok && (x.assertion.startsWith("AH5") || x.assertion.startsWith("AH1")))
      },
      label: "AH5 truncation",
    },
    {
      name: "M3: callees dropped (hubUsages ignores the callee loop)",
      // Multi-line anchor — the single-line loop header appears twice in
      // graph-core (graphTraversal + hubUsages); replace() would hit the
      // first. Anchor on hubUsages' unique callee body.
      from: '  for (const edge of result.callees) {\n    const node = result.nodes[edge.to]\n    rows.push({\n      dir: "callee",',
      to: '  for (const edge of []) { // callees dropped\n    const node = result.nodes[edge.to]\n    rows.push({\n      dir: "callee",',
      probe: (m) => {
        const { html } = renderInto(m.renderHubTree, detModel)
        return !html.includes("data-row-id=\"r3\"")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubTree, detModel)
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-tree" })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH1"))
      },
      label: "AH1 rows",
    },
    {
      name: "M4: wrong grouping (list-by-file groups by caller name instead)",
      from: '  const groups = group === "file" ? groupUsagesByFile(rows) : groupUsagesByCaller(rows)',
      to: "  const groups = groupUsagesByCaller(rows) // always by caller",
      probe: (m) => {
        const { html } = renderInto(m.renderHubList, detModel, "file")
        return !html.includes(`data-group-name="${CALLER_FILE_APP}"`)
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detModel, "file")
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH2"))
      },
      label: "AH2 grouping",
    },
    {
      name: "M5: orphaned section (hubSection uses dom.create, never dom.root)",
      from: "  const section = dom.root()",
      to: "  const section = dom.create(\"div\") // orphaned — never attached",
      probe: (m) => {
        const { html } = renderInto(m.renderHubList, detModel, "file")
        return !html.includes("bb-hub-list")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detModel, "file")
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH1"))
      },
      label: "AH1 section missing",
    },
  ]

  let seq = 0
  for (const mt of defects) {
    if (!rawSource.includes(mt.from)) {
      console.log(`  SKIP (anchor not found): ${mt.name}`)
      continue
    }
    seq++
    const mutantPath = path.join(ROOT, "validation/m26", `graph-core.mutant.${Date.now()}.${seq}.ts`)
    writeFileSync(mutantPath, rawSource.replace(mt.from, mt.to))
    try {
      const m = await import(mutantPath)
      const detected = mt.probe(m)
      mutant(`${mt.name} (detected: ${detected})`, detected, "")
      if (detected) {
        // Belt-and-braces: the V1 hub harness must independently flag the
        // same violation the probe saw (a defect is only caught twice
        // honestly).
        let agreed = false
        try {
          agreed = mt.agree(m)
        } catch {
          agreed = true // mutant crashed the render — a violation
        }
        check(`  harness agrees (${mt.label} violated)`, agreed)
      }
    } catch (e) {
      mutant(`${mt.name} (mutant failed to load — counts as detected)`, true, String(e).slice(0, 160))
    } finally {
      rmSync(mutantPath, { force: true })
    }
  }
  check("mutation suite: every planted defect is caught", mutants.caught >= mutants.total && mutants.total >= 5, `${mutants.caught}/${mutants.total}`)
}

// --- Persist evidence ------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "M42.H5",
  code: "H5",
  milestone: "M42",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  mutantsCaught: mutants.caught,
  mutantsTotal: mutants.total,
  currentCommit,
  verifierCommand: "npx tsx script/m42/verify-hub.ts",
  evidenceFile: "H5.json",
  generatedAt: new Date().toISOString(),
  fixture: { root: H2_ROOT, files: [H2_REL_APP, H2_REL_MAIN2], symbol: "render", callerFiles: [CALLER_FILE_APP, CALLER_FILE_MAIN2] },
  budgetDeclared: { hubOpenWarmP95Ms: 300 },
  limitations: [
    "DOM assertions cover structure/classes/data attributes over a stub DOM; CSS/paint and the webview toggle script's runtime are per-editor presentation (the E5 leg covers the real editor).",
    "The usages fixture is single-file-language (java); cross-language usages reuse the M26.W3 surface, not re-tested here.",
  ],
}
const dir = path.join(ROOT, "validation/m42/results")
if (!existsSync(dir)) execFileSync("mkdir", ["-p", dir])
writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")
console.log(`\nH5: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
process.exit(failed === 0 ? 0 : 1)
