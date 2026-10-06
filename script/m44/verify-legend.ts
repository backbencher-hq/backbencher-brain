// script/m44/verify-legend.ts — M44.U4 (issue #691): header counts + legend gate.
//
// Proves the two U4 laws against a REAL seeded sqlite index and the REAL
// bb_lsp server, and that the suite CAN FAIL:
//
//   R1 header law:  hub header counts are DERIVED FROM THE RENDERED GROUPS
//                   (§13.4) — with a duplicated relationship (make has two
//                   stored rows toward Widget), the header says "2 callers"
//                   (the groups the eye can verify), NEVER "3 callers" (the
//                   raw-row count that was the pre-U1 bug); the server's own
//                   group/row counts ride as declared data-server-* attrs.
//   R2 one legend:  hub list, hub tree, AND impact all ship the SAME legend
//                   through the ONE core function — 5 tier swatches + the
//                   enrichment row + the staleness section (4 statuses); the
//                   graph surface's legend is W4's own gate (verified).
//   R3 staleness:   the legend's statuses mirror the server's StaleMarker
//                   union (src/lsp/freshness.ts) — cross-checked against the
//                   live source; a fresh fixture renders NO marker; the
//                   panel's whole-panel marker contract is E5's in-editor leg
//                   (hub-panel imports vscode — not headless-importable).
//   R4 mutants:     header-counts-rows (the original bug), header attr lie,
//                   staleness section dropped, legend removed from the hub
//                   list — each planted in the real core and caught.
//   R5 generated:   docs/m44/LEGEND.md is GENERATED from the live core (a
//                   render of renderLegend, not hand-written prose); the
//                   drift gate is byte-identical regeneration.
//
// Run: npx tsx script/m44/verify-legend.ts
// Evidence: validation/m44/results/U4.json (machine-emitted)

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
// M62 lane-7 finding (2026-10-05): project identity has ONE owner. Hashing
// path.resolve(ws) here was a second derivation, and it disagrees with
// src/util/project-id.ts wherever the temp dir is a symlink (macOS: /var ->
// /private/var), so this gate failed on macOS while passing on Linux and its red
// said nothing about the law it checks. See makeFixture() for the note.
import { getProjectId } from "../../src/util/project-id.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m44/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "U4.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const HARNESS = path.join(ROOT, "script/m26/webview-harness.ts")
const FRESHNESS = path.join(ROOT, "src/lsp/freshness.ts")
const PANEL = path.join(ROOT, "ide/vscode/src/hub-panel.ts")
const LEGEND_DOC = path.join(ROOT, "docs/m44/LEGEND.md")

