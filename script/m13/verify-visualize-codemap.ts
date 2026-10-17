// script/m13/verify-visualize-codemap.ts — M13.65 (V11).
//
// THE CODE MAP'S OWN PASS — the third view to move its panels into the one sidebar.
//
// MEASURED, before this pass, on the emitted document: the code map was the only view that
// still painted its own chrome. It carried a 322px sidebar inside the picture holding the
// census, the symbol-kind legend, a `group by` toggle and the search box, a `save as`
// button in the corner, and a path pill down the middle of the map; the mounted viewer
// therefore showed TWO sidebars, one of them inside the drawing.
//
// MEASURED, in the same document: the language of every file was read from `sym.language`,
// which the node projection does not carry — nodes carry `group`, the field the graph's own
// language filter and the tool's language census read. So every file in every code map was
// filed under "unknown", group-by-language produced exactly ONE rectangle, and the picked
// item box reported a language for no symbol in the project.
//
// This gate is BEHAVIOURAL rather than textual, which is the point of it: the emitted
// document is executed against a stub DOM built from the document's OWN markup, so
// `window.__bbView` is not a string that appears in the file — it is the object the artifact
// publishes, called, and its rows are compared against the payload the same document carries.
// The stub is deliberately faithful in one place and ruthless in another: it resolves an
// element by scanning the markup for `id="..."`, so a view that writes to a panel it no
// longer has throws instead of quietly succeeding, and it records the listeners the document
// registers, so a click can be delivered to the artifact and its consequence read back off
// the API.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { renderCodeMapDocument } from "../../src/ast/visualization/code-map-renderer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.65",
  code: "V11",
  tool: "bb_visualize",
  title: "bb_visualize: the code map publishes what the sidebar renders",
  layers: ["unit", "integration"],
  decisions: {
    chrome: "the document draws the map, the search, the readout that changes and the picked-item box; the census, the kinds, the chips, the layout choice and the download controls are published on window.__bbView and drawn by the one sidebar",
    language: "the language of a file is the projection's own field (group), with `language` honoured only as a fallback, so the grouping, the legend and the picked-item box cannot name two different languages for one symbol",
    filters: "a filtered band is MUTED rather than removed: a treemap's areas ARE the line spans, so removing one would leave a hole where code demonstrably is. Muted bands stay counted, searchable and in the data port",
    budget: "both cuts — the noise filter's exclusions and the node budget's — are rows in the census rather than discoveries",
    lod: "a file whose every stripe would fall under MIN_STRIPE_PX at the zoom being drawn is drawn as ONE composition strip, as tall as its cell, whose slices are the lines each kind spans AND the code between them in source order — so the area contract and the muted tone survive the fold, and the count is published rather than implied",
    readability: "readability is judged by a symbol's HONEST share of its cell (span / the file's lines), never by the floored height it is drawn at: the floor is a drawing device, and judging by it made the answer depend on the cell's shape rather than the file's density",
    labels: "a name is printed only when it fits WHOLE — measured with a canvas where one exists, with a documented per-character fallback under the stub — largest area first, each kind capped at half the budget, and a stripe that starts under its cell's header moves its name down instead of losing it",
    concentration: "the census names the share of drawn area held by the largest 20 symbols when it is 25% or more, because a reader looking at a one-colour picture is owed the reason: over src/ the answer is that 93.7% of the spanned lines in scope are functions and methods, and one method spans 3,500 of its file's 6,183 lines",
    layout: "the file layout divides by the file's LAST LINE and positions by absolute line numbers; before this pass it divided by the sum of the symbols' spans while positioning by line numbers, so 8 of 92 files over src/ drew more content than their cell could hold (real-cpp-analyzer.ts drew 7,760 units into 3,513) and every gap band was painted under the band that followed it",
    stub: "the gate executes the emitted script against a stub DOM resolved from the document's own markup: an id the document no longer carries resolves to null, so a regression that paints into a removed panel fails loudly",
  },
  limitations: [
    "The stub DOM is not a browser: layout is not computed (a rect is parsed from the element's own inline style), so this gate proves what the artifact PUBLISHES and DRAWS DECLARES, not where the pixels land. The pixels are V10's job (script/m13/verify-visualize-browser.ts, run as `npm run verify:viz-browser`).",
    "One fixture (2 TypeScript files, 1 Python file, 1 vendored path) plus two hand-built payloads for the cases a fixture cannot produce: a symbol whose `group` and `language` disagree, and a node budget that cuts.",
    "The screenshot evidence for the composed sidebar of the graph view lives in validation/m13/results/viz-layout-panel; the code map's own composed page is asserted structurally here and its document behaviourally.",
    "OUT OF SCOPE, named here because a fixture hit it: squarify's row placement can give one file a cell TALLER than the world it is laid into (measured with two files whose line counts are 30:1 apart: a 62x1,951px cell inside a 1,220px world), so content can hang below the frame. The density assertions therefore use a twelve-file fixture and a 900x600 viewport, where the same payload reproduces the density a reader complains about instead of an artefact of the row placement.",
    "The pixels are still not read here: this gate proves what the artifact DRAWS and PUBLISHES (element counts, gradients, label boxes from inline styles), not where they land. Label clipping measured on screen, and the zoom-settle redraw, belong to V10 (script/m13/verify-visualize-browser.ts).",
  ],
})

// ── the fixture ────────────────────────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v11-"))
const write = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), body)
}
write("src/a.ts", "export function alpha(): number { return beta() }\nexport class Beta { method(): number { return alpha() } }\n")
write("src/b.ts", "export function beta(): number { return 1 }\nexport const gamma = { value: 2 }\n")
write("lib/c.py", "def delta():\n    return 4\n\n\nclass Epsilon:\n    def method(self):\n        return delta()\n")
write("vendor/lib.ts", "export function vendoredThing(): number { return 3 }\n")

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})
const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const reply = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize({ scope: "project", view: "codemap", format: "html", ...args }, ctx)).content[0].text as string

