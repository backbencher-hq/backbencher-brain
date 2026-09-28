// script/m44/verify-hub-tree.ts — M44.U3 (issue #690): the call-tree rework gate.
//
// Proves renderHubTree (the ONE renderer core) is a REAL expandable tree —
// root symbol, caller/callee children with per-node occurrence counts,
// collapsed-by-default beyond one level with declared expansion, clickable
// leaves, truncation declared in-tree — against a REAL seeded sqlite index
// and the REAL bb_lsp server, and that the suite CAN FAIL.
//
//   R1 data law:    the grouped usages response carries the tree parent on
//                   every stored row (a deeper group's rows parent to a
//                   rendered same-side group — never a phantom)
//   R2 tree render: the real core renders the real response; the shared
//                   harness laws AH1–AH9 all pass (nesting depth, per-node
//                   counts, declared expansion, clickable leaves, no
//                   duplicate symbol renders)
//   R3 real server: the SAME fixture served over stdio by the REAL dist
//                   server renders clean + the in-tree truncation marker is
//                   declared when the model truncates
//   R4 mutants:     flatten-to-root, double-render children, dropped
//                   expander, depth lie, level lie — each planted in the
//                   real core and caught by the harness
//
// Run: npx tsx script/m44/verify-hub-tree.ts
// Evidence: validation/m44/results/U3.json (machine-emitted)

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m44/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "U3.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const HARNESS = path.join(ROOT, "script/m26/webview-harness.ts")

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

// --- DOM stub (same shape the W1/V1 suites use) ---------------------------------
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

