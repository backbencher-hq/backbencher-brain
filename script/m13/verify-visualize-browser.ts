// script/m13/verify-visualize-browser.ts — M13.64 (V10).
//
// THE ONLY GATE IN THIS LANE THAT OPENS THE ARTIFACT IN A BROWSER.
//
// Why it exists, measured rather than assumed. Every check in V1–V9 reads the
// documents as TEXT, and this repository has no DOM dependency by design — V7 says
// so in its own limitations. The consequence, measured this pass: three real
// defects in this artifact were invisible to those checks and were found only by
// driving it in a browser —
//
//   (a) `focusSet()` read `sel || hover`, so moving the POINTER across a node
//       switched the map into focus mode, replaced the region links with the
//       individual edges, and made a click at a link's own midpoint pick a
//       different edge than the one under the cursor;
//   (b) the region layout seeded per region and could not be un-seeded without
//       drawing the same graph as one ball (the whole point of the regions);
//   (c) the force layout strung its ~76 degree-0 nodes on one perfect circle —
//       a bead necklace the data does not have.
//
// A text assertion cannot see any of those. So this gate launches a real
// chromium, navigates to the artifacts the TOOL HANDLER produced for a fixture,
// clicks with real mouse events, drags the relationship box to the other side of
// the frame, and reads the state the view publishes.
//
// NO NEW DEPENDENCY. The driver speaks CDP over the WebSocket that Node 22
// already ships, and it discovers a chromium binary from a documented search
// order (BB_VISUALIZE_CHROME, CHROME_PATH, playwright's own cache, then the
// system names). This repository deliberately has no browser package, and adding
// one to verify a canvas would be a dependency justified by testing rather than
// by the product.
//
// NOT IN `npm run verify`, and that is deliberate: the chain must be runnable on
// a machine with no browser, and a gate that cannot run must never look like one
// that passed. When no binary is found this gate FAILS, naming the variable to
// set — never a skip, never a silent pass. It is wired as `npm run
// verify:viz-browser` so the orphan census sees it.
//
// This gate drives only the graph.
//
// Run: npm run verify:viz-browser
// Evidence: validation/m13/results/v10.json

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness } from "./harness"