/** The code-map document out of the composed viewer's payload. */
const codemapDocument = async (args: Record<string, unknown> = {}): Promise<string> => {
  const studio = await reply(args)
  const match = studio.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/)
  const payload = match ? (JSON.parse(match[1]) as Record<string, string>) : {}
  return payload.codemap ?? ""
}
/** The payload the document carries as its own data. */
const payloadOf = (doc: string): any => {
  const match = doc.match(/<script id="bb-graph-data" type="application\/json">([\s\S]*?)<\/script>/)
  return match ? JSON.parse(match[1]) : null
}

// ── the stub DOM ───────────────────────────────────────────────────────────────
//
// Small on purpose, and honest about the two things it must get right:
//
//   * `getElementById` resolves against the DOCUMENT'S OWN MARKUP. Every id is collected by
//     scanning the text, and an id that is not there resolves to null -- so a renderer that
//     reaches for a panel it no longer ships fails with a TypeError here, which is exactly
//     what it would do in a browser. A stub with a magic element for every id would pass a
//     view that paints nothing.
//   * listeners are RECORDED, so a real click can be delivered to the artifact's own handler
//     and the consequence read back off the API rather than asserted from the source text.
type StubElement = any

/** Every element under one, following the fragment hops an append makes in a real DOM.
 *  MEASURED: a stub that pushes an appended DocumentFragment as a single child leaves the
 *  group divs and their bands one level deeper than a browser would, which is how the first
 *  version of the painted-band assertion looked at the world and saw nothing. */
function descendants(el: StubElement): StubElement[] {
  const out: StubElement[] = []
  const walk = (node: StubElement): void => {
    for (const child of node?.children ?? []) { out.push(child); walk(child) }
  }
  walk(el)
  return out
}
function makeStubElement(id: string, size: { w: number; h: number } = { w: 1600, h: 1000 }): StubElement {
  const classes = new Set<string>()
  const el: StubElement = {
    id, tagName: "div", children: [] as StubElement[], dataset: {} as Record<string, string>,
    attrs: {} as Record<string, string>, listeners: {} as Record<string, ((ev: any) => void)[]>,
    style: {} as Record<string, string>, textContent: "", title: "", value: "",
    clientWidth: size.w, clientHeight: size.h, parentNode: null,
    appendChild(child: StubElement) { el.children.push(child); child.parentNode = el; return child },
    removeChild(child: StubElement) { el.children = el.children.filter((c: StubElement) => c !== child); return child },
    setAttribute(name: string, value: string) { el.attrs[name] = String(value) },
    getAttribute(name: string) { return el.attrs[name] ?? null },
    addEventListener(type: string, fn: (ev: any) => void) { (el.listeners[type] ??= []).push(fn) },
    classList: {
      add(...names: string[]) { names.forEach((n) => classes.add(n)) },
      remove(...names: string[]) { names.forEach((n) => classes.delete(n)) },
      contains(name: string) { return classes.has(name) },
      toggle(name: string, force?: boolean) {
        const next = force === undefined ? !classes.has(name) : !!force
        if (next) classes.add(name); else classes.delete(name)
        return next
      },
    },
    /** A rect PARSED from the element's own inline style, with a percentage resolved against
     *  the parent's rect. No real layout is computed -- that is the honest limitation of a
     *  stub, and it is enough: this document nests one level (a symbol band inside a file
     *  cell, both positioned absolutely), and the click assertion only needs the box under a
     *  point to be the box the artifact itself would find there. MEASURED: with percentages
     *  read as zero, every band and every gap collapsed to a point at the origin and no click
     *  could land on one -- a stub that cannot be hit proves nothing about picking. */
    getBoundingClientRect() {
      const css = String(el.style.cssText ?? "")
      const parentRect = el.parentNode && el.parentNode !== el ? el.parentNode.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 }
      const pick = (name: string, base: number, span: number): number => {
        const m = css.match(new RegExp(`(?:^|;)${name}:(-?[0-9.]+)(px|%)`))
        if (!m) return 0
        const value = Number(m[1])
        return m[2] === "%" ? base + (span * value) / 100 : value
      }
      const left = pick("left", parentRect.left, parentRect.width)
      const top = pick("top", parentRect.top, parentRect.height)
      const width = pick("width", parentRect.width, parentRect.width)
      const height = pick("height", parentRect.height, parentRect.height)
      const right = Math.max(left + width, left + 0.5)
      const bottom = Math.max(top + height, top + 0.5)
      return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }
    },
    querySelector() { return null },
  }
  // `innerHTML = ""` EMPTIES the element, as it does in a DOM. MEASURED: as a plain property the
  // stub kept every previous frame's children, so the world accumulated three sets of group
  // headings and the assertion about which arrangement is drawn read stale text -- a stub that
  // remembers what the artefact has forgotten is worse than no stub.
  let html = ""
  Object.defineProperty(el, "innerHTML", {
    get() { return html },
    set(value: string) { html = String(value); if (el.children.length) el.children = [] },
  })
  // `className` is the same state as classList, as it is in a DOM: `reportView()` writes it.
  Object.defineProperty(el, "className", {
    get() { return [...classes].join(" ") },
    set(value: string) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((n) => classes.add(n)) },
  })
  return el
}

/** Build the document's world: ids from its own markup, plus the listeners it registers.
 *
 *  The viewport is a parameter because the map's WORLD is derived from it (world = viewport /
 *  FIT_SCALE), and a world is what decides how tall a file cell is -- and therefore whether a
 *  file's stripes are readable at all. MEASURED while writing the level-of-detail section: the
 *  same payload drawn into a 1600x1000 stub produced cells over 700 world-pixels tall, where
 *  even a 300-symbol file legitimately has readable stripes, so the behaviour under test could
 *  not occur. A 900x600 viewport is both a real window size and a world in which the density a
 *  reader actually complains about is reproducible. */
