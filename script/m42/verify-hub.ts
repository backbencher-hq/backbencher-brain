// script/m42/verify-hub.ts — M42.H5 verifier + mutation suite (issue #653),
// re-verified under M44.U1 (issue #688) for the GROUPED usages shape.
//
// "The hub — usages as list/tree over bb/graph". Fixture-first: the authored
// expectations below describe what a real index + the ONE renderer core must
// produce for a known symbol; the suite then proves it against a REAL
// freshly-indexed fixture through the REAL dist server, and proves the suite
// CAN FAIL by planting renderer defects (source-copy mutants, the M26.W1
// pattern) that the M26.V1 webview harness must catch.
//
// M44.U1: bb/graph usages mode (schemaVersion 2) serves ONE GROUP per
// caller/callee SYMBOL with declared per-type occurrence counts and every
// stored row's id in the group inventory — the hub list renders those
// groups, so two call sites from the same symbol can never render as two
// repeated rows (Understanding Rules §13.1/§13.2).
//
//   R1 indexed:      the h2 fixture (2 java files, main→render in both) is
//                    indexed by the REAL indexer.
//   R2 usages mode:  bb/graph {schemaVersion:2, mode:"usages"} over the real
//                    server returns the grouped shape: 2 caller GROUPS (the
//                    two main symbols — each once), full declared
//                    multiplicity, traceable row ids, not truncated.
//   R3 fixture-first: the REAL result rendered through renderHubList (by
//                    file + by caller) and renderHubTree satisfies the
//                    authored expectations AND the M26.V1 hub harness
//                    (AH1–AH5 clean on real data — no fabrication, no drop,
//                    correct grouping, chips, deterministic renders).
//   R4 truncation:   a truncated grouped model renders the declared marker
//                    with real shown counts; a complete model renders none.
//   R5 enrichment:   an enriched GROUP renders the labeled chip (H3 fields),
//                    presence-gated; never a tier change.
//   R6 budget:       hub open (usages query + all three renders) warm p95
//                    <= 300 ms — the G1-declared hub budget.
//   M1–M5 mutants:   source-copy defects (chips dropped, truncation hidden,
//                    callees dropped, wrong grouping, orphaned section) are
//                    all caught by the harness.
//
// Evidence: validation/m42/results/H5.json (machine-emitted).

import { execFileSync } from "node:child_process"
import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { H2_FILE_APP, H2_REL_APP, H2_REL_MAIN2, H2_ROOT, writeH2Fixture } from "./h2-fixture.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE = path.join(ROOT, "validation/m42/results/H5.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const BB = path.join(ROOT, "bin/bb")
const CORE_MODULE = path.join(ROOT, "script/m26/graph-core.ts")
const HARNESS = path.join(ROOT, "script/m26/webview-harness.ts")

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
// App.java AND main in Main2.java both call render — the grouped hub must show
// BOTH as distinct symbol groups (one per symbol, never repeated rows), each
// grouped under its own file.
const CALLER_FILE_APP = H2_REL_APP // src/main/java/com/demo/App.java
const CALLER_FILE_MAIN2 = H2_REL_MAIN2 // src/main/java/com/demo/Main2.java