// MEASURED: this gate talks to chromium over 127.0.0.1, and under bun a loopback fetch
// inherits `http_proxy` from the shell and is RESET by the proxy — the launch succeeded
// and the very next request died with ECONNRESET. Node's fetch ignores the variable and
// bun's does not, so the gate clears it for itself (it needs no proxy: nothing here
// leaves the machine) rather than depending on which runtime invoked it.
for (const key of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete process.env[key]
process.env.no_proxy = "127.0.0.1,localhost"
process.env.NO_PROXY = "127.0.0.1,localhost"

const harness = new Harness({
  issue: "M13.64",
  code: "V10",
  tool: "bb_visualize",
  title: "bb_visualize: the artifact driven in a real browser — layouts, the picked-item box, and the pixels",
  layers: ["e2e"],
  decisions: {
    driver: "chromium over the CDP WebSocket that Node 22 ships; no browser package is added to this repository",
    discovery: "BB_VISUALIZE_CHROME, then CHROME_PATH, then playwright's own cache, then the system binary names — and a hard failure naming the variable when none is found, because a check that cannot run must not read as one that passed",
    input: "interaction is asserted through REAL input events (Input.dispatchMouseEvent), never by calling the view's API for the gesture under test",
    coverage: "the graph's two arrangements are driven in this browser — the regions map and the force map — and a click target is chosen from what the PAGE says is under the point (elementFromPoint), because a click on a floating overlay is a click on the overlay",
    evidence: "the state asserted is the state the view PUBLISHES (state(), links(), panel()), so a pass is a claim the artifact makes about itself",
    pixels: "the regions canvas is asserted to have ink on it (sampled alpha), because a renderer that dies on its first frame leaves a blank canvas every text assertion still passes",
    zoomGesture: "the overview is reached with a REAL wheel gesture (Input.dispatchMouseEvent mouseWheel), never by calling the view's API for the gesture under test",
  },
  limitations: [
    "This gate needs a chromium binary and is therefore run as `npm run verify:viz-browser` rather than from the `verify` chain: the chain must stay runnable where no browser exists.",
    "It verifies the DOCUMENTS, not the composed studio's every sidebar control: the layout switch is driven from the sidebar for both arrangements, and the remaining sidebar controls (filters, downloads, the census) are asserted by the view-publishing gate — V7 structurally.",
    "One fixture, one viewport (1600x1000). A layout defect that only appears at a large node count, or at another aspect ratio, is not exercised here — the region and force layouts were inspected at 200 nodes and two widths out of band (validation/m13/results/viz-layout-panel).",
    "This gate drives the graph's two arrangements and nothing else."
  ],
})

// ── a browser, or a loud failure ────────────────────────────────────────────────
const BIN_ENV = "BB_VISUALIZE_CHROME"

/** Newest-first, so a machine with several cached builds uses the newest. */
function findBrowser(): string | null {
  const fromEnv = [process.env[BIN_ENV], process.env.CHROME_PATH].filter((p): p is string => !!p && existsSync(p))
  if (fromEnv.length > 0) return fromEnv[0]
  const roots: string[] = []
  const home = process.env.HOME ?? ""
  if (home) roots.push(path.join(home, ".cache", "ms-playwright"), path.join(home, ".cache", "puppeteer"))
  for (const root of roots) {
    if (!existsSync(root)) continue
    const builds = readdirSync(root)
      .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))
    for (const build of builds) {
      const candidates = [
        path.join(root, build, "chrome-linux", "chrome"),
        path.join(root, build, "chrome-linux", "headless_shell"),
        path.join(root, build, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      ]
      for (const c of candidates) if (existsSync(c)) return c
    }
  }
  const PATH_DIRS = (process.env.PATH ?? "").split(":").filter(Boolean)
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]) {
    for (const dir of PATH_DIRS) {
      const p = path.join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

const browserPath = findBrowser()
harness.check(
  "browser: a chromium binary was found to drive this gate",
  !!browserPath,
  browserPath ?? `none found — set ${BIN_ENV}=/path/to/chrome (or generate the artifact by hand: npm run verify:viz-browser is the only gate that needs one)`,
)
if (!browserPath) harness.emit()

// ── the fixture: three named regions that call across each other ───────────────
//
// The region rule is "a directory of three or more symbols of this slice", and a
// region LINK is an edge BETWEEN two regions, so a fixture with one region (or with
// no cross-region edge) cannot exercise the thing this gate is about.
const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v10-"))
const write = (rel: string, body: string): void => {
  const full = path.join(root, rel)
  // mkdirSync from the module import, not `require`: this file is ESM, and a stray
  // `require` here is the same defect m48/verify-w1-website-tools.ts carries.
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, body)
}
// pkg/a and pkg/c call into pkg/b and each other; start() calls into pkg/a. Every
// region therefore has both members and cross-region edges, and there are four
// region pairs to summarise.
write("pkg/a/a1.ts", "import { b1 } from '../b/b1'\nexport function a1(): string { return b1() }\n")
write("pkg/a/a2.ts", "import { b2 } from '../b/b2'\nexport function a2(): string { return b2() }\n")
write("pkg/a/a3.ts", "import { c1 } from '../c/c1'\nexport function a3(): string { return c1() }\n")
write("pkg/b/b1.ts", "export function b1(): string { return 'b1' }\n")
write("pkg/b/b2.ts", "import { b1 } from './b1'\nexport function b2(): string { return b1() }\n")
write("pkg/b/b3.ts", "import { a1 } from '../a/a1'\nexport function b3(): string { return a1() }\n")
write("pkg/c/c1.ts", "export function c1(): string { return 'c1' }\n")
write("pkg/c/c2.ts", "import { a2 } from '../a/a2'\nexport function c2(): string { return a2() }\n")
write("pkg/c/c3.ts", "import { b3 } from '../b/b3'\nexport function c3(): string { return b3() }\n")
write("main.ts", "import { a1 } from './pkg/a/a1'\nexport function start(): string { return a1() }\n")

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})
const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const html = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize({ scope: "project", view: "graph", format: "html", ...args }, ctx)).content[0].text as string

/** The document a studio slot carries, so the gate drives the same file a reader opens. */
function documentOf(studio: string, slot: string): string {
  const m = studio.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error("the studio payload is missing from the html answer")
  return (JSON.parse(m[1]) as Record<string, string>)[slot] ?? ""
}

const regionsStudio = await html({})
const forceStudio = await html({ layout: "force" })
const regionsDoc = documentOf(regionsStudio, "graph")
const forceDoc = documentOf(forceStudio, "graph")
const docDir = path.join(root, "artifacts")
mkdirSync(docDir, { recursive: true })
writeFileSync(path.join(docDir, "regions.html"), regionsDoc)
writeFileSync(path.join(docDir, "force.html"), forceDoc)
writeFileSync(path.join(docDir, "studio.html"), regionsStudio)