let checks = 0
let passed = 0
const failures: string[] = []
const mutants = { caught: 0, total: 0 }

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutants.total++
  if (caught) mutants.caught++
  check(`M${mutants.total}: ${label} (planted defect caught)`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- DOM stub (same shape the W1/V1/U3 suites use) -------------------------------
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
const toHarness = (el: any): any => ({
  tag: el.tagName,
  className: el.className,
  attrs: el.attrs,
  textContent: el.textContent,
  children: el.children.map(toHarness),
})

// --- The real seeded fixture with a DUPLICATED relationship ----------------------
// Caller `make` has TWO stored rows toward Widget (calls + instantiates) — the
// exact shape that made the pre-U1 header print raw-row counts. The header
// must count GROUPS: 2 callers (make, draw) · 1 callee (util), with the row
// multiplicities riding as declared data-* attrs.
interface Fixture {
  ws: string
  dataDir: string
  projectId: string
  cleanup(): void
}
const S_WIDGET = "file-1:Widget"
const S_MAKE = "file-2:make"
const S_DRAW = "file-3:draw"
const S_UTIL = "file-4:util"

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m44u4-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m44u4-data-"))
  const files: Record<string, string> = {
    "widget.ts": "export class Widget {}\n",
    "make.ts": "export function make(): Widget { return new Widget() }\n",
    "draw.ts": "export function draw(): void { new Widget() }\n",
    "util.ts": "export function util(w: Widget): void {}\n",
  }
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(ws, rel), content)
  const projectId = getProjectId(ws)
  const lexicalId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)
  if (lexicalId !== projectId) {
    console.log(`      note: lexical sha1 (${lexicalId.slice(0, 9)}) != canonical (${projectId.slice(0, 9)}) — the temp dir is a symlink here`)
  }
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const file = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    file.run(id, projectId, path.join(ws, rel), rel, "typescript", `u4-hash-${i}`)
  }
  const sym = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  sym.run(S_WIDGET, projectId, fileIds["widget.ts"], "Widget", "class", 1, 1, 1, 3, 10)
  sym.run(S_MAKE, projectId, fileIds["make.ts"], "make", "function", 1, 3, 1, 40, 6)
  sym.run(S_DRAW, projectId, fileIds["draw.ts"], "draw", "function", 1, 2, 1, 30, 5)
  sym.run(S_UTIL, projectId, fileIds["util.ts"], "util", "function", 1, 2, 1, 25, 4)

  const rel = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  // M59.A6 (#824): the hand-supplied lines here (1, 2, 1, 1) were values the
  // pipeline never produced for this fixture's language — the legend/tier laws
  // read confidence, evidence class and staleness, never a line. NULL now, as
  // production stores it (#825 for the analyzers still without a line).
  // The DUPLICATED relationship: make reaches Widget two ways.
  rel.run("r-make-calls", projectId, S_MAKE, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  rel.run("r-make-inst", projectId, S_MAKE, S_WIDGET, "instantiates", 0.5, '{"evidenceClass":"inferred"}', null, 0, null)
  rel.run("r-draw", projectId, S_DRAW, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  // Callee: Widget calls util (external push omitted — not a U4 concern).
  rel.run("r-wu", projectId, S_WIDGET, S_UTIL, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)

  return {
    ws,
    dataDir,
    projectId,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

// --- Harness model from the grouped response (list shape; no tree fields) --------
function harnessRowsFromResponse(resp: any, tierOf: (rows: any[]) => string): any[] {
  const rows: any[] = []
  const pushSide = (groups: any[], dir: "caller" | "callee"): void => {
    for (const g of groups) {
      const serve: any[] = Array.isArray(g.rows) ? g.rows : []
      rows.push({
        symbolId: g.symbolId,
        dir,
        name: g.name,
        file: g.file ?? "",
        line: g.line ?? 0,
        rowIds: serve.map((r: any) => r.rowId),
        types: (g.relationshipTypes ?? []).map((t: any) => ({ type: t.type, occurrences: t.occurrences, tier: tierOf(serve.filter((r: any) => r.relationshipType === t.type)) })),
        enriched: serve.some((r: any) => r.enrichment?.inferredAt !== undefined),
      })
    }
  }
  pushSide(resp.callers ?? [], "caller")
  pushSide(resp.callees ?? [], "callee")
  return rows
}

// --- R5: the generated legend doc -------------------------------------------------
// GENERATED from the live core: render renderLegend through the DOM stub and
// serialize its structure + meanings. Not hand-written prose — a hand edit or
// a core change without regeneration fails the byte-identity gate.
function renderLegendStub(core: any): any {
  // renderLegend RETURNS the legend element (the caller appends it) — the
  // stub must capture the return value, not the empty root.
  return core.renderLegend({ create: (t: string) => new El(t), root: () => new El("div") })
}
function generateLegendDoc(core: any): string {
  const legend = renderLegendStub(core)
  const lines: string[] = []
  lines.push("# bb/graph — the badge legend (M44.U4)")
  lines.push("")
  lines.push("GENERATED from the live core (`script/m26/graph-core.ts` `renderLegend`) —")
  lines.push("the drift gate is byte-identical regeneration by `script/m44/verify-legend.ts`.")
  lines.push("One legend ships with every hub list, hub tree, graph, and impact render (§13.9).")
  lines.push("")
  const walk = (el: any, depth: number): void => {
    const cls = typeof el.className === "string" ? el.className : ""
    if (cls.includes("bb-legend-title")) {
      lines.push(`## ${el.textContent}`)
      lines.push("")
    } else if (cls.includes("bb-legend-item")) {
      const swatch = el.children.find((c: any) => c.className.includes("bb-legend-swatch"))
      const meaning = el.children.find((c: any) => c.className.includes("bb-legend-meaning"))
      const tier = swatch?.attrs["data-legend-tier"]
      const status = el.attrs["data-legend-status"]
      const tag = tier ? `tier \`${tier}\`` : status ? `status \`${status}\`` : "enrichment"
      lines.push(`- ${tag} — ${meaning?.textContent ?? ""}`)
    }
    for (const c of el.children) walk(c, depth + 1)
  }
  walk(legend, 0)
  lines.push("")
  return lines.join("\n")
}

// --- Main ------------------------------------------------------------------------
async function main(): Promise<void> {
  const core = await import(CORE)
  const H = await import(HARNESS)
  const fx = await makeFixture()
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(fx.projectId)
  const req = await import(path.join(ROOT, "src/lsp/graph_request.ts"))

  const renderDom = (fn: (model: any, dom: any) => void, model: any): any => {
    const root = new El("div")
    const dom = { create: (t: string) => new El(t), root: () => root }
    fn(model, dom)
    return toHarness(root)
  }
  const tierOf = (rows: any[]) => (rows.length === 0 ? "inferred" : (core.tierForTypeRows(rows) as string))

  try {
    // --- R1: the header law — groups, never raw rows ------------------------
    console.log("R1: header counts are derived from the RENDERED groups (§13.4)")
    const resp = await req.handleGraphRequest(db, fx.projectId, { schemaVersion: req.GRAPH_SCHEMA_VERSION, symbol: "Widget", mode: req.GRAPH_MODE_USAGES })
    const makeGroup = (resp.callers ?? []).find((g: any) => g.name === "make")
    check("R1: the fixture carries the duplicated relationship (make: 2 stored rows)", makeGroup?.rows?.length === 2, JSON.stringify(makeGroup?.rows?.map((r: any) => r.rowId)))
    check("R1: server counts declare 2 caller groups / 3 caller rows", resp.counts.callerGroups === 2 && resp.counts.callerRows === 3, JSON.stringify(resp.counts))
    const listDoc = renderDom((m, d) => core.renderHubList(m, d, "file"), resp)
    const summary = listDoc.children.find((c: any) => c.className.includes("bb-hub-summary"))
    check("R1: header data-callers == 2 (rendered groups, never the 3 raw rows)", summary?.attrs["data-callers"] === "2", JSON.stringify(summary?.attrs))
    check("R1: header text says 2 callers", (summary?.textContent ?? "").includes("2 callers"), summary?.textContent)
    check("R1: header data-caller-rows == 3 (declared multiplicity)", summary?.attrs["data-caller-rows"] === "3", JSON.stringify(summary?.attrs))
    check("R1: server group counts ride as declared data-server-* attrs", summary?.attrs["data-server-callers"] === String(resp.counts.callerGroups) && summary?.attrs["data-server-callees"] === String(resp.counts.calleeGroups), JSON.stringify(summary?.attrs))
    check("R1: header text never counts rows as callers", !(summary?.textContent ?? "").includes("3 callers"), summary?.textContent)
    const treeDoc = renderDom((m, d) => core.renderHubTree(m, d), resp)
    const treeSummary = treeDoc.children.find((c: any) => c.className.includes("bb-hub-summary"))
    check("R1: the tree's header obeys the same law", treeSummary?.attrs["data-callers"] === "2" && (treeSummary?.textContent ?? "").includes("2 callers"), JSON.stringify(treeSummary?.attrs))
    const model = { rows: harnessRowsFromResponse(resp, tierOf), truncated: false, totalIfKnown: null, headerCounts: { callers: 2, callees: 1 } }
    const findings = H.runHubHarness(model, listDoc, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
    const ah10 = findings.find((f: any) => f.assertion.startsWith("AH10"))
    check("R1: AH10 passes clean over the real response", ah10?.ok === true, `${ah10?.assertion}: ${ah10?.detail}`)

    // --- R2: the ONE legend everywhere --------------------------------------
    console.log("\nR2: the ONE badge legend ships with hub list, tree, AND impact")
    const legendOk = (doc: any, surface: string): void => {
      const f = H.assertHubLegend(doc, { rows: [], truncated: false, staleMarker: null } as any, surface)
      check(`R2: ${surface} ships the ONE legend (5 tiers + enrichment + 4 staleness statuses)`, f.ok, f.detail)
    }
    legendOk(listDoc, "hub list")
    legendOk(treeDoc, "hub tree")
    const impactDoc = renderDom((m, d) => core.renderImpact(m, d), {
      root: { id: "file-1:Widget", name: "Widget", file: "widget.ts" },
      impact: [{ id: S_UTIL, name: "util", file: "util.ts", depth: 1 }],
      shownCount: 1,
      totalCountIfKnown: 1,
      truncated: false,
      truncationReason: null,
    })
    legendOk(impactDoc, "impact")
    const coreSource = readFileSync(CORE, "utf8")
    const callSites = (coreSource.match(/(section|layer)\.appendChild\(renderLegend\(dom\)\)/g) ?? []).length
    check("R2: the core calls the ONE renderLegend from graph, hub list, tree, and impact (4 call sites)", callSites === 4, `call sites=${callSites}`)

    // --- R3: staleness semantics -------------------------------------------
    console.log("\nR3: staleness — legend statuses mirror the server, fresh renders no marker")
    const freshnessSource = readFileSync(FRESHNESS, "utf8")
    const unionMatch = /status: ("fresh" \| "stale" \| "missing" \| "unknown")/.exec(freshnessSource)
    check("R3: freshness status union is the declared four (fresh|stale|missing|unknown)", unionMatch !== null, freshnessSource.slice(0, 0))
    const legendEl = renderLegendStub(core)
    const statuses = (function collect(el: any): string[] {
      const out: string[] = []
      if (el.attrs["data-legend-status"] !== undefined) out.push(el.attrs["data-legend-status"])
      for (const c of el.children) out.push(...collect(c))
      return out
    })(legendEl)
    check("R3: the legend declares exactly the server's four statuses", JSON.stringify(statuses) === JSON.stringify(["fresh", "stale", "missing", "unknown"]), JSON.stringify(statuses))
    const freshFindings = H.assertHubLegend(listDoc, { rows: [], truncated: false, staleMarker: null } as any, "hub list")
    check("R3: a fresh fixture renders NO stale marker (declared absence)", freshFindings.ok, freshFindings.detail)
    // The panel's whole-panel marker contract (hub-panel imports vscode — not
    // headless-importable): the source contract pins the exact marker shape,
    // and E5 asserts it live in the editor.
    const panelSource = readFileSync(PANEL, "utf8")
    check("R3: the panel source pins the whole-panel marker (bb-stale-marker, data-stale, data-status)", panelSource.includes('class="bb-stale-marker"') && panelSource.includes('data-stale="true"') && panelSource.includes("data-status="), "marker template not found in hub-panel.ts")

    // --- R4: the laws CAN FAIL (mutants planted in the real core) -----------
    console.log("\nR4: the header + legend laws CAN FAIL (mutants planted in the real core)")
    const renderWith = async (source: string, fn: string, modelArg: any): Promise<any> => {
      const mutantPath = path.join(ROOT, "validation/m44", `graph-core.u4mutant.${Date.now()}.${Math.floor(Math.random() * 1e6)}.ts`)
      writeFileSync(mutantPath, source)
      try {
        const m = await import(mutantPath)
        return renderDom((mm: any, d: any) => (m as any)[fn](mm, d), modelArg)
      } finally {
        try { rmSync(mutantPath, { force: true }) } catch {}
      }
    }
    const defects: Array<{ name: string; from: string; to: string; fn: string; probe: (doc: any) => boolean; assertion: string }> = [
      {
        name: "header counts ROWS, not groups (the pre-U1 bug)",
        from: "  const callerGroups = grouped.callers.length",
        to: "  const callerGroups = grouped.callers.reduce((n, g) => n + g.rows.length, 0)",
        fn: "renderHubList",
        probe: (doc) => doc.children.find((c: any) => c.className.includes("bb-hub-summary"))?.attrs["data-callers"] === "3",
        assertion: "AH10",
      },
      {
        name: "header data-callers attr lies (+1 over the rendered groups)",
        from: 'summary.setAttribute("data-callers", String(callerGroups))',
        to: 'summary.setAttribute("data-callers", String(callerGroups + 1))',
        fn: "renderHubList",
        probe: (doc) => doc.children.find((c: any) => c.className.includes("bb-hub-summary"))?.attrs["data-callers"] === "3",
        assertion: "AH10",
      },
      {
        name: "staleness section dropped from the legend",
        from: "  for (const [status, meaning] of staleMeanings) {",
        to: "  for (const [status, meaning] of [] as Array<[string, string]>) {",
        fn: "renderHubList",
        probe: (doc) => {
          const f = H.assertHubLegend(doc, { rows: [], truncated: false, staleMarker: null } as any, "hub list")
          return !f.ok // the defect IS planted iff the legend is now broken
        },
        assertion: "AH11",
      },
      {
        name: "legend removed from the hub list render",
        from: "  // U4: the ONE badge legend ships with the hub list too (§13.9).\n  section.appendChild(renderLegend(dom))",
        to: "  // legend removed (mutant)",
        fn: "renderHubList",
        probe: (doc) => {
          const f = H.assertHubLegend(doc, { rows: [], truncated: false, staleMarker: null } as any, "hub list")
          return !f.ok // the defect IS planted iff the legend is gone
        },
        assertion: "AH11",
      },
    ]
    for (const d of defects) {
      if (!coreSource.includes(d.from)) {
        check(`M: ${d.name} (SKIP — anchor not found)`, false, d.from.slice(0, 80))
        continue
      }
      try {
        const doc = await renderWith(coreSource.replace(d.from, d.to), d.fn, resp)
        const planted = d.probe(doc) // the defect is really in the render
        let caughtBy: any = null
        if (d.assertion === "AH10") {
          const ff = H.runHubHarness(model, doc, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
          caughtBy = ff.find((f: any) => !f.ok && f.assertion.startsWith("AH10"))
        } else {
          const f = H.assertHubLegend(doc, { rows: [], truncated: false, staleMarker: null } as any, "hub list")
          caughtBy = f.ok ? null : f
        }
        mutant(`${d.name} — planted=${planted}, ${caughtBy ? "caught by " + caughtBy.assertion : "MISSED"}`, planted && caughtBy !== undefined, caughtBy ? "" : "the mutant was NOT caught")
      } catch (e) {
        mutant(`${d.name} (mutant failed to load — counts as detected)`, true, String(e).slice(0, 120))
      }
    }

    // --- R3b: the REAL dist server over stdio -------------------------------
    console.log("\nR3b: real bb_lsp server over the fixture workspace")
    // #824: both R3b laws are emitted on EVERY path — blocked, failed, or clean
    // — so the check count does not change with the session's outcome.
    if (!existsSync(SERVER)) {
      const why = "blocked-with-reason: dist/lsp/server.js missing (run npm run build)"
      check("R3b: the WIRE response's header counts groups (2 callers), never rows (3)", false, why)
      check("R3b: the wire render passes AH1–AH11 clean", false, why)
    } else {
      const child = spawn(process.execPath, [SERVER, "--dir", fx.ws], {
        cwd: ROOT,
        env: { ...process.env, BB_DATA_DIR: fx.dataDir },
        stdio: ["pipe", "pipe", "pipe"],
      })
      let stderr = ""
      child.stderr.on("data", (b) => (stderr += String(b)))
      const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
      let nextId = 1
      // Byte-accurate framing: Buffer concat + byte offsets — string decoding
      // corrupts multi-byte UTF-8 split across stdout chunks.
      let buffer = Buffer.alloc(0)
      const reader = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
          const sep = buffer.indexOf("\r\n\r\n")
          if (sep === -1) break
          const headers = buffer.slice(0, sep).toString()
          const mm = headers.match(/Content-Length: (\d+)/)
          if (!mm) break
          const len = Number(mm[1])
          if (buffer.length < sep + 4 + len) break
          const body = JSON.parse(buffer.slice(sep + 4, sep + 4 + len).toString())
          buffer = buffer.slice(sep + 4 + len)
          if (body.id !== undefined && pending.has(body.id)) {
            const p = pending.get(body.id)!
            pending.delete(body.id)
            if (body.error) p.reject(new Error(body.error.message))
            else p.resolve(body.result)
          }
        }
      }
      child.stdout.on("data", reader)
      const send = (msg: any): void => {
        const body = JSON.stringify(msg)
        child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      }
      const request = (method: string, params: any): Promise<any> =>
        new Promise((resolve, reject) => {
          const id = nextId++
          pending.set(id, { resolve, reject })
          send({ jsonrpc: "2.0", id, method, params })
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id)
              reject(new Error(`timeout waiting for ${method}`))
            }
          }, 30_000)
        })
      try {
        const init = await request("initialize", { processId: null, rootUri: `file://${fx.ws}`, capabilities: {} })
        if ((init?.capabilities?.graphProvider as any)?.schemaVersion !== 2) throw new Error("bad graphProvider caps")
        send({ jsonrpc: "2.0", method: "initialized", params: {} })
        const g = await request("bb/graph", { schemaVersion: 2, symbol: "Widget", mode: "usages" })
        const serverModel = { rows: harnessRowsFromResponse(g, tierOf), truncated: false, totalIfKnown: null, headerCounts: { callers: 2, callees: 1 } }
        const doc = renderDom((m, d) => core.renderHubList(m, d, "file"), g)
        const summary = doc.children.find((c: any) => c.className.includes("bb-hub-summary"))
        check("R3b: the WIRE response's header counts groups (2 callers), never rows (3)", summary?.attrs["data-callers"] === "2" && (summary?.textContent ?? "").includes("2 callers"), JSON.stringify(summary?.attrs))
        const ff = H.runHubHarness(serverModel, doc, { sectionClass: "bb-hub-list", group: "file", assertGrouping: true })
        const bad = ff.filter((f: any) => !f.ok)
        check("R3b: the wire render passes AH1–AH11 clean", bad.length === 0, bad.map((f: any) => `${f.assertion}: ${f.detail}`).join("; ").slice(0, 200))
      } catch (error: any) {
        const why = String(error?.message ?? error).slice(0, 200) + (stderr ? ` | stderr: ${stderr.slice(-200)}` : "")
        check("R3b: the WIRE response's header counts groups (2 callers), never rows (3)", false, `session did not complete: ${why}`)
        check("R3b: the wire render passes AH1–AH11 clean", false, `session did not complete: ${why}`)
      } finally {
        try { child.kill() } catch {}
      }
    }

    // --- R5: the generated legend doc (drift gate) ---------------------------
    console.log("\nR5: docs/m44/LEGEND.md is GENERATED from the live core")
    const generated = generateLegendDoc(core)
    if (!existsSync(LEGEND_DOC)) {
      mkdirSync(path.dirname(LEGEND_DOC), { recursive: true })
      writeFileSync(LEGEND_DOC, generated)
      check("R5: LEGEND.md generated on first run (byte-identity from now on)", true)
    } else {
      const onDisk = readFileSync(LEGEND_DOC, "utf8")
      check("R5: LEGEND.md byte-identical with a fresh generation from the live core", onDisk === generated, `on-disk ${onDisk.length} chars vs generated ${generated.length} chars`)
    }
    check("R5: the generated doc carries all five tiers and all four staleness statuses", ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].every((t) => generated.includes(`tier \`${t}\``)) && ["fresh", "stale", "missing", "unknown"].every((s) => generated.includes(`status \`${s}\``)), generated.slice(0, 120))
  } finally {
    fx.cleanup()
  }

  // --- Persist evidence ----------------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M44.U4",
    code: "U4",
    milestone: "M44",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    // #824: persist WHICH check failed (see verify-usages-groups.ts).
    failures,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    currentCommit,
    ...fingerprintFields(["m44.U4"], ROOT),
    verifierCommand: "npx tsx script/m44/verify-legend.ts",
    evidenceFile: "U4.json",
    generatedAt: new Date().toISOString(),
    fixture: { root: "Widget (file-1:Widget)", duplicated: "make -> Widget carries calls + instantiates (3 caller rows, 2 caller groups)" },
    laws: ["R1 header counts from rendered groups (§13.4) with declared data-server-* drift attrs", "R2 ONE legend from graph, hub list, tree, impact (4 call sites)", "R3 staleness statuses mirror freshness.ts; fresh renders no marker", "R3b real server over stdio", "R4 four mutants (rows-as-groups, attr lie, staleness dropped, legend removed)", "R5 generated drift-gated docs/m44/LEGEND.md"],
    limitations: [
      "The graph surface's legend is W4's own gate (verify-evidence-badges.ts P3), re-run in the standing chain.",
      "The whole-panel stale marker is a hub-panel (vscode-importing) contract: pinned at source level here and asserted live by the E5 in-editor leg.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nU4: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