const lsp = new StdioLsp(H2_ROOT)
let realResult: any = null
try {
  const init = await lsp.request("initialize", { processId: null, rootUri: `file://${H2_ROOT}`, capabilities: {} })
  check("H5/R2: server advertises graphProvider", init?.capabilities?.graphProvider !== undefined, "")

  // --- R2: usages mode over the real server ------------------------------------
  console.log("\nR2: bb/graph usages mode — grouped shape (real server, real index)")
  const g = await lsp.request("bb/graph", { schemaVersion: 2, symbol: "render", mode: "usages" })
  realResult = g
  check("H5/R2: usages mode resolves the symbol root", g?.root?.name === "render" && typeof g?.root?.file === "string", JSON.stringify(g?.root ?? null).slice(0, 160))
  const callerGroups = Array.isArray(g?.callers) ? g.callers : []
  check("H5/R2: grouped — exactly TWO caller groups (one per symbol)", callerGroups.length === 2, `got ${callerGroups.length}`)
  const callerFiles = callerGroups.map((grp: any) => grp.file as string)
  check("H5/R2: caller groups cover the two known files", callerFiles.includes(CALLER_FILE_APP) && callerFiles.includes(CALLER_FILE_MAIN2), JSON.stringify(callerFiles))
  const repeatedSymbol = callerGroups.map((grp: any) => grp.symbolId).filter((id: string, i: number, a: string[]) => a.indexOf(id) !== i)
  check("H5/R2: no symbol repeats across caller groups (§13.1)", repeatedSymbol.length === 0, JSON.stringify(repeatedSymbol))
  check("H5/R2: every group declares multiplicity (occurrences == rows.length)", callerGroups.every((grp: any) => grp.occurrences === grp.rows.length && grp.rows.length > 0), "")
  check("H5/R2: every row is traceable (row id present in the group inventory)", callerGroups.every((grp: any) => grp.rows.every((r: any) => typeof r?.rowId === "string" && r.rowId.length > 0)), "")
  check("H5/R2: per-type counts sum to the group multiplicity", callerGroups.every((grp: any) => grp.relationshipTypes.reduce((n: number, t: any) => n + t.occurrences, 0) === grp.rows.length), "")
  check("H5/R2: complete set is declared not truncated", g?.summary?.truncated === false, JSON.stringify(g?.summary ?? null))
  check("H5/R2: header counts count GROUPS (§13.4)", g?.counts?.callerGroups === 2 && g?.counts?.callerRows === callerGroups.reduce((n: number, grp: any) => n + grp.rows.length, 0), JSON.stringify(g?.counts ?? null))

  // --- R3: fixture-first render over the REAL result -----------------------------
  console.log("\nR3: fixture-first hub renders (authored expectations over real data)")
  const core = await import(CORE_MODULE)
  const H = await import(HARNESS)

  const groupRowsFor = (grp: any, dir: string) =>
    grp?.rows?.map((r: any) => ({
      rowId: r.rowId,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
      depth: r.depth ?? 0,
      evidenceClass: r.evidenceClass,
      enrichment: r.enrichment,
    })) ?? []
  const tierOfRows = (rows: any[]): string => {
    const tiers = new Set(rows.map((r: any) => core.tierForEdge({ relationshipType: r.relationshipType, confidence: r.confidence, metadata: { evidenceClass: r.evidenceClass } })))
    return tiers.size === 1 ? [...tiers][0] : "mixed"
  }
  // Harness model derived from the SERVED grouped result — cross-check the
  // renderer against the data it was handed (fabrication/drop is a renderer lie).
  const harnessModel = {
    rows: [
      ...(g?.callers ?? []).map((grp: any) => ({
        symbolId: grp.symbolId,
        dir: "caller",
        name: grp.name,
        file: grp.file,
        line: grp.line,
        rowIds: grp.rows.map((r: any) => r.rowId),
        types: grp.relationshipTypes.map((t: any) => ({
          type: t.type,
          occurrences: t.occurrences,
          tier: tierOfRows(groupRowsFor(grp, "caller").filter((r: any) => r.relationshipType === t.type)),
        })),
        enriched: grp.rows.some((r: any) => r.enrichment?.inferredAt !== undefined),
      })),
      ...(g?.callees ?? []).map((grp: any) => ({
        symbolId: grp.symbolId,
        dir: "callee",
        name: grp.name,
        file: grp.file,
        line: grp.line,
        rowIds: grp.rows.map((r: any) => r.rowId),
        types: grp.relationshipTypes.map((t: any) => ({
          type: t.type,
          occurrences: t.occurrences,
          tier: tierOfRows(groupRowsFor(grp, "callee").filter((r: any) => r.relationshipType === t.type)),
        })),
        enriched: grp.rows.some((r: any) => r.enrichment?.inferredAt !== undefined),
      })),
    ],
    truncated: g?.summary?.truncated === true,
    totalIfKnown: null,
  }

  const byFile = renderInto(core.renderHubList, g, "file")
  const byFileHtml = byFile.html
  check("H5/R3: list-by-file renders the section root with data-group=file", byFileHtml.includes("bb-hub-list") && byFileHtml.includes('data-group="file"') && byFileHtml.includes('data-symbol="render"'), byFileHtml.slice(0, 200))
  check("H5/R3: list-by-file groups under the two known caller files", byFileHtml.includes(`data-group-name="${CALLER_FILE_APP}"`) && byFileHtml.includes(`data-group-name="${CALLER_FILE_MAIN2}"`), byFileHtml.match(/data-group-name="([^"]+)"/g)?.join(" ") ?? "none")
  const rowCount = (byFileHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: list-by-file renders TWO symbol rows (never a repeated row per caller)", rowCount === 2, String(rowCount))
  check("H5/R3: each symbol row declares its multiplicity + row inventory", (byFileHtml.match(/data-occurrences="1"/g) ?? []).length >= 2 && (byFileHtml.match(/data-row-ids="[^"]+"/g) ?? []).length === 2, "")
  check("H5/R3: each symbol row renders relationship-type chips with tiers", (byFileHtml.match(/bb-hub-relchip/g) ?? []).length >= 2 && /data-tier="[a-z_]+"/.test(byFileHtml), "")
  check("H5/R3: complete set renders no truncation marker", !byFileHtml.includes("bb-truncation-marker"), "")

  const byCaller = renderInto(core.renderHubList, g, "caller")
  const byCallerHtml = byCaller.html
  const callerRowCount = (byCallerHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: list-by-caller renders the two distinct main symbols once each (name collides, identity doesn't)", byCallerHtml.includes('data-group-name="main"') && callerRowCount === 2, byCallerHtml.match(/data-group-name="([^"]+)"/g)?.join(" ") ?? "none")

  const tree = renderInto(core.renderHubTree, g)
  const treeHtml = tree.html
  const treeRowCount = (treeHtml.match(/class="bb-hub-row(?:\s|")/g) ?? []).length
  check("H5/R3: call tree renders both caller groups with a declared depth", treeRowCount === 2 && /data-depth="0"/.test(treeHtml), `rows=${treeRowCount}`)
  check("H5/R3: tree rows carry the caller files as meta", treeHtml.includes(CALLER_FILE_APP) && treeHtml.includes(CALLER_FILE_MAIN2), "")
  check("H5/R3: hub renders are deterministic (by-file twice byte-identical)", byFileHtml === renderInto(core.renderHubList, g, "file").html, "")

  // The M26.V1 hub harness over the REAL rendered DOM (AH1–AH5 clean on real
  // data, grouped semantics). toHarness shape matches the harness's HarnessNode.
  const findingsReal = H.runHubHarness(harnessModel, toHarness(byFile.el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
  check("H5/R3: real render passes the V1 hub harness clean (AH1–AH5, grouped)", findingsReal.every((f: { ok: boolean }) => f.ok), findingsReal.filter((f: { ok: boolean }) => !f.ok).map((f: { assertion: string; detail: string }) => `${f.assertion}: ${f.detail}`).join("; ").slice(0, 300))
} catch (e) {
  check("H5: LSP session completes", false, String(e).slice(0, 200) + (lsp.stderr() ? ` | stderr: ${lsp.stderr().slice(-300)}` : ""))
} finally {
  lsp.dispose()
}

// --- R4: truncation honesty (unit, fixture-first, grouped) ------------------------
console.log("\nR4: truncation is declared, never silent")
{
  const core = await import(CORE_MODULE)
  const truncatedGrouped = {
    root: { symbolId: "sym:render", name: "render", file: H2_REL_APP, language: "java", line: 7 },
    callers: [
      { symbolId: "sym:mainA", name: "main", file: CALLER_FILE_APP, language: "java", symbolType: "method", line: 13, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 2 }], occurrences: 2, rows: [{ rowId: "r1", relationshipType: "calls", depth: 0, confidence: 0.9 }, { rowId: "r2", relationshipType: "calls", depth: 0, confidence: 0.9 }] },
      { symbolId: "sym:mainB", name: "main", file: CALLER_FILE_MAIN2, language: "java", symbolType: "method", line: 4, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "r3", relationshipType: "calls", depth: 0, confidence: 0.9 }] },
    ],
    callees: [],
    fileLevel: { imports: [], exports: [] },
    counts: { callerGroups: 2, calleeGroups: 0, callerRows: 3, calleeRows: 0, fileLevelRows: 0 },
    summary: { truncated: true, truncationReason: "render budget", crossLanguageGroups: 0 },
  }
  const { html } = renderInto(core.renderHubList, truncatedGrouped, "file")
  const marker = /bb-truncation-marker[\s\S]*?data-shown="2"[\s\S]*?data-total-if-known="unknown"/.test(html)
  check("H5/R4: truncated grouped model renders the marker with shown count + declared-unknown total", marker, html.slice(0, 400))
  check("H5/R4: truncated marker names the budget, never a silent cut", html.includes("truncated"), "")
}

// --- R5: enrichment annotations (group-level, presence-gated) -------------------
console.log("\nR5: enrichment chips render labeled, tier untouched")
{
  const core = await import(CORE_MODULE)
  const enrichedGrouped = {
    root: { symbolId: "sym:render", name: "render", file: H2_REL_APP, language: "java", line: 7 },
    callers: [
      {
        symbolId: "sym:mainA",
        name: "main",
        file: CALLER_FILE_APP,
        language: "java",
        symbolType: "method",
        line: 13,
        isExternal: false,
        relationshipTypes: [{ type: "calls", occurrences: 2 }],
        occurrences: 2,
        rows: [
          { rowId: "r1", relationshipType: "calls", depth: 0, confidence: 0.9, enrichment: { role: "consumer", layerFlow: "core→core", frequency: "one_of_1", inferredAt: 1000 } },
          { rowId: "r2", relationshipType: "calls", depth: 0, confidence: 0.9 },
        ],
      },
      { symbolId: "sym:mainB", name: "main", file: CALLER_FILE_MAIN2, language: "java", symbolType: "method", line: 4, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "r3", relationshipType: "calls", depth: 0, confidence: 0.9 }] },
    ],
    callees: [],
    fileLevel: { imports: [], exports: [] },
    counts: { callerGroups: 2, calleeGroups: 0, callerRows: 3, calleeRows: 0, fileLevelRows: 0 },
    summary: { truncated: false, crossLanguageGroups: 0 },
  }
  const { html } = renderInto(core.renderHubList, enrichedGrouped, "file")
  // Rows serialize with alphabetically-sorted attrs, so data-enriched precedes
  // data-symbol-id — anchor the slice at the row's opening div, not its id.
  // No trailing quote: an enriched row carries extra classes after bb-hub-symrow.
  const divMarker = '<div class="bb-hub-row bb-hub-symrow'
  const r1Row = html.slice(html.lastIndexOf(divMarker, html.indexOf('data-symbol-id="sym:mainA"')), html.lastIndexOf(divMarker, html.indexOf('data-symbol-id="sym:mainB"')))
  check("H5/R5: enriched group carries data-enriched + labeled chip", r1Row.includes('data-enriched="1"') && r1Row.includes("bb-hub-enrichment") && r1Row.includes("enriched"), r1Row.slice(0, 300))
  check("H5/R5: enrichment roles ride as data attrs", html.includes('data-enrich-roles="consumer"'), "")
  check("H5/R5: un-enriched group renders no chip (presence-gated absence)", !/<div[^>]*data-symbol-id="sym:mainB"[^>]*data-enriched="1"/.test(html), "")

  const { html: treeHtml } = renderInto(core.renderHubTree, enrichedGrouped)
  const r1InTree = treeHtml.slice(treeHtml.lastIndexOf(divMarker, treeHtml.indexOf('data-symbol-id="sym:mainA"')), treeHtml.lastIndexOf(divMarker, treeHtml.indexOf('data-symbol-id="sym:mainB"')))
  check("H5/R5: enriched group in the tree view also labels (never only the list)", r1InTree.includes('data-enriched="1"') && r1InTree.includes("bb-hub-enrichment"), "")
}