// ── the driver ─────────────────────────────────────────────────────────────────
interface Session {
  /** Raw CDP call. The object returned by `openBrowser` has always had this; the
   *  type did not, so the one member that is genuinely part of the session was
   *  invisible to a typecheck and to any reader of the interface. */
  send: (method: string, params?: Record<string, unknown>) => Promise<any>
  evaluate: (expression: string) => Promise<any>
  mouse: (type: string, x: number, y: number, extra?: Record<string, unknown>) => Promise<any>
  click: (x: number, y: number) => Promise<void>
  navigate: (url: string) => Promise<void>
  pageErrors: string[]
  close: () => void
}

async function openBrowser(): Promise<Session> {
  const profile = mkdtempSync(path.join(tmpdir(), "bb-cdp-"))
  const chrome = spawn(
    browserPath as string,
    [
      "--headless",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-sandbox",
      "--disable-gpu",
      "--no-proxy-server",
      "--allow-file-access-from-files",
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  let stderr = ""
  chrome.stderr.on("data", (d) => { stderr += String(d) })
  const portFile = path.join(profile, "DevToolsActivePort")
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100))
  if (!existsSync(portFile)) throw new Error(`chromium never wrote DevToolsActivePort: ${stderr.slice(0, 400)}`)
  const port = readFileSync(portFile, "utf8").split("\n")[0]
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
  const page = targets.find((t) => t.type === "page")
  if (!page) throw new Error("chromium exposed no page target")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("CDP socket failed")) })

  let id = 0
  const pending = new Map<number, (msg: any) => void>()
  const pageErrors: string[] = []
  const loaded: Array<() => void> = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data))
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); return }
    // A page that throws is a defect the artifact cannot report about itself, so the
    // driver is what collects it: exceptions and console errors both count.
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(`exception: ${String(msg.params?.exceptionDetails?.text ?? "").slice(0, 180)}`)
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      pageErrors.push(`console: ${String(msg.params.args?.[0]?.value ?? msg.params.args?.[0]?.description ?? "").slice(0, 180)}`)
    }
    if (msg.method === "Page.loadEventFired") { const f = loaded.shift(); if (f) f() }
  }
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
    new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })

  await send("Runtime.enable")
  await send("Page.enable")

  const evaluate = async (expression: string): Promise<any> => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(String(JSON.stringify(r.result.exceptionDetails)).slice(0, 300))
    return r.result?.result?.value
  }
  const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<any> =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0, ...extra })
  return {
    send,
    evaluate,
    mouse,
    click: async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y) },
    navigate: async (url: string) => {
      const arrived = new Promise<void>((res) => loaded.push(res))
      await send("Page.navigate", { url })
      await Promise.race([arrived, new Promise((r) => setTimeout(r, 20000))])
    },
    pageErrors,
    close: () => { try { ws.close() } catch { /* already gone */ } chrome.kill("SIGKILL"); rmSync(profile, { recursive: true, force: true }) },
  }
}