function stubDom(doc: string, payload: unknown, size: { w: number; h: number } = { w: 1600, h: 1000 }) {
  const registry = new Map<string, StubElement>()
  for (const m of doc.matchAll(/id="([\w-]+)"/g)) if (!registry.has(m[1])) registry.set(m[1], makeStubElement(m[1], size))
  const dataEl = registry.get("bb-graph-data")
  if (dataEl) dataEl.textContent = JSON.stringify(payload)
  const docListeners: Record<string, ((ev: any) => void)[]> = {}
  const winListeners: Record<string, ((ev: any) => void)[]> = {}
  const timer: number[] = []
  const document = {
    getElementById: (id: string) => registry.get(id) ?? null,
    querySelector: () => null,
    createElement: () => makeStubElement("", size),
    createDocumentFragment: () => makeStubElement("", size),
    addEventListener: (type: string, fn: (ev: any) => void) => { (docListeners[type] ??= []).push(fn) },
    body: makeStubElement("body", size),
    documentElement: { attrs: {} as Record<string, string>, getAttribute(name: string) { return this.attrs[name] ?? null }, setAttribute(name: string, value: string) { this.attrs[name] = value } },
  }
  const window = {
    addEventListener: (type: string, fn: (ev: any) => void) => { (winListeners[type] ??= []).push(fn) },
    devicePixelRatio: 1, innerWidth: 1600, innerHeight: 1000,
  }
  return { registry, docListeners, winListeners, timer, document, window }
}

function runDocument(doc: string, size: { w: number; h: number } = { w: 1600, h: 1000 }) {
  const payload = payloadOf(doc)
  const dom = stubDom(doc, payload, size)
  // The document's OWN script: the last block before the body closes. MEASURED while writing
  // this gate: anchored with `$` the pattern matched nothing, `new Function("")` is silent, and
  // the gate reported "no API" for a document that publishes one -- a stub that can pass by
  // executing nothing is the failure mode this file exists to avoid, so the script must be
  // found or the gate throws.
  const script = doc.match(/<script>\n([\s\S]*)\n<\/script>\n<\/body>/)?.[1]
  if (!script) throw new Error("bb_visualize: the emitted code-map document has no runnable script block")
  // Executed through the same door a browser uses. A malformed renderer throws here rather
  // than being searched for in the text.
  const fn = new Function("document", "window", "setTimeout", "clearTimeout", script)
  // Two calls, not one expression: the document's IIFE returns undefined, so reading the API
  // off the window has to happen AFTER it has run, not as the second half of a `&&`.
  fn(dom.document, dom.window, (_delayed: () => void) => { dom.timer.push(1) }, () => {})
  return { payload, dom, api: (dom.window as any).__bbView }
}

const emitted = await codemapDocument()
const payload = payloadOf(emitted)
const run = runDocument(emitted)
const api = run.api