// --- R6: budget — hub open (query + render) p95 <= 300 ms ------------------------
console.log("\nR6: hub-open budget (warm p95 over the real server)")
{
  const core = await import(CORE_MODULE)
  const lsp2 = new StdioLsp(H2_ROOT)
  try {
    await lsp2.request("initialize", { processId: null, rootUri: `file://${H2_ROOT}`, capabilities: {} })
    for (let i = 0; i < 3; i++) {
      const w = await lsp2.request("bb/graph", { schemaVersion: 2, symbol: "render", mode: "usages" })
      renderInto(core.renderHubList, w, "file")
      renderInto(core.renderHubTree, w)
    }
    const rounds: number[] = []
    const N = 12
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const w = await lsp2.request("bb/graph", { schemaVersion: 2, symbol: "render", mode: "usages" })
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

  // Deterministic grouped fixture reused by the detectors (callers + callees
  // so drop-defects are visible). NOT realResult: the mutant legs must be
  // deterministic over known row-ids.
  const detGrouped: any = {
    root: { symbolId: "sym:render", name: "render", file: H2_REL_APP, language: "java", line: 7 },
    callers: [
      { symbolId: "sym:mainA", name: "main", file: CALLER_FILE_APP, language: "java", symbolType: "method", line: 13, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "r1", relationshipType: "calls", depth: 0, confidence: 0.9 }] },
      { symbolId: "sym:mainB", name: "main", file: CALLER_FILE_MAIN2, language: "java", symbolType: "method", line: 4, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "r2", relationshipType: "calls", depth: 0, confidence: 0.9 }] },
    ],
    callees: [{ symbolId: "sym:cal", name: "cal", file: H2_REL_APP, language: "java", symbolType: "method", line: 8, isExternal: false, relationshipTypes: [{ type: "calls", occurrences: 1 }], occurrences: 1, rows: [{ rowId: "r3", relationshipType: "calls", depth: 0, confidence: 0.9 }] }],
    fileLevel: { imports: [], exports: [] },
    counts: { callerGroups: 2, calleeGroups: 1, callerRows: 2, calleeRows: 1, fileLevelRows: 0 },
    summary: { truncated: false, crossLanguageGroups: 0 },
  }
  const detHarnessModel: any = {
    rows: [
      { symbolId: "sym:mainA", dir: "caller", name: "main", file: CALLER_FILE_APP, line: 13, rowIds: ["r1"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false },
      { symbolId: "sym:mainB", dir: "caller", name: "main", file: CALLER_FILE_MAIN2, line: 4, rowIds: ["r2"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false },
      { symbolId: "sym:cal", dir: "callee", name: "cal", file: H2_REL_APP, line: 8, rowIds: ["r3"], types: [{ type: "calls", occurrences: 1, tier: "structural" }], enriched: false },
    ],
    truncated: false,
    totalIfKnown: null,
  }

  const defects: Array<{
    name: string
    from: string
    to: string
    probe: (m: any) => boolean
    agree: (m: any) => boolean
    label: string
  }> = [
    {
      name: "M1: type chips dropped (groupRow never calls relChips)",
      from: "  relChips(entry, el, dom)",
      to: "  // type chips dropped",
      probe: (m) => {
        const { html } = renderInto(m.renderHubList, detGrouped, "file")
        return !html.includes("bb-hub-relchip")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detGrouped, "file")
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH3"))
      },
      label: "AH3 chips",
    },
    {
      name: "M2: truncation hidden (hubSummary never renders the marker)",
      from: '    marker.addClass("bb-truncation-marker")',
      to: '    marker.addClass("bb-hidden-marker")',
      probe: (m) => {
        const truncated = { ...detGrouped, summary: { truncated: true, truncationReason: "render budget", crossLanguageGroups: 0 } }
        const { html } = renderInto(m.renderHubList, truncated, "file")
        return !html.includes("bb-truncation-marker")
      },
      agree: (m) => {
        const truncated = { ...detGrouped, summary: { truncated: true, truncationReason: "render budget", crossLanguageGroups: 0 } }
        const { el } = renderInto(m.renderHubList, truncated, "file")
        const f = H.runHubHarness({ ...detHarnessModel, truncated: true, shownCount: 2, totalIfKnown: null }, toHarness(el) as never, { sectionClass: "bb-hub-list", group: "file" })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH5"))
      },
      label: "AH5 truncation",
    },
    {
      name: "M3: callees dropped (treeSideInto never emits the callee side)",
      from: "  treeSideInto(callees, grouped.root.symbolId, section, dom, calleeKids, rowsRendered)",
      to: "  // callee side dropped",
      probe: (m) => {
        const { html } = renderInto(m.renderHubTree, detGrouped)
        return !html.includes("data-symbol-id=\"sym:cal\"")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubTree, detGrouped)
        const f = H.runHubHarness(detHarnessModel, toHarness(el) as never, { sectionClass: "bb-hub-tree" })
        return f.some((x: any) => !x.ok && x.assertion.startsWith("AH1"))
      },
      label: "AH1 rows",
    },
    {
      name: "M4: wrong grouping (list-by-file keys groups by symbol name)",
      from: "    const key = group === \"file\" ? (item.entry.file.length > 0 ? item.entry.file : \"(external)\") : (item.entry.name.length > 0 ? item.entry.name : \"(external)\")",
      to: "    const key = item.entry.name.length > 0 ? item.entry.name : \"(external)\" // always by name",
      probe: (m) => {
        const { html } = renderInto(m.renderHubList, detGrouped, "file")
        return !html.includes(`data-group-name="${CALLER_FILE_APP}"`)
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detGrouped, "file")
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
        const { html } = renderInto(m.renderHubList, detGrouped, "file")
        return !html.includes("bb-hub-list")
      },
      agree: (m) => {
        const { el } = renderInto(m.renderHubList, detGrouped, "file")
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
  u1Shape: { note: "re-verified under M44.U1 grouped usages (schemaVersion 2); hub renders one row per symbol group" },
  limitations: [
    "DOM assertions cover structure/classes/data attributes over a stub DOM; CSS/paint and the webview toggle script's runtime are per-editor presentation (the E5 leg covers the real editor).",
    "The usages fixture is single-file-language (java); cross-language usages reuse the M26.W3 surface, not re-tested here.",
    "U2/U3 (hub list/tree presentation redesign) extend this DOM contract; U1 pins the grouped data + row-per-group rendering.",
  ],
}
const dir = path.join(ROOT, "validation/m42/results")
if (!existsSync(dir)) execFileSync("mkdir", ["-p", dir])
writeSealed(EVIDENCE, result)
console.log(`\nH5: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
process.exit(failed === 0 ? 0 : 1)