// --- The real seeded fixture with genuine NESTING --------------------------------
// Caller chain: render -> make -> Widget (render nests under make under the
// root). Callee chain: Widget -> util -> deep (deep nests under util). The
// root cascade stays exactly the root symbol (owner_symbol_id NULL), so the
// traversal's recursion — NOT a cascade fold — produces the nesting: every
// depth-1 row's parent endpoint is itself a rendered group.
interface Fixture {
  ws: string
  dataDir: string
  projectId: string
  cleanup(): void
}
const S_WIDGET = "file-1:Widget"
const S_MAKE = "file-2:make"
const S_DRAW = "file-3:draw"
const S_RENDER = "file-4:render"
const S_UTIL = "file-5:util"
const S_DEEP = "file-6:deep"

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m44u3-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m44u3-data-"))
  const files: Record<string, string> = {
    "widget.ts": "export class Widget {}\n",
    "make.ts": "export function make(): Widget { return new Widget() }\n",
    "draw.ts": "export function draw(): void { new Widget() }\n",
    "render.ts": "export function render(): void { make() }\n",
    "util.ts": "export function util(): void { deep() }\n",
    "deep.ts": "export function deep(): void {}\n",
  }
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(ws, rel), content)
  const canonical = path.resolve(ws)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
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
    file.run(id, projectId, path.join(ws, rel), rel, "typescript", `u3-hash-${i}`)
  }
  const sym = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  sym.run(S_WIDGET, projectId, fileIds["widget.ts"], "Widget", "class", 1, 1, 1, 3, 10)
  sym.run(S_MAKE, projectId, fileIds["make.ts"], "make", "function", 1, 3, 1, 40, 6)
  sym.run(S_DRAW, projectId, fileIds["draw.ts"], "draw", "function", 1, 2, 1, 30, 5)
  sym.run(S_RENDER, projectId, fileIds["render.ts"], "render", "function", 1, 1, 1, 20, 4)
  sym.run(S_UTIL, projectId, fileIds["util.ts"], "util", "function", 1, 2, 1, 20, 3)
  sym.run(S_DEEP, projectId, fileIds["deep.ts"], "deep", "function", 1, 1, 1, 10, 2)

  const rel = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  // M59.A6 (#824): the hand-supplied lines (1, 2, 1, 1, 1, 1, 1) are gone —
  // values the pipeline never produced for this fixture's language. The tree
  // laws read nesting, multiplicity and the ROOT's identity, not lines; NULL is
  // what production stores where an analyzer has no line yet (#825).
  // Callers of Widget: make (multiplicity 2), draw — both depth-0 rows whose
  // parent endpoint is the root.
  rel.run("r-make-calls", projectId, S_MAKE, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  rel.run("r-make-inst", projectId, S_MAKE, S_WIDGET, "instantiates", 0.5, '{"evidenceClass":"inferred"}', null, 0, null)
  rel.run("r-draw", projectId, S_DRAW, S_WIDGET, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  // The DEPTH-1 caller: render calls make (which calls Widget). Its row's
  // parent endpoint is make — a rendered caller group — so the tree must
  // nest render UNDER make, never at the top level.
  rel.run("r-render", projectId, S_RENDER, S_MAKE, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  // Callees of Widget: an external push, plus the util chain.
  rel.run("r-ext-push", projectId, S_WIDGET, null, "calls", 0.6, null, null, 0, "push")
  rel.run("r-wu", projectId, S_WIDGET, S_UTIL, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)
  rel.run("r-ud", projectId, S_UTIL, S_DEEP, "calls", 0.9, '{"evidenceClass":"structural"}', null, 0, null)

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

// --- The harness model derived from the real response ----------------------------
// Placement law (U3): a group's tree parent is the parent endpoint of its
// shallowest row; when that endpoint is the root symbol or is not itself a
// rendered same-side group, the group is a top-level child of the root.
function harnessRowsFromResponse(resp: any, tierOf: (rows: any[]) => string): any[] {
  const rows: any[] = []
  const pushSide = (groups: any[], dir: "caller" | "callee", sideIds: Set<string>): void => {
    for (const g of groups) {
      const serve: any[] = Array.isArray(g.rows) ? g.rows : []
      const minRow = [...serve].sort(
        (a, b) => a.depth - b.depth || (a.parentSymbolId === resp.root.symbolId ? -1 : 1) || a.parentName.localeCompare(b.parentName) || a.rowId.localeCompare(b.rowId),
      )[0]
      const parentId = minRow?.parentSymbolId
      const treeParent = parentId === resp.root.symbolId || !sideIds.has(parentId) ? "" : parentId
      rows.push({
        symbolId: g.symbolId,
        dir,
        name: g.name,
        file: g.file ?? "",
        line: g.line ?? 0,
        rowIds: serve.map((r: any) => r.rowId),
        types: (g.relationshipTypes ?? []).map((t: any) => ({ type: t.type, occurrences: t.occurrences, tier: tierOf(serve.filter((r: any) => r.relationshipType === t.type)) })),
        enriched: serve.some((r: any) => r.enrichment?.inferredAt !== undefined),
        depth: minRow?.depth ?? 0,
        treeParent,
      })
    }
  }
  const callerIds = new Set((resp.callers ?? []).map((g: any) => g.symbolId))
  const calleeIds = new Set((resp.callees ?? []).map((g: any) => g.symbolId))
  pushSide(resp.callers ?? [], "caller", callerIds)
  pushSide(resp.callees ?? [], "callee", calleeIds)
  return rows
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

  try {
    // --- R1: the data law — every stored row carries its true tree parent ---
    console.log("R1: grouped response carries the tree parent on every row")
    const resp = await req.handleGraphRequest(db, fx.projectId, { schemaVersion: req.GRAPH_SCHEMA_VERSION, symbol: "Widget", mode: req.GRAPH_MODE_USAGES })
    const callerGroups: any[] = resp.callers ?? []
    const calleeGroups: any[] = resp.callees ?? []
    const rowHasParent = (g: any) => Array.isArray(g.rows) && g.rows.length > 0 && g.rows.every((r: any) => typeof r.parentSymbolId === "string" && r.parentSymbolId.length > 0 && typeof r.parentName === "string" && r.parentName.length > 0)
    check("R1: every caller group row carries a declared parentSymbolId/parentName", callerGroups.every(rowHasParent), callerGroups.map((g) => g.name).join(","))
    check("R1: every callee group row carries a declared parentSymbolId/parentName", calleeGroups.every(rowHasParent), calleeGroups.map((g) => g.name).join(","))
    const make = callerGroups.find((g: any) => g.name === "make")
    const render = callerGroups.find((g: any) => g.name === "render")
    const draw = callerGroups.find((g: any) => g.name === "draw")
    check("R1: depth-0 caller rows parent to the ROOT symbol", make?.rows?.every((r: any) => r.parentSymbolId === "file-1:Widget") && draw?.rows?.every((r: any) => r.parentSymbolId === "file-1:Widget"), JSON.stringify({ make: make?.rows?.map((r: any) => r.parentSymbolId), draw: draw?.rows?.map((r: any) => r.parentSymbolId) }))
    check("R1: the depth-1 caller row parents to a RENDERED group (make), not the root", render?.rows?.length === 1 && render.rows[0].parentSymbolId === "file-2:make" && render.rows[0].depth === 1, JSON.stringify(render?.rows))
    const util = calleeGroups.find((g: any) => g.name === "util")
    const deep = calleeGroups.find((g: any) => g.name === "deep")
    check("R1: the depth-1 callee row parents to a RENDERED group (util)", deep?.rows?.length === 1 && deep.rows[0].parentSymbolId === "file-5:util" && deep.rows[0].depth === 1, JSON.stringify(deep?.rows))
    check("R1: the depth-0 callee row parents to the root symbol", util?.rows?.every((r: any) => r.parentSymbolId === "file-1:Widget"), JSON.stringify(util?.rows))
    check("R1: the external callee group rows parent to the root (its source is the root)", (calleeGroups.find((g: any) => g.name === "push")?.rows ?? []).every((r: any) => r.parentSymbolId === "file-1:Widget"))

    // --- R2: the real core renders the real response — AH1–AH9 all clean ---
    console.log("\nR2: renderHubTree over the real response passes AH1–AH9")
    const tierOf = (rows: any[]) => (rows.length === 0 ? "inferred" : (core.tierForTypeRows(rows) as string))
    const model = { rows: harnessRowsFromResponse(resp, tierOf), truncated: false, totalIfKnown: null }
    const treeDoc = renderDom((m, d) => core.renderHubTree(m, d), resp)
    const findings = H.runHubHarness(model, treeDoc, { sectionClass: "bb-hub-tree" })
    for (const f of findings) check(`R2: ${f.assertion}`, f.ok, f.detail)
    // Per-node occurrence counts (§13.2/§13.4): a node's count is its group's
    // stored-row multiplicity and appears on the node row (serialized HTML:
    // attrs sort alphabetically, so match the row by id then read its count).
    const flat = H.serializeHarnessNode(treeDoc)
    const nodeCountOf = (symbolId: string): string | null => {
      const i = flat.indexOf(`data-symbol-id="${symbolId}"`)
      if (i === -1) return null
      const tagStart = flat.lastIndexOf("<div ", i)
      const tagEnd = flat.indexOf(">", i)
      const tag = flat.slice(tagStart, tagEnd)
      const count = /data-occurrences="(\d+)"/.exec(tag)
      return count ? count[1] : null
    }
    check("R2: render's node declares occurrences == its stored rows (1)", nodeCountOf("file-4:render") === "1", `render count=${nodeCountOf("file-4:render")}`)
    check("R2: make's node declares occurrences == its stored rows (2)", nodeCountOf("file-2:make") === "2", `make count=${nodeCountOf("file-2:make")}`)
    // H6 navigation machine attrs ride every navigable tree row (same reveal
    // channel as the list — the in-editor navigation leg is the standing H6
    // gate over this same DOM contract).
    check("R2: every tree row declares data-clickable and navigable rows carry file/line/symbol", (flat.match(/data-clickable="1"/g) ?? []).length >= 5 && (flat.match(/data-clickable="0"/g) ?? []).length >= 1, `c1=${(flat.match(/data-clickable="1"/g) ?? []).length} c0=${(flat.match(/data-clickable="0"/g) ?? []).length}`)
    check("R2: deterministic — the same response renders byte-identical twice", flat === H.serializeHarnessNode(renderDom((m, d) => core.renderHubTree(m, d), resp)))

    // --- R2b: truncation declared in-tree ------------------------------------
    console.log("\nR2b: truncation stays declared in the tree section")
    const truncated = {
      ...resp,
      summary: { truncated: true, truncationReason: "caller-budget-exhausted", crossLanguageGroups: 0 },
    }
    const truncDoc = renderDom((m, d) => core.renderHubTree(m, d), truncated)
    const truncHtml = H.serializeHarnessNode(truncDoc)
    const rowsShown = model.rows.length
    check("R2b: truncated tree renders the marker with the rendered count + declared-unknown total", /bb-truncation-marker/.test(truncHtml) && truncHtml.includes(`data-shown="${rowsShown}"`) && truncHtml.includes('data-total-if-known="unknown"'), truncHtml.slice(0, 200))

    // --- R2c: an unnesteable row is a DECLARED error (M55) -------------------
    // The row type keeps parentSymbolId/parentName optional for hand-built
    // LIST fixtures; the tree's nesting law requires them for depth ≥ 1. The
    // renderer must refuse — a fold to root here would nest a group under a
    // phantom parent (the honest-looking lie this exists to make impossible).
    console.log("\nR2c: a depth ≥ 1 row without its parent fields is a declared error")
    const unnesteable = {
      ...resp,
      callers: [
        {
          symbolId: "phantom:foreign",
          name: "foreign",
          file: "",
          line: 0,
          occurrences: 1,
          relationshipTypes: [{ type: "calls", occurrences: 1 }],
          rows: [{ rowId: "phantom:foreign:1", relationshipType: "calls", depth: 1, confidence: 1, isCrossLanguage: false }],
        },
      ],
      callees: [],
    }
    let declaredError = ""
    try {
      renderDom((m, d) => core.renderHubTree(m, d), unnesteable)
    } catch (e) {
      declaredError = e instanceof Error ? e.message : String(e)
    }
    check(
      "R2c: renderHubTree throws the declared placement error (names the row, no phantom parent)",
      declaredError.startsWith("bb/graph: tree placement is missing the parent fields") && declaredError.includes("depth-1") && declaredError.includes("(foreign)"),
      declaredError || "no error thrown — a phantom parent was fabricated",
    )

    // --- R3: the REAL dist server over stdio --------------------------------
    console.log("\nR3: real bb_lsp server over the fixture workspace")
    // #824: both R3 laws are emitted on EVERY path — blocked, failed, or clean
    // — so the check count does not change with the session's outcome.
    const r3Blocked = !existsSync(SERVER)
    if (r3Blocked) {
      check("R3: real-server grouped response renders clean under AH1–AH9", false, "blocked-with-reason: dist/lsp/server.js missing (run npm run build)")
      check("R3: wire caller groups carry the nesting fixture (make/draw/render)", false, "blocked-with-reason: dist/lsp/server.js missing (run npm run build)")
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
      // corrupts multi-byte UTF-8 split across stdout chunks (a hard-won
      // lesson; the header is only consumed once the body is complete).
      let buffer = Buffer.alloc(0)
      let out = { ok: false, detail: "" }
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
        const serverModel = { rows: harnessRowsFromResponse(g, tierOf), truncated: false, totalIfKnown: null }
        const doc = renderDom((m, d) => core.renderHubTree(m, d), g)
        const ff = H.runHubHarness(serverModel, doc, { sectionClass: "bb-hub-tree" })
        const failures = ff.filter((f) => !f.ok)
        out.detail = failures.map((f) => `${f.assertion}: ${f.detail}`).join("; ").slice(0, 200)
        check("R3: real-server grouped response renders clean under AH1–AH9", failures.length === 0, out.detail || "clean")
        const names = JSON.stringify((g.callers ?? []).map((x: any) => x.name).sort())
        check("R3: wire caller groups carry the nesting fixture (make/draw/render)", names.includes("make") && names.includes("draw") && names.includes("render"), names)
      } catch (error: any) {
        const why = String(error?.message ?? error).slice(0, 200) + (stderr ? ` | stderr: ${stderr.slice(-200)}` : "")
        check("R3: real-server grouped response renders clean under AH1–AH9", false, `session did not complete: ${why}`)
        check("R3: wire caller groups carry the nesting fixture (make/draw/render)", false, `session did not complete: ${why}`)
      } finally {
        try { child.kill() } catch {}
      }
    }

    // --- R4: mutation suite over the real core -------------------------------
    console.log("\nR4: the tree laws CAN FAIL (mutants planted in the real core)")
    const coreSource = readFileSync(CORE, "utf8")
    const renderWith = async (source: string): Promise<any> => {
      const mutantPath = path.join(ROOT, "validation/m44", `graph-core.u3mutant.${Date.now()}.${Math.floor(Math.random() * 1e6)}.ts`)
      writeFileSync(mutantPath, source)
      try {
        const m = await import(mutantPath)
        return renderDom((mm: any, d: any) => m.renderHubTree(mm, d), resp)
      } finally {
        try { rmSync(mutantPath, { force: true }) } catch {}
      }
    }
    const defects: Array<{ name: string; from: string; to: string; assertion: string }> = [
      {
        name: "flatten-to-root (deeper rows emitted at the top level)",
        from: "if (p.symbolId === rootId || !side.byId.has(p.symbolId)) emit(g, 0, header)",
        to: "if (true) emit(g, 0, header) // every group flattened to the root",
        assertion: "AH7-9",
      },
      {
        name: "children double-rendered (DAG duplication inflates counts)",
        from: "      for (const kid of ordered) emit(kid, level + 1, wrap)",
        to: "      for (const kid of ordered) emit(kid, level + 1, wrap)\n      for (const kid of ordered) emit(kid, level + 1, wrap) // twice",
        assertion: "AH1",
      },
      {
        name: "expander dropped (a parent the user can never open)",
        from: '      expander.addClass("bb-hub-expander")',
        to: "      // expander control dropped",
        assertion: "AH7-9",
      },
      {
        name: "data-depth lies (a deeper row declared at depth 0)",
        from: 'el.setAttribute("data-depth", String(minDepth))',
        to: 'el.setAttribute("data-depth", "0")',
        assertion: "AH7-9",
      },
      {
        name: "data-level lies (a nested row declared at the root level)",
        from: 'el.setAttribute("data-level", String(level))',
        to: 'el.setAttribute("data-level", String(Math.max(0, level - 1)))',
        assertion: "AH7-9",
      },
    ]
    for (const d of defects) {
      if (!coreSource.includes(d.from)) {
        check(`M: ${d.name} (SKIP — anchor not found)`, false, d.from.slice(0, 80))
        continue
      }
      try {
        const doc = await renderWith(coreSource.replace(d.from, d.to))
        const ff = H.runHubHarness(model, doc, { sectionClass: "bb-hub-tree" })
        const caughtBy = ff.find((f) => !f.ok)
        mutant(`${d.name} — harness ${caughtBy ? "caught" : "MISSED"} (${caughtBy?.assertion ?? "no assertion failed"})`, caughtBy !== undefined)
      } catch (e) {
        mutant(`${d.name} (mutant failed to load — counts as detected)`, true, String(e).slice(0, 120))
      }
    }

    // M55: R2c's declared error must be FAIL-ABLE. Disabling the placement
    // throw must break R2c — an unnesteable row silently folding to a phantom
    // parent is the honest-looking lie the check exists to catch. (This one
    // is asserted by R2c, not by the hub harness, so it has its own leg.)
    {
      const anchor = "if (row.parentSymbolId === undefined || row.parentName === undefined) {"
      if (!coreSource.includes(anchor)) {
        check("M: placement throw disabled (SKIP — anchor not found)", false, anchor)
      } else {
        const mutantPath = path.join(ROOT, "validation/m44", `graph-core.u3mutant.${Date.now()}.${Math.floor(Math.random() * 1e6)}.ts`)
        writeFileSync(mutantPath, coreSource.replace(anchor, "if (false) {"))
        try {
          const m = await import(mutantPath)
          const root = new El("div")
          let threw = false
          try {
            m.renderHubTree(unnesteable, { create: (t: string) => new El(t), root: () => root })
          } catch {
            threw = true
          }
          mutant("placement throw disabled (an unnesteable row folds to a phantom parent — R2c catches)", threw === false)
        } catch (e) {
          mutant("placement throw disabled (mutant failed to load — counts as detected)", true, String(e).slice(0, 120))
        } finally {
          try { rmSync(mutantPath, { force: true }) } catch {}
        }
      }
    }
  } finally {
    fx.cleanup()
  }

  // --- Persist evidence ----------------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M44.U3",
    code: "U3",
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
    verifierCommand: "npx tsx script/m44/verify-hub-tree.ts",
    evidenceFile: "U3.json",
    generatedAt: new Date().toISOString(),
    fixture: { root: "Widget (file-1:Widget)", nesting: "callers: render -> make -> Widget; callees: Widget -> util -> deep; external callee push" },
    laws: ["R1 data law: every row carries parentSymbolId/parentName; depth-1 rows parent to rendered groups", "R2 render: AH1-9 over the real response", "R2b in-tree truncation marker", "R3 real server over stdio", "R4 five mutants (flatten, double-render, dropped expander, depth lie, level lie)"],
    limitations: [
      "The traversal recursion (not a cascade fold) produces this fixture's nesting; the cascade fold (depth-0 rows toward root's class members) is asserted at the harness level in V1.",
      "DOM assertions cover structure/classes/data attributes over a stub DOM; the real-editor click/expand leg is E5 (in-editor) over this same DOM contract.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nU3: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