// ── the document draws the map and nothing else ─────────────────────────────────
// Each of these ids was IN the document before this pass, with the script writing into it.
harness.check("the document carries its own payload", !!payload && Array.isArray(payload.symbols) && payload.symbols.length > 0, `${payload ? payload.symbols.length : "no payload"} symbols`)
const removedIds = ["side", "hud", "stats", "excluded", "legend", "kind-rows", "group", "g-dir", "g-lang", "mapbtn", "path"]
const stillThere = removedIds.filter((id) => new RegExp(`id="${id}"`).test(emitted))
harness.negative("the document paints no panel of its own (sidebar, legend, census, group toggle, save button, path pill)", stillThere.length === 0, stillThere.length ? `still present: ${stillThere.join(", ")}` : "")
harness.negative("and no rule reaches for one either", !/#(side|hud|stats|kind-rows|legend|mapbtn|path|excluded)\b/.test(emitted), "a rule for a removed panel survives")
harness.check("the map fills its own frame", /#map\{position:absolute;inset:0/.test(emitted), "the map does not own the frame")
harness.check("the search, the readout and the picked-item box are the four overlays", ["id=\"search\"", "id=\"zoomstate\"", "id=\"zoomhint\"", "id=\"detail\""].every((s) => emitted.includes(s)), "an overlay is missing")

// ── the published API ──────────────────────────────────────────────────────────
const ports = ["census", "note", "legend", "encoding", "filters", "state", "layouts", "layout", "setLayout", "data", "fit", "reset", "saveHtml", "panel", "setPanel"]
harness.check("the document publishes window.__bbView", !!api, "no API on the window")
if (!api) { harness.emit(); throw new Error("no API") }
// The PUBLISHED VALUE stays `codemap` (it is an enum callers hold), but the human title is
// "Symbol map": the document draws one rectangle per SYMBOL sized by its line span, and "Code
// map" names Sourcegraph's token-level map of Chromium instead. Both halves are pinned — the
// value so a rename cannot break callers, the title so the word cannot drift back.
harness.check("it says which view it is", api.kind === "codemap" && api.title === "Symbol map", `${api.kind}/${api.title}`)
harness.negative("and it does not call itself a code map in the title", api.title !== "Code Map", String(api.title))
harness.check("every port the sidebar renders is published", ports.every((p) => api[p] !== undefined), ports.filter((p) => api[p] === undefined).join(",") || "all present")
harness.check("and the instruction line is the VIEW's, published as a hint", typeof api.hint === "string" && api.hint.includes("zoom"), String(api.hint).slice(0, 60))
harness.check("a view can still write its own file out", typeof api.saveHtml === "function" && emitted.includes("bb-code-map.html"), "no self-save port")
harness.negative("and the save control is NOT in the picture", !emitted.includes("id=\"mapbtn\""), "a save button still floats over the map")

// ── the census counts the payload the document carries ─────────────────────────
const symbols: any[] = payload.symbols
const expectFiles = new Set(symbols.map((s) => s.filePath)).size
const census: any[] = api.census()
const censusValue = (label: string) => census.find((r) => r.label === label)?.value
harness.check("the census counts the payload's own files", Number(censusValue("files")) === expectFiles, `${censusValue("files")} vs ${expectFiles}`)
harness.check("and its symbols", Number(censusValue("symbols")) === symbols.length, `${censusValue("symbols")} vs ${symbols.length}`)
harness.check("and the lines they span", censusValue("lines spanned") !== undefined, JSON.stringify(census.slice(0, 3)))
harness.check("the group row is named for the arrangement on screen", censusValue("directories") !== undefined, census.map((r) => r.label).join(","))
harness.check("and the census states what the noise filter removed", !!census.find((r) => r.label === "excluded as noise") && api.note().includes("vendor"), api.note().slice(0, 90))
harness.negative("the exclusion note is not a bare count", /vendor/.test(api.note()), "the note does not name the pattern")
harness.check("and the census says the noise row is a caveat", census.find((r) => r.label === "excluded as noise")?.warn === true, JSON.stringify(census.find((r) => r.label === "excluded as noise")))

// ── the node budget is declared rather than discovered ─────────────────────────
const cutDoc = await codemapDocument({ maxNodes: 1 })
const cut = runDocument(cutDoc)
const cutRow = cut.api.census().find((r: any) => r.label === "cut by the node budget")
harness.check("a cut node set is a row in the census", !!cutRow && Number(cutRow.value) === Number(cut.payload.totalNodesAvailable) - Number(cut.payload.shownNodes), JSON.stringify({ row: cutRow, available: cut.payload.totalNodesAvailable, shown: cut.payload.shownNodes }))
harness.negative("and it is not reported as a complete map", Number(cutRow?.value ?? 0) > 0 && cut.api.note().length > 0, JSON.stringify(cutRow))

// ── the languages come from the projection's own field ─────────────────────────
//
// MEASURED before this pass: the document read `sym.language`, the payload carries `group`.
const langs = (a: any): any[] => (a.filters() as any[]).find((f) => f.id === "languages")?.options ?? []
const filterLangs = langs(api).map((o: any) => o.value).sort()
const payloadLangs = [...new Set(symbols.map((s) => String(s.group)))].sort()
harness.check("the Languages are the payload's own field", JSON.stringify(filterLangs) === JSON.stringify(payloadLangs), `${filterLangs.join(",")} vs ${payloadLangs.join(",")}`)
harness.negative("and never the placeholder a field the projection does not carry would produce", !filterLangs.includes("unknown"), filterLangs.join(","))
harness.check("the fixture really does carry a second language", payloadLangs.includes("python") && payloadLangs.includes("typescript"), payloadLangs.join(","))
{
  // The rule itself, on a payload a fixture cannot produce: two fields that disagree.
  const handBuilt = renderCodeMapDocument({
    symbols: [{ id: "x", name: "x", type: "function", group: "python", language: "rust", filePath: "x.py", line: 1, lineEnd: 3 }],
    excluded: null, scope: "project", target: null, totalNodesAvailable: 1, shownNodes: 1,
  } as any)
  const hand = runDocument(handBuilt)
  harness.check("the projection's field WINS when the two disagree", JSON.stringify(langs(hand.api).map((o: any) => o.value)) === JSON.stringify(["python"]), JSON.stringify(langs(hand.api)))
  harness.negative("the fallback is not consulted over it", !langs(hand.api).some((o: any) => o.value === "rust"), JSON.stringify(langs(hand.api)))
}

// ── the symbol kinds are the legend, with counts ───────────────────────────────
const legend: any[] = api.legend()
harness.check("every symbol kind is a legend row", legend.length === new Set(symbols.map((s) => String(s.type))).size, `${legend.length} rows`)
harness.check("the legend counts every symbol exactly once", legend.reduce((a, r) => a + r.count, 0) === symbols.length, `${legend.reduce((a, r) => a + r.count, 0)} vs ${symbols.length}`)
harness.check("and each row carries the colour the map paints it", legend.every((r) => /^#[0-9a-f]{6}$/i.test(String(r.color))), JSON.stringify(legend.slice(0, 2)))
harness.check("the filters offer the kinds and the languages", (api.filters() as any[]).map((f) => f.id).join(",") === "kinds,languages", (api.filters() as any[]).map((f) => f.id).join(","))

// ── the encoding key explains only marks the picture has ───────────────────────
const keyText = (): string => (api.encoding() as any[]).map((r) => r.text).join(" | ")
harness.check("the key covers the area, the gap, staleness and the search", ["area = ", "gap = ", "amber = ", "white outline = "].every((s) => keyText().includes(s)), keyText().slice(0, 120))
harness.check("and it reports a muted band only with its count", /nothing hidden/.test(keyText()) && !/\bnothing hidden\b/.test(keyText().replace("muted = hidden by a filter (nothing hidden)", "")), keyText())
harness.check("it also says what a fill means", /fill = symbol kind/.test(keyText()), keyText())

// ── a filter MUTES; it does not remove ─────────────────────────────────────────
{
  const before = api.state()
  const kinds = (api.filters() as any[]).find((f) => f.id === "kinds")
  const firstKind = kinds.options[0].value
  kinds.set(firstKind, false)
  const after = api.state()
  const censusAfter: any[] = api.census()
  const dataAfter: any = api.data()
  harness.check("hiding a kind is reported, not silent", after.mutedSymbols > 0 && after.mutedSymbols < after.totalSymbols, JSON.stringify({ muted: after.mutedSymbols, total: after.totalSymbols }))
  harness.negative("the census keeps every symbol (a filter is a display decision)", Number(censusAfter.find((r) => r.label === "symbols").value) === symbols.length, JSON.stringify(censusAfter.find((r) => r.label === "symbols")))
  harness.check("and the data port keeps every one of them", dataAfter.nodes.length === symbols.length, `${dataAfter.nodes.length} vs ${symbols.length}`)
  harness.negative("with the muted ones telling the truth about themselves", dataAfter.nodes.some((n: any) => n.muted === true) && dataAfter.nodes.some((n: any) => n.muted === false), "no node is marked either way")
  harness.check("the live line carries the caveat", (after.onScreen as any[]).some((r) => r.warn === true && /muted by a filter/.test(String(r.value))), JSON.stringify(after.onScreen))
  harness.check("the census adds a muted row", !!censusAfter.find((r) => r.label === "muted by a filter"), censusAfter.map((r) => r.label).join(","))
  harness.check("and the key now names the count", /\d+ bands, counted anyway/.test(keyText()), keyText())
  // The DRAWN evidence, not just the published one: the muted bands are in the world.
  const painted = descendants(run.dom.registry.get("world")).map((el) => String(el.style.cssText ?? "")).join("\n")
  harness.check("and the picture itself is muted rather than holed", painted.includes("#2b3040"), "no muted band was painted")
  harness.negative("the census is not short a row either", KindRowSum(api) === symbols.length, String(KindRowSum(api)))
  api.reset()
  harness.check("show everything puts them back", api.state().mutedSymbols === 0, JSON.stringify(api.state().mutedSymbols))
}
function KindRowSum(a: any): number { return (a.legend() as any[]).reduce((n, r) => n + r.count, 0) }

// ── the two arrangements are published and switching re-draws ──────────────────
{
  const layouts = api.layouts() as any[]
  harness.check("both arrangements are published with what each draws", layouts.length === 2 && layouts.map((l) => l.value).join(",") === "dir,lang" && layouts.every((l) => !!l.hint), JSON.stringify(layouts.map((l) => l.label)))
  harness.check("the map opens on directories", api.layout() === "dir" && api.census().some((r: any) => r.label === "directories"), String(api.layout()))
  const dirGroups = api.state().groups
  // What the DRAWN headings say, not just what the census counts: a switch that changed a
  // label and nothing else would pass a count-only assertion whenever the two arrangements
  // happen to have the same number of groups -- which this fixture does (2 directories, 2
  // languages), and which is exactly why the assertion looks at the picture.
  const headings = (): string[] => descendants(run.dom.registry.get("world")).map((el) => String(el.textContent ?? ""))
  const dirHeadings = headings().filter((h) => /\d+ lines?$/.test(h))
  harness.check("the directory arrangement names directories", dirHeadings.some((h) => h.startsWith("src")) && dirHeadings.some((h) => h.startsWith("lib")), dirHeadings.slice(0, 4).join(" | "))
  api.setLayout("lang")
  const langCensus: any[] = api.census()
  harness.check("switching to languages re-lays the map out", api.layout() === "lang" && langCensus.some((r) => r.label === "languages"), JSON.stringify(langCensus.map((r) => r.label)))
  harness.check("and the group count is the number of languages, not of directories", api.state().groups === payloadLangs.length, `${api.state().groups} vs ${payloadLangs.length} languages (was ${dirGroups} directories)`)
  const langHeadings = headings().filter((h) => /\d+ lines?$/.test(h))
  harness.check("the language arrangement names languages", langHeadings.some((h) => h.startsWith("python")) && langHeadings.some((h) => h.startsWith("typescript")), langHeadings.slice(0, 4).join(" | "))
  harness.negative("and it is not the same arrangement under a different name", langHeadings.join("|") !== dirHeadings.join("|") && !langHeadings.some((h) => h.startsWith("src")), `${dirHeadings.join("|")} -> ${langHeadings.join("|")}`)
  api.setLayout("dir")
  harness.check("and the choice goes back", api.layout() === "dir" && api.state().groups === dirGroups, String(api.layout()))
}

// ── the picked-item box: hiding it is not clearing it ──────────────────────────
{
  const world = run.dom.registry.get("world")
  const fileBox = descendants(world).find((el) => String(el.dataset?.file ?? "").length > 0)
  harness.check("the map drew a file cell to click", !!fileBox, "no file cell in the world")
  // The MAP's own listener, not the document's. MEASURED in a real browser (V10): with the pick
  // handler on `document`, a click on the picked-item box's own X cleared the selection and then
  // the same click re-picked whatever lay under the panel, so the control could not clear it.
  const listeners = run.dom.registry.get("map")?.listeners.click ?? []
  harness.check("the map registers its own click handler", listeners.length > 0, "no click listener on the map")
  harness.negative("and the document does not pick on every click", (run.dom.docListeners.click ?? []).length === 0, "a document-level pick handler survives")
  const clickAt = (el: any): void => {
    const r = el.getBoundingClientRect()
    const x = r.left + Math.max(0.5, r.width / 2), y = r.top + Math.max(0.5, r.height / 2)
    for (const fn of listeners) fn({ clientX: x, clientY: y, target: el })
  }
  // A symbol BAND first (the innermost drawn box, which is what a reader aims at), then the
  // file cell: whichever the artifact's own boxAt finds at that point is its business, and
  // the assertion is that a click picks what is under it rather than nothing.
  const bands = descendants(fileBox).filter((el) => /height:[0-9.]+%/.test(String(el.style.cssText ?? "")) && !/background:#1e2130/.test(String(el.style.cssText ?? "")))
  harness.check("and symbol bands inside it", bands.length > 0, `${bands.length} bands`)
  let picked: string | null = null
  for (const el of [...bands, fileBox]) {
    clickAt(el)
    picked = api.state().selected
    if (picked) break
  }
  harness.check("clicking a cell picks it", typeof picked === "string" && picked.length > 0, String(picked))
  harness.check("and the box says what it is about", api.panel().visible === true && String(api.panel().title).length > 0, JSON.stringify(api.panel()))
  const collapsed = api.setPanel({ collapsed: true })
  harness.check("collapsing hides the box and keeps the pick", collapsed.collapsed === true && collapsed.visible === true && api.state().selected === picked, JSON.stringify({ panel: collapsed, selected: api.state().selected }))
  harness.negative("and the heading still names it", String(collapsed.title).length > 0 && String(collapsed.title) !== "nothing picked", String(collapsed.title))
  api.setPanel({ collapsed: false })
  harness.check("expanding it again changes nothing else", api.panel().collapsed === false && api.state().selected === picked, JSON.stringify(api.panel()))
  const close = run.dom.registry.get("dclose")
  harness.check("the X is the control that clears", typeof close?.onclick === "function", "no close handler")
  if (typeof close?.onclick === "function") close.onclick()
  harness.check("and it does clear", api.state().selected === null && api.panel().visible === false, JSON.stringify({ selected: api.state().selected, panel: api.panel() }))
}

// ── the zoom readout, at the two scales it has to be right at ──────────────────
//
// MEASURED in a real browser on the emitted src/ document, before this pass: three wheel
// notches took the published zoom from 0.8 to 3.377, and the pill's own text still read
// "whole map \u00b7 scroll to zoom in" \u2014 because the predicate was `view.k >= fitScale()`,
// which is true at the fit AND at every scale above it, while the class that SHOWS the pill is
// set exactly when the whole map is NOT on screen. The readout was therefore never displayed
// at any zoom, and wrong in the only state where a reader could have read it: a reader who had
// zoomed into a corner of the map was told they were looking at everything. The wheel is
// delivered to the artifact's OWN listener, the way a reader's gesture arrives, and the pill is
// read back off the document rather than off a string in it.
{
  const pill = run.dom.registry.get("zoomstate")
  const mapEl = run.dom.registry.get("map")
  const wheel = mapEl?.listeners.wheel ?? []
  harness.check("the map registers its own wheel handler", wheel.length > 0, "no wheel listener on the map")
  const fitZoom = Number((api.state().lod as any).zoom)
  const pillClass = (): string => String(pill?.className ?? "")
  const pillText = (): string => String(pill?.textContent ?? "")
  harness.check("at the fit the readout says the whole map is on screen, and stays out of the way",
    /whole map/.test(pillText()) && !pillClass().includes("on"), JSON.stringify({ text: pillText(), cls: pillClass(), fitZoom }))
  const mapRect = mapEl!.getBoundingClientRect()
  const scroll = (deltaY: number): void => {
    for (const fn of wheel) fn({ clientX: mapRect.left + mapRect.width / 2, clientY: mapRect.top + mapRect.height / 2, deltaY, preventDefault() {} })
  }
  scroll(-300)
  scroll(-300)
  scroll(-300)
  const zoomed = Number((api.state().lod as any).zoom)
  harness.check("a wheel gesture zooms the map and the readout names the scale it reached",
    zoomed > fitZoom * 2 && new RegExp(`^${Math.round(zoomed * 100)}% \\u00b7 `).test(pillText()) && pillClass().includes("on"),
    JSON.stringify({ fitZoom, zoomed, text: pillText(), cls: pillClass() }))
  harness.negative("so a reader zoomed into a corner is not told they are looking at everything",
    !/whole map/.test(pillText()), JSON.stringify({ text: pillText(), zoomed }))
  api.fit()
  harness.check("and fitting it again puts the readout back to the whole map",
    /whole map/.test(pillText()) && !pillClass().includes("on"), JSON.stringify({ text: pillText(), cls: pillClass() }))
}

// ── the readout that changes ───────────────────────────────────────────────────
{
  const rows: any[] = api.state().onScreen
  const labels = rows.map((r) => r.label).filter(Boolean)
  harness.check("the live line counts what the frame holds", labels.includes("symbols") && labels.includes("files") && labels.includes("zoom"), JSON.stringify(labels))
  harness.negative("in the code map's own words, not the graph's", !labels.includes("nodes") && !labels.includes("edges"), JSON.stringify(labels))
  const q = run.dom.registry.get("q")
  q.value = "alpha"
  for (const fn of q.listeners.input ?? []) fn({})
  const searched = api.state()
  harness.check("typing in the search reports the matches", searched.search === "alpha" && (searched.onScreen as any[]).some((r) => r.label === "matches"), JSON.stringify(searched.onScreen))
  harness.check("and the box over the map carries the same count", /\d+ match/.test(String(run.dom.registry.get("qstat").textContent)), String(run.dom.registry.get("qstat").textContent))
  harness.negative("the readout is the view's, so the shell cannot disagree with it", typeof searched.zoom === "number" && searched.zoom > 0, String(searched.zoom))
}

// ── the data port speaks the sidebar's shape ───────────────────────────────────
{
  const data: any = api.data()
  const node = data.nodes[0]
  const wanted = ["id", "name", "type", "group", "filePath", "line", "lineEnd", "qualifiedName", "gravity", "stale"]
  const missing = wanted.filter((k) => !(k in node))
  harness.check("every node carries the fields the sidebar's CSV writes", missing.length === 0, missing.length ? `missing ${missing.join(",")}` : wanted.join(","))
  harness.check("the language rides `group`, the field the whole tool reads", payloadLangs.includes(String(node.group)), String(node.group))
  harness.check("the map states that it has no edges, rather than omitting the key", Array.isArray(data.links) && data.links.length === 0, JSON.stringify(data.links))
  harness.check("and the port still identifies the view it came from", data.view === "codemap" && data.scope === "project", `${data.view}/${data.scope}`)
}

// ── the composed viewer renders what the view publishes ────────────────────────
{
  const studio = await reply({})
  // The shell's own code, with comments stripped: the explanation of what USED to be there is
  // part of the file and must not be mistaken for the behaviour. MEASURED: the first version of
  // these two checks failed on the shell's own comment saying it no longer reads st.regionLinks.
  const shellCode = (studio.match(/<script>\n([\s\S]*?)\n<\/script>/g) ?? []).join("\n").replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
  harness.check("the shell renders the rows the VIEW publishes", shellCode.includes("state().onScreen") && shellCode.includes("function updateLive()"), "the shell still builds the line itself")
  harness.negative("and does not know what a region link is", !shellCode.includes("st.regionLinks") && !shellCode.includes("region link stands"), "graph vocabulary survives in the shell's code")
  harness.check("the instruction line comes from the view too", shellCode.includes("(view && view.hint)"), "the shell does not read the view's hint")
  harness.negative("and the graph's sentence is not the shell's any more", !shellCode.includes("click a node to focus"), "the shell still holds the graph's instruction sentence")
  harness.check("the downloads are switched per PORT, not per view", studio.includes("function dataPorts(view)") && studio.includes("ports[kind]"), "no per-port decision")
  harness.negative("so a view with no edges cannot hand out an empty CSV", /kind === "edges" \? "this view draws no edges"/.test(studio), "the edges button is not explained")
  harness.check("and the fallback note names the view it is about", studio.includes("does not publish a sidebar API yet") && studio.includes("fallbackEl.textContent = label +"), "the note does not name the view")
  const graphView = (JSON.parse((studio.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/) ?? ["", "{}"])[1]) as Record<string, string>).graph ?? ""
  harness.check("the graph view publishes the same rows", graphView.includes("function onScreenRows()") && graphView.includes("onScreen: onScreenRows()"), "the graph does not publish rows")
  harness.check("and the reconciliation moved into the graph's own row", graphView.includes("region link stands") && graphView.includes("cross-region edges"), "the sentence is gone")
}

// ── THE LEVEL OF DETAIL: what a frame could not draw one-to-one, and what it says about it ──
//
// MEASURED, and this is why the section exists. Reported of the emitted map over src/: "the
// only thing I see is cyan throughout, nothing is readable". Measured in a real browser at
// 142 files and 1,770 symbols: 1,633 of 3,232 painted stripes were UNDER ONE DEVICE PIXEL
// tall (median 0.94px), 52.9% of the frame's pixels were the one colour the function family
// uses, 59 of 142 files were named and 21 of those names were cut off with an ellipsis. The
// wash was the data -- 93.7% of the spanned lines in that scope ARE functions and methods,
// and one method, RealCppAnalyzer.analyze, spans 3,500 of its file's 6,183 lines -- so the
// pass is about what the DRAWING does with a shape like that, not about recolouring it.
{
  // A dense file: 300 one-line symbols and no big one. Every stripe it would get is under the
  // floor at the fit scale, so the whole file must become ONE bar.
  //
  // The fixture is a DOZEN comparable files on purpose, and that is a measurement rather than
  // tidiness: with two files whose line counts are 30:1 apart, the treemap's own row placement
  // gives the small one a 62x1951 cell -- taller than the 1,220px world it is laid into -- and
  // a 300-line file in a 1,951px-tall cell legitimately has stripes above the floor, so the
  // behaviour under test never happens. (That overshoot is a pre-existing defect of the row
  // placement, out of scope here, and noted in this gate's limitations.) Twelve files of the
  // same size produce the square-ish cells a real tree produces.
  const dense: any[] = []
  for (let i = 0; i < 300; i++) {
    dense.push({ id: `d${i}`, name: `tiny${i}`, qualifiedName: `Dense.tiny${i}`, type: i % 2 ? "function" : "constant", group: "typescript", filePath: "src/dense.ts", line: i * 3 + 1, lineEnd: i * 3 + 1 })
  }
  const peers: any[] = []
  for (let f = 0; f < 11; f++) {
    for (let s = 0; s < 6; s++) {
      peers.push({ id: `p${f}_${s}`, name: `part${s}`, qualifiedName: `Peer${f}.part${s}`, type: s % 2 ? "function" : "interface", group: "typescript", filePath: `src/peer${f}.ts`, line: s * 50 + 1, lineEnd: s * 50 + 45 })
    }
  }
  // A file with ONE enormous method, which must keep its stripes so the big thing can be named.
  const mixed = [
    { id: "big", name: "analyze", qualifiedName: "BigAnalyzer.analyze", type: "method", group: "typescript", filePath: "src/big.ts", line: 10, lineEnd: 9000 },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, name: `helper${i}`, qualifiedName: `BigAnalyzer.helper${i}`, type: "property", group: "typescript", filePath: "src/big.ts", line: 9001 + i, lineEnd: 9001 + i })),
  ]
  const doc = renderCodeMapDocument({ symbols: [...dense, ...peers, ...mixed], excluded: null, scope: "project", target: null, totalNodesAvailable: 637, shownNodes: 637 } as any)
  const run2 = runDocument(doc, { w: 900, h: 600 })
  const api2 = run2.api
  const world2 = descendants(run2.dom.registry.get("world"))
  const css2 = (el: any): string => String(el.style?.cssText ?? "")
  const cells = world2.filter((el) => String(el.dataset?.file ?? "").length > 0)
  const denseCell = cells.find((el) => String(el.dataset.file).includes("dense"))
  const denseKids = (denseCell?.children ?? []).filter((el: any) => el.tagName === "div")

  harness.check("a file whose every stripe is under the floor is drawn as ONE element", denseKids.length === 1, `${denseKids.length} elements`)
  const stripCss = css2(denseKids[0])
  harness.check("and it fills its cell rather than sitting at a sub-pixel height", /height:100%/.test(stripCss), stripCss.slice(0, 120))
  harness.check("it carries the kinds as slices, in source order, at their line proportions", /linear-gradient\(to bottom,#5eead4 0\.000%.*#fb923c/.test(stripCss) || (stripCss.match(/#[0-9a-f]{6}/g) ?? []).length >= 3, stripCss.slice(0, 200))
  harness.check("and the code BETWEEN the symbols is a slice of it too, not a hole", stripCss.includes("#1e2130"), stripCss.slice(0, 200))
  harness.negative("so a reader is not shown 300 invisible smears", !world2.some((el) => css2(el).includes("height:0.35%")), "a sub-pixel stripe is still painted")

  const lod = api2.state().lod as any
  harness.check("the fold is published with the frame, not left to be discovered", lod && lod.foldedSymbols > 0 && lod.compositionStrips >= 1, JSON.stringify(lod))
  harness.check("and the published element count is the drawn element count", lod.drawnElements === lod.stripesDrawn + lod.gapBands + lod.compositionStrips, JSON.stringify(lod))
  harness.check("every element inside a file cell is a stripe, a gap or a strip", world2.filter((el) => String(el.dataset?.file ?? "").length > 0 || el.parentNode?.dataset?.file).length >= lod.drawnElements, `${world2.length} elements vs ${lod.drawnElements} claimed`)
  harness.check("the threshold it folded at is published too, so the number can be read", lod.minStripePx === 2 && lod.zoom > 0, JSON.stringify({ min: lod.minStripePx, zoom: lod.zoom }))

  // A file that contains something big KEEPS its stripes, so the big thing can be named.
  const bigCell = cells.find((el) => String(el.dataset.file).includes("big"))
  const bigKids = (bigCell?.children ?? []).filter((el: any) => el.tagName === "div")
  harness.check("a file with one enormous method is still drawn as stripes", bigKids.length > 1, `${bigKids.length} elements`)
  const names = world2.map((el) => String(el.textContent ?? ""))
  harness.check("and the enormous method is NAMED in the picture", names.includes("BigAnalyzer.analyze"), JSON.stringify(names.filter((n) => n.includes("analyze"))))
  // Both names are printed -- the cell's and the stripe's -- and the assertion is that they do
  // not land on each other, because a collision that hides a name is the same defect as a name
  // that was never offered. MEASURED on this fixture: the method starts at 0.1% of its cell, so
  // its stripe begins under the cell's own header and its name has to move down to exist.
  const symLabel = world2.find((el) => String(el.className ?? "").includes("sym-name"))
  const fileLabel = world2.find((el) => String(el.className ?? "") === "fname")
  const overlap = (() => {
    if (!symLabel || !fileLabel) return true
    const a = symLabel.getBoundingClientRect(), b = fileLabel.getBoundingClientRect()
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  })()
  harness.negative("with its own name beside its cell's name, not on top of it", !!symLabel && !!fileLabel && !overlap, JSON.stringify({ sym: symLabel?.textContent, file: fileLabel?.textContent, overlap }))
  harness.check("and the cell still names itself", !!fileLabel && String(fileLabel.textContent).includes("big"), JSON.stringify(world2.map((el) => el.textContent).filter((t) => String(t).includes("big"))))
  const labelEls = world2.filter((el) => String(el.className ?? "").includes("fname"))
  harness.check("every drawn name has room for the whole string", labelEls.every((el) => !!String(el.textContent).length && !/\.\.\.|\u2026/.test(String(el.textContent))), JSON.stringify(labelEls.map((el) => el.textContent).slice(0, 4)))
  harness.negative("so no name in the artifact is a truncated one", !world2.some((el) => /\.\.\.|\u2026/.test(String(el.textContent ?? ""))), "a truncated name is in the world")

  harness.check("the readout says what was folded, and how many files became one bar", (api2.state().onScreen as any[]).some((r) => r.label === "stripe detail" && /composition strip/.test(String(r.value))), JSON.stringify(api2.state().onScreen))
  harness.check("and says it as a caveat rather than as a fact about the code", (api2.state().onScreen as any[]).find((r) => r.label === "stripe detail")?.warn === true, JSON.stringify((api2.state().onScreen as any[]).find((r) => r.label === "stripe detail")))
  harness.check("the encoding key gains the mark the picture actually has", api2.encoding().some((r: any) => /a strip = /.test(String(r.text))), JSON.stringify(api2.encoding().slice(-1)))
  harness.check("the readout also counts the names it could NOT print", (api2.state().onScreen as any[]).some((r) => r.label === "names" && /files/.test(String(r.value))), JSON.stringify((api2.state().onScreen as any[]).filter((r) => r.label === "names")))

  // The concentration, said out loud. The dense payload is 97% one method by area.
  harness.check("a picture the data made concentrated says so", api2.census().some((r: any) => /^largest \d+ symbols$/.test(String(r.label)) && /% of the drawn area/.test(String(r.value))), JSON.stringify(api2.census()))
  // …and a picture that is NOT concentrated does not get the row: 200 uniform spans put the
  // largest 20 at 10% of the area, and a sentence about a shape the picture does not have is
  // the same defect as a key for a mark that is not drawn.
  const flat = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, name: `even${i}`, qualifiedName: `Even.even${i}`, type: "function", group: "typescript", filePath: `src/e${i % 10}.ts`, line: i * 2 + 1, lineEnd: i * 2 + 1 }))
  const flatRun = runDocument(renderCodeMapDocument({ symbols: flat, excluded: null, scope: "project", target: null, totalNodesAvailable: 200, shownNodes: 200 } as any))
  harness.negative("and a picture that is not concentrated does not get it", !flatRun.api.census().some((r: any) => /^largest \d+ symbols$/.test(String(r.label))), JSON.stringify(flatRun.api.census()))

  // Every file cell carries a hairline, which is what turns a wash into countable cells.
  harness.check("every file cell is edged, so two same-kind files cannot merge into one field", cells.length > 0 && cells.every((el) => /box-shadow:inset/.test(css2(el))), `${cells.filter((el) => /box-shadow:inset/.test(css2(el))).length} of ${cells.length}`)
}

rmSync(root, { recursive: true, force: true })
harness.emit()