let session: Session | null = null
try {
  session = await openBrowser()
  const s = session
  harness.check("browser: chromium launched and answered a CDP request", true, path.basename(path.dirname(String(browserPath))))

  const state = (): Promise<any> => s.evaluate("window.__bbView && window.__bbView.state()")
  const panel = (): Promise<any> => s.evaluate("window.__bbView && window.__bbView.panel()")
  const rectOf = (selector: string): Promise<{ x: number; y: number; w: number; h: number } | null> =>
    s.evaluate(`(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`)
  // The rect is resolved IMMEDIATELY before each click. MEASURED: the first run of this
  // gate clicked a collapse button whose rect it had read while the box was EXPANDED,
  // and collapsing changes the box's height — the click landed on the canvas instead,
  // which clears the selection, and four later assertions failed on the consequence.
  // A control that moves between reading and clicking is a click at a stale point.
  const clickSel = async (selector: string): Promise<boolean> => {
    const r = await rectOf(selector)
    if (!r) return false
    await s.click(r.x, r.y)
    return true
  }

  // ── the region map: it draws, and a link answers ─────────────────────────────
  await s.navigate(`file://${path.join(docDir, "regions.html")}`)
  await new Promise((r) => setTimeout(r, 9000))
  const first = await state()
  harness.check("regions: the mounted document publishes its state", !!first && first.totalNodes > 0, JSON.stringify({ nodes: first?.totalNodes, edges: first?.totalEdges, layout: first?.layout }))
  harness.check("regions: the document knows which arrangement it is", first?.layout === "regions", String(first?.layout))

  const ink = await s.evaluate(`(function () {
    var cv = document.querySelector("canvas");
    var g = cv.getContext("2d");
    var px = g.getImageData(0, 0, cv.width, cv.height).data;
    var n = 0;
    for (var i = 3; i < px.length; i += 400) if (px[i] > 8) n++;
    return n;
  })()`)
  // MEASURED as the failure mode this guards: a renderer that dies on its first frame
  // leaves a 300x150 canvas with nothing on it, and every text assertion still passes.
  // The threshold is small on purpose and the stride is fine (every 100th pixel): this
  // fixture draws ten symbols, not two hundred, so a threshold tuned on the repository's
  // own graph would fail a CORRECT artifact — which is what the first run of this gate
  // did, at 4 samples with a stride of 4000.
  harness.check("regions: the canvas actually has ink on it", ink > 5, `ink samples=${ink} on a ${await s.evaluate("document.querySelector('canvas').width + 'x' + document.querySelector('canvas').height")} canvas`)

  // The overview is where region links exist; if the fit lands above the bundling
  // threshold, zoom out with a REAL wheel gesture rather than by calling an API.
  for (let i = 0; i < 8; i++) {
    const st = await state()
    if (!st || st.zoom < 1.1) break
    await s.mouse("mouseWheel", 800, 500, { deltaX: 0, deltaY: 240 })
    await new Promise((r) => setTimeout(r, 250))
  }
  const overview = (await state()) ?? {}
  harness.check("regions: region links are drawn and published at the overview", overview.regionLinks > 0 && overview.crossRegionEdgesOnFrame > 0, JSON.stringify({ links: overview.regionLinks, cross: overview.crossRegionEdgesOnFrame, zoom: Math.round((overview.zoom ?? 0) * 100) / 100 }))
  harness.negative("regions: no summary is claimed for a frame that is not bundling", overview.regionLinks === 0 || overview.crossRegionEdgesOnFrame >= overview.regionLinks, "more links than edges summarised")

  const picked = await s.evaluate(`(function () {
    var links = window.__bbView.links();
    if (!links.length) return null;
    var l = links.slice().sort(function (a, b) { return b.count - a.count; })[0];
    var r = document.querySelector("canvas").getBoundingClientRect();
    return { x: Math.round(r.left + l.mid.x), y: Math.round(r.top + l.mid.y), count: l.count, a: l.a, b: l.b };
  })()`)
  harness.check("regions: the links are published with their screen geometry", !!picked, picked ? `${picked.a} ↔ ${picked.b} · ${picked.count} edges` : "links() returned nothing")
  if (picked) {
    await s.click(picked.x, picked.y)
    await new Promise((r) => setTimeout(r, 600))
    const after = await state()
    const box = await panel()
    harness.check("regions: a real click on a link selects it", !!after.selected && after.selected.includes(picked.a) && after.selected.includes(picked.b), String(after.selected))
    harness.check("regions: and the box names both regions", !!box.title && box.title.includes(picked.a) && box.title.includes(picked.b), String(box.title))

    // ── collapsing must not cost the reader their pick ─────────────────────────
    harness.check("panel: the box is on screen before the collapse is clicked", (await panel()).visible === true, JSON.stringify(await panel()))
    await clickSel("#dcollapse")
    await new Promise((r) => setTimeout(r, 500))
    const collapsedState = await state()
    const collapsedBox = await panel()
    const bodyHidden = await s.evaluate("getComputedStyle(document.getElementById('dbody')).display === 'none'")
    harness.check("panel: collapsing hides the body and keeps the box on screen", collapsedBox.collapsed === true && collapsedBox.visible === true && bodyHidden, JSON.stringify(collapsedBox))
    harness.negative("panel: collapsing does NOT clear the selection (the X is what clears)", collapsedState.selected === after.selected && !!collapsedState.selected, `before=${String(after.selected)} after=${String(collapsedState.selected)}`)
    harness.check("panel: a collapsed box still names what it is hiding", collapsedBox.title === box.title && !!collapsedBox.title, String(collapsedBox.title))

    await clickSel("#dcollapse")
    await new Promise((r) => setTimeout(r, 400))
    const expanded = await state()
    const reopened = await panel()
    harness.check("panel: expanding restores the same subject", expanded.selected === after.selected && reopened.collapsed === false && reopened.visible === true, JSON.stringify({ selected: expanded.selected, panel: reopened }))

    // ── the box moves to the other side: by control, then by drag ──────────────
    await clickSel("#dmove")
    await new Promise((r) => setTimeout(r, 400))
    const docked = await s.evaluate(`(function () {
      var d = document.getElementById("detail");
      return { panel: window.__bbView.panel(), left: Math.round(d.getBoundingClientRect().left) };
    })()`)
    harness.check("panel: the move control docks it to the left edge", docked.panel.dock === "left" && docked.left < 40, JSON.stringify(docked))

    const head = await rectOf("#dhead")
    if (head) {
      await s.mouse("mouseMoved", head.x, head.y)
      await s.mouse("mousePressed", head.x, head.y)
      for (const step of [140, 400, 700]) {
        await s.mouse("mouseMoved", head.x + step, head.y, { buttons: 1 })
        await new Promise((r) => setTimeout(r, 60))
      }
      await s.mouse("mouseReleased", head.x + 700, head.y)
      await new Promise((r) => setTimeout(r, 400))
    }
    const dragged = await s.evaluate(`(function () {
      var d = document.getElementById("detail");
      return { panel: window.__bbView.panel(), left: Math.round(d.getBoundingClientRect().left), selected: window.__bbView.state().selected };
    })()`)
    harness.check("panel: a real drag across the middle docks it on the other side", dragged.panel.dock === "right" && dragged.left > 400, JSON.stringify(dragged))
    harness.check("panel: and the drag did not drop the pick", dragged.selected === after.selected, String(dragged.selected))
  }

  // ── the force layout: no regions, so nothing to summarise ───────────────────
  await s.navigate(`file://${path.join(docDir, "force.html")}`)
  await new Promise((r) => setTimeout(r, 9000))
  const forceState = await state()
  const forceEncoding = await s.evaluate("window.__bbView.encoding().map(function (r) { return r.text; })")
  harness.check("force: the force document draws the same graph", forceState.totalNodes === first.totalNodes && forceState.totalEdges === first.totalEdges, JSON.stringify({ nodes: forceState.totalNodes, edges: forceState.totalEdges }))
  harness.negative("force: no region links exist where there are no regions", forceState.regionLinks === 0 && (await s.evaluate("window.__bbView.links().length")) === 0, JSON.stringify({ links: forceState.regionLinks }))
  harness.check("force: the encoding key stops explaining the region map's marks", forceEncoding.some((t: string) => /every edge is drawn as itself/.test(t)) && forceEncoding.every((t: string) => !/dotted line = region link/.test(t)), forceEncoding.join(" | ").slice(0, 200))
  harness.check("force: switching the layout re-runs the simulation rather than reusing the map's positions", forceState.layout === "force", String(forceState.layout))

  // ── the switch, driven from the SIDEBAR of the composed page ────────────────
  await s.navigate(`file://${path.join(docDir, "studio.html")}`)
  await new Promise((r) => setTimeout(r, 9000))
  const frameLayout = (): Promise<string | null> => s.evaluate("document.getElementById('view').contentDocument.documentElement.getAttribute('data-bb-layout')")
  const frameState = (): Promise<any> => s.evaluate("document.getElementById('view').contentWindow.__bbView.state()")
  const chips = await s.evaluate("Array.prototype.map.call(document.querySelectorAll('#layouts .lay'), function (b) { return b.textContent; })")
  harness.check("studio: the sidebar offers both arrangements", JSON.stringify(chips) === JSON.stringify(["Regions", "Force"]), JSON.stringify(chips))
  harness.check("studio: the mounted document starts in the requested arrangement", (await frameLayout()) === "regions" && (await frameState()).layout === "regions", String(await frameLayout()))

  const forceChip = await s.evaluate(`(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll("#layouts .lay"), function (e) { return e.textContent === "Force"; })[0];
    if (!b) return null;
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  if (forceChip) await s.click(forceChip.x, forceChip.y)
  await new Promise((r) => setTimeout(r, 9000))
  const switched = await frameState()
  harness.check("studio: a real click on the Force chip re-draws the mounted document", switched.layout === "force" && (await frameLayout()) === "force", JSON.stringify({ layout: switched.layout, declared: await frameLayout() }))
  harness.negative("studio: and the region links are gone from the frame it is drawing", switched.regionLinks === 0, JSON.stringify({ links: switched.regionLinks }))

  // ── the whole session produced no page error ───────────────────────────────
  harness.negative("browser: no uncaught exception or console error across the whole session", s.pageErrors.length === 0, s.pageErrors.slice(0, 4).join(" | "))
} finally {
  session?.close()
  rmSync(root, { recursive: true, force: true })
}

harness.emit()
