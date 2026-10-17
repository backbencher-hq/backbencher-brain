// script/m13/verify-visualize-views.ts — M13.61 (V7).
//
// `view` MUST SURVIVE ITS OWN FORMATS — the gate for F4, F11, F14, F15 and F16.
//
// Measured before the fix:
//   (a) text: `view: "codemap"` and `view: "class"` produced BYTE-IDENTICAL text
//       to `view: "graph"`, and the word "codemap" appeared nowhere in it;
//   (b) html: the studio slots were built as [requested, codemap, class], so
//       `view: "codemap"` shipped [codemap, codemap, class] — two byte-identical
//       42,187-byte documents, the code map in the tab labelled Graph, no
//       force-directed map in the artifact at all, and the requested view not
//       mounted;
//   (c) the studio keyed its injected CSS on the TAB it had mounted rather than on
//       the document it held, so the code map got the GRAPH's rules;
//   (d) those rules were `#hud, #legend { display: none !important; }` — the whole
//       census panel (nodes, edges, stored rows, heaviest edge, languages, stale
//       count, excluded note) and the whole decoding key (size = gravity, hollow
//       ring = stale, opacity = confidence, thickness = stored rows) were hidden in
//       the only delivery that is a picture;
//   (e) the studio dispatched a synthetic WheelEvent (deltaY -420, about 2x zoom)
//       into the map on load, so the same graph read "showing 140 of 200 nodes"
//       standalone and "118 of 200" in the studio, with no way back to the fit;
//   (f) the census's `node types` value was `.length` of a COUNT and had never
//       rendered.
//
// The assertions are made on the ARTIFACTS (the text reply, the payload of the
// studio document, the three renderer documents), because that is what a caller
// receives. There is no DOM in this repository's dev dependencies, so the studio's
// own composition rules are asserted at the source level: which value the style
// branch reads, and that the panels it must not hide are still present in the
// document it composes.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.61", code: "V7", tool: "bb_visualize",
  title: "bb_visualize: view fidelity — text names it, html mounts it, panels survive",
  layers: ["unit", "integration"],
  decisions: {
    slots: "each studio slot holds the document of its OWN view, asserted from the embedded payload",
    mounting: "the mounted view is the requested one, asserted on the studio's own mount() call",
    selfDescribing: "every renderer document declares data-bb-view on its <html>, and the studio reads that (not the tab)",
    panels: "no rule hides #hud/#legend; the census expression is the count itself, not `.length` of a count",
    regions: "nodes are grouped by their DIRECTORY (a directory of fewer than three symbols folds into its parent), anchored per region, and drawn as named pods; the Modules filter reads the same grouping, and the nodes carry it",
    edges: "an aggregate picture draws the heaviest edges up to a zoom-dependent cap and says so, and an edge's alpha falls off with its on-screen span",
    layouts: "the graph has TWO arrangements — the directory map and the plain force graph — the document declares which one it draws (data-bb-layout, read back by the renderer), both are published with what each draws, the reply names the one it will draw, and switching restarts the simulation instead of reusing the other layout's positions",
    panel: "collapsing the picked-item box hides it and KEEPS the selection (clearing is the X's job alone), the box docks to either side by control or by dragging its heading, and a collapsed box still names what it is hiding",
  },
  limitations: [
    "No DOM/browser dependency exists in this repository, so the studio is asserted structurally HERE; the pixels and the interactions are now a gate of their own — script/m13/verify-visualize-browser.ts (M13.64 / V10), run as `npm run verify:viz-browser`, which drives the artifact over CDP in a real chromium without adding a browser dependency to this repository.",
    "Interaction (drag, hover, tab switching) is not exercised by THIS file; the layout switch, the collapse/dock behaviour and the drag belong to V10 (script/m13/verify-visualize-browser.ts), and the screenshots that show them are in validation/m13/results/viz-layout-panel.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v7-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function a(): number { return b() }\nexport function b(): number { return 1 }\n")
const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const text = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize(args, ctx)).content[0].text as string
const VIEWS = ["graph", "codemap", "class"] as const

// ── text names the picture ──────────────────────────────────────────────────
for (const view of VIEWS) {
  const reply = await text({ scope: "project", view, format: "text" })
  harness.check(`text: names view=${view}`, reply.includes(`view: ${view} `), reply.split("\n").slice(0, 3).join(" | ").slice(0, 140))
}

// ── json carries it ─────────────────────────────────────────────────────────
for (const view of VIEWS) {
  const parsed = JSON.parse(await text({ scope: "project", view, format: "json" }))
  harness.check(`json: view=${view}`, parsed.view === view, String(parsed.view))
}

// ── html: three slots, each holding its OWN view's document ─────────────────
const studioFor = async (view: string, extra: Record<string, unknown> = {}): Promise<{ html: string; payload: Record<string, string> }> => {
  const html = await text({ scope: "project", view, ...extra, format: "html" })
  const match = html.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/)
  return { html, payload: match ? (JSON.parse(match[1]) as Record<string, string>) : {} }
}

{
  const { html, payload } = await studioFor("codemap")
  const slots = Object.keys(payload)
  harness.check("html: the payload has the three view slots", JSON.stringify(slots.sort()) === JSON.stringify(["class", "codemap", "graph"]), JSON.stringify(slots))
  for (const view of VIEWS) {
    const doc = payload[view] ?? ""
    const declared = doc.match(/<html[^>]*data-bb-view="(\w+)"/)
    harness.check(`html: the ${view} slot holds a document that declares itself ${view}`, !!declared && declared[1] === view, declared ? declared[1] : "no declaration")
  }
  const lengths = new Set(VIEWS.map((view) => (payload[view] ?? "").length))
  harness.negative("html: the three documents are distinct (no slot is a duplicate of another)", lengths.size === 3, JSON.stringify([...lengths]))
  harness.check("html: the requested view is the one mounted", html.includes('mount("codemap")'), (html.match(/mount\("\w+"\)/g) ?? []).join(","))
  harness.negative("html: and no other view is mounted in its place", !html.includes('mount("graph")') && !html.includes('mount("class")'), (html.match(/mount\("\w+"\)/g) ?? []).join(","))
  // THE LABEL IS PINNED, and it is "Symbol map" on purpose: the view drew one rectangle per
  // symbol and called itself "Code map", which is the name of a different artifact (Sourcegraph's
  // Chromium map draws every token). The negative twin is what keeps the old word from drifting
  // back in — a label that promises a token map is a lie, however well the picture renders.
  harness.check("html: the status line names the mounted view by the label the page uses", html.includes("Symbol map view loaded"), "status missing")
  harness.negative("html: and the retired label is gone from the studio chrome", !html.includes("Code map view loaded") && !html.includes("\u25b8Code map") && !html.includes("</span>Code map"), "the old label is still in the shell")

  const graphStudio = await studioFor("graph")
  harness.check("html: view=graph mounts the map", graphStudio.html.includes('mount("graph")') && !graphStudio.html.includes('mount("codemap")'), (graphStudio.html.match(/mount\("\w+"\)/g) ?? []).join(","))
  const classStudio = await studioFor("class")
  harness.check("html: view=class mounts the UML document", classStudio.html.includes('mount("class")') && !classStudio.html.includes('mount("graph")'), (classStudio.html.match(/mount\("\w+"\)/g) ?? []).join(","))

  // ── the panels live in the SIDEBAR, and the VIEW publishes them (F11) ──────
  //
  // This pass moved the census, the filters and the encoding key out of the map
  // document's four corners and into the one sidebar, because the review said the
  // drawing should be the screen and the controls should be one column beside it.
  // What must NOT regress is the original property: the numbers have to be VISIBLE
  // in the delivery that is a picture, and the view — not the shell — is what knows
  // them. So the shell is asserted to carry the containers, and the map document is
  // asserted to publish the data those containers render.
  const hiddenSections = /#census[^{]*\{[^}]*display:\s*none/i.test(html) || /#encoding[^{]*\{[^}]*display:\s*none/i.test(html)
  harness.negative("studio: no rule hides the census or the encoding key", !hiddenSections, hiddenSections ? "a rule hides a sidebar section" : "")
  harness.check("studio: the sidebar carries the census", html.includes('id="census"'), "no #census in the shell")
  harness.check("studio: and the encoding key", html.includes('id="encoding"'), "no #encoding in the shell")
  harness.check("studio: and the filters beside the graph", html.includes('id="filters"'), "no #filters in the shell")
  const graphDoc = payload.graph ?? ""
  harness.check("map: publishes its census to the mount", graphDoc.includes("window.__bbView") && graphDoc.includes("census: censusRows"), "no census API")
  harness.check("map: publishes the encoding key", graphDoc.includes("encoding: encodingRows"), "no encoding API")
  harness.check("map: publishes the filters", graphDoc.includes("filters: filterOptions"), "no filters API")
  harness.check("studio: the sidebar is built from the mounted document's API", html.includes("win.__bbView") && html.includes("function api()"), "no api() in the shell")

  // ── composition keyed on the DOCUMENT (F14) ────────────────────────────────
  harness.check("studio: the style branch reads the document's own declaration", html.includes('getAttribute("data-bb-view")') && html.includes("function documentView()"), "no documentView()")
  harness.negative("studio: the style branch no longer branches on the mounted tab", !/if \(frame\.dataset\.mode/.test(html), "still branching on frame.dataset.mode")

  // ── no synthetic input, and a fit control instead (F16) ───────────────────
  //
  // The assertion looks for the CALL, not for the word: the script's own comment
  // explains why the wheel dispatch is gone, and a check that matched the prose
  // would fail on the explanation instead of on the behaviour.
  harness.negative("studio: no synthetic input on load", !html.includes("dispatchEvent(") && !html.includes("deltaY:"), "the studio still dispatches an event")
  harness.check("map: the fit frames every visible node", graphDoc.includes("function fitAll()") && graphDoc.includes("if (nodeHidden(nd)) continue;"), "no fitAll() over visible nodes")
  harness.check("studio: and the sidebar calls it", html.includes('id="fit"') && html.includes("v.fit()"), "no fit wiring in the shell")

  // ── the map is drawn as NAMED REGIONS, and the edge cut is named (this pass) ──
  //
  // These are the assertions for the redesign that followed the review: the drawing
  // used to be one force-laid ball with every edge at full alpha, and a screenshot of
  // it showed a purple smear with no parts in it. What must not regress is the
  // property that replaced it -- the map is parts, each part is named, and the
  // sidebar can turn a part off.
  harness.check("map: every node carries the region it was grouped into", graphDoc.includes("N[ni2].module = order[r2];"), "no region published on nodes")
  harness.check("map: a region is a DIRECTORY, not a file", graphDoc.includes("function dirOf(nd)") && graphDoc.includes("parts.pop();"), "no directory rule")
  harness.check("map: a directory of fewer than three symbols folds into its parent", graphDoc.includes("raw[k3].length >= 3"), "no fold rule")
  harness.check("map: regions are drawn as named pods", graphDoc.includes("function podOf(pts, pad)") && graphDoc.includes("function podPath(p)") && graphDoc.includes("ctx.fillText(label, lx, ly);"), "no pod drawing")
  harness.check("map: the Modules filter is a real group with real counts", graphDoc.includes('{ id: "modules", label: "Modules"') && graphDoc.includes("MODULES.map(function (m)"), "no Modules filter group")
  harness.check("map: and it gates the drawn nodes", graphDoc.includes("!!hiddenModules[nd.module]"), "the Modules filter does not gate anything")
  harness.check("map: the layout pulls members toward their region's anchor", graphDoc.includes("pos[m2].vx += (an2.x - pos[m2].x) * 0.12;"), "no anchor pull")
  harness.check("map: region positions come from the anchors, shapes from the simulation", graphDoc.includes("nodes[q3].x = (qan.x - W0 / 2) + (qdx / qd) * qr;"), "no anchored placement")
  harness.check("map: coincident members are spread, so every symbol is drawn", graphDoc.includes("var TAKEN = {}, CELL = 15;"), "no de-overlap pass")
  harness.check("map: the edge cap is heaviest-first and the readout names it", graphDoc.includes("function edgeBudget(edges, focus)") && graphDoc.includes("the heaviest \" + drawnE + \" drawn at this zoom, zoom in for the rest"), "no edge budget")
  harness.check("map: an edge's alpha falls off with its on-screen span", graphDoc.includes("var locality = Math.max(0, 1 - span / 420);"), "no span weighting")

  // ── the overview draws REGION LINKS, and says so (second redesign pass) ─────
  //
  // MEASURED in the artifact's own screenshot after the first pass: 15 correctly named
  // pods, and a purple web of ~300 long cross-region edges over every one of them. A
  // region is the unit of this drawing, so at the overview the unit of an edge is a
  // region PAIR -- one line per pair, width and alpha from how many stored edges it
  // stands for -- and the individual edges return when the reader zooms in or focuses
  // a node. What must not regress is that the summary is REPORTED, in the frame and in
  // the sidebar, rather than looking like a graph with 40 edges in it.
  // The bundling is now conditional on the layout: a summary needs regions to summarise
  // between, and the force layout has none. The assertion follows the contract rather
  // than the old spelling of it.
  harness.check("map: cross-region edges are bundled per region pair at the overview", graphDoc.includes("var bundling = regions() && !focus && !q2 && view.k < BUNDLE_K;") && graphDoc.includes('kind: "regionLink"'), "no bundling")
  harness.check("map: the bundle is keyed on the pair, not on one edge", graphDoc.includes("var pk = k1 < k2 ?"), "no pair key")
  harness.check("map: with a cap that is named rather than silent", graphDoc.includes("bundles = pairs.length > 48 ? pairs.slice(0, 48) : pairs;") && graphDoc.includes("lastPairs = pairs.length;"), "no cap")
  harness.check("map: the readout reconciles the canvas with the census", graphDoc.includes("cross-region edges summarised as") && graphDoc.includes("zoom in or double-click a link to open them"), "no summary sentence")
  harness.negative("map: and the readout fires whenever it is bundling", graphDoc.includes("if (bundling || drawnE < liveE || drawnN < liveN || filtered)"), "the summary can be invisible")
  harness.check("map: a link is pickable and opens both regions", graphDoc.includes("function frameLink(l)") && graphDoc.includes("if (p && p.kind === \"regionLink\") { frameLink(p); return; }"), "no link interaction")
  harness.check("map: the detail panel answers for a link", graphDoc.includes('dbody.innerHTML = "<h3>" + (isLink ? "Region link"'), "no link detail")
  harness.check("map: the encoding key shows the dotted line", graphDoc.includes("dotted line = region link"), "no encoding row")
  harness.check("map: the summary is published to the mount", graphDoc.includes("regionLinks: lastBundles.length") && graphDoc.includes("crossRegionEdgesOnFrame: lastCross"), "no summary in state()")
  // ── the live line is the VIEW's, not the shell's ─────────────────────────────
  //
  // MEASURED while adding the code map to this sidebar: the line used to be composed BY THE
  // SHELL out of st.visibleNodes / st.visibleEdges / st.regionLinks, so the mount had to know
  // what a region link is -- and a code map mounted in the frame was described in the graph's
  // vocabulary, with the graph's counts. The view publishes the rows it wants printed
  // (state().onScreen) and the shell prints them; the sentence that reconciles the canvas with
  // the census is now one of the GRAPH's own rows, which is where it belongs. The assertions
  // follow the contract rather than the old spelling of it.
  harness.check("studio: the live line is built from the rows the VIEW publishes", html.includes("state().onScreen") && html.includes("function updateLive()"), "the shell still composes the line itself")
  harness.check("map: and the graph's reconciliation is one of its rows", graphDoc.includes("onScreen: onScreenRows()") && graphDoc.includes("region link stands") && graphDoc.includes("cross-region edges"), "the reconciliation is gone")
  harness.check("map: the rows carry the census counts", graphDoc.includes('row("nodes", shownNodes + " of " + N.length)') && graphDoc.includes('row("edges", shownEdges + " of " + L.length)'), "the counts are not published")
  // A summary that can only be SEEN cannot be checked. The links the frame is drawing are
  // published with their geometry, so a shell (or a test) can list them and click them
  // rather than hunting for a dotted line by eye.
  harness.check("map: the links being drawn are published, with their geometry", graphDoc.includes("links: regionLinks,") && graphDoc.includes("mid: { x: (lc[0] + ld[0]) / 2"), "no links() API")
  harness.check("map: a selected link names the two regions it joins", graphDoc.includes('sel.kind === "regionLink" ? sel.a + " to " + sel.b'), "selected link is unnamed")

  // ── the map does not dissolve under the pointer (third pass) ────────────────
  //
  // MEASURED in a real browser against the regenerated artifact: `focusSet()` read
  // `sel || hover`, so crossing a node with the pointer entered focus mode -- every other
  // node dimmed to 0.05, the region links replaced by the individual cross-region edges,
  // and lastBundles emptied, which made a click at a region link's own midpoint pick the
  // nearest stored edge instead. The click focuses; the pointer emphasises.
  harness.check("map: focus follows the selection, not the pointer", graphDoc.includes("function focusSet() {\n    var target = sel;"), "hover still focuses")
  harness.negative("map: the pointer no longer enters focus mode", !graphDoc.includes("var target = sel || hover;"), "focusSet still reads hover")
  harness.check("map: a hovered node's edges are drawn as themselves", graphDoc.includes("var incident = hovNode && (sa === hovNode || sb === hovNode);"), "hover cannot answer what a node connects to")

  // ── the census value is a count, not `.length` of a count (F15) ──────────
  //
  // `graphDoc` is the JSON.PARSED slot, so the document text carries real quotes;
  // the escaped forms only ever exist inside the JSON string. The negative is
  // paired with the positive (fixed && !broken) so it cannot pass vacuously when
  // the expression moves.
  const broken = /uniq\(N\.map\(function \(n\) \{ return n\.type; \}\)\)\.length/.test(graphDoc)
  const fixed = /var nodeTypes = uniq\(N\.map\(function \(n\) \{ return n\.type; \}\)\)/.test(graphDoc)
  const languages = /var languages = uniq\(N\.map\(function \(n\) \{ return n\.group; \}\)\)/.test(graphDoc)
  harness.check("map: `node types` counts distinct types", fixed, "census expression not found")
  harness.negative("map: `node types` is not .length of a count (the row never rendered)", fixed && !broken, broken ? "still .length of a count" : "")
  harness.check("map: the languages row uses the same function", languages, "languages row missing")
  harness.check("map: the census rows carry the count through to the sidebar", /censusRows\(\)/.test(graphDoc) && /row\("node types", nodeTypes\)/.test(graphDoc), "census row wiring not found")

  // ── the layout is a CHOICE, and both arrangements are real (fourth pass) ────
  //
  // MEASURED in the reader's report of the artifact: the region map was a genuine
  // improvement over what it replaced, and the reader still wanted the picture it
  // replaced AVAILABLE -- for a project whose parts do not fall along directory lines,
  // one force layout with every edge drawn as itself is the honest shape, and the
  // earlier look was not wrong, it was just the only option. Both arrangements are now
  // here, the choice is published, and the sidebar offers it.
  const forceDoc = (await studioFor("graph", { layout: "force" })).payload.graph ?? ""
  harness.check("map: the document declares its own layout, as it declares its view", /<html[^>]*data-bb-layout="(regions|force)"/.test(graphDoc), "no data-bb-layout on <html>")
  harness.check("map: the renderer reads that declaration, not a mount option", graphDoc.includes('document.documentElement.getAttribute("data-bb-layout")'), "the layout is not read from the document")
  harness.check("map: regions and force are the two arrangements", graphDoc.includes('getAttribute("data-bb-layout") === "force" ? "force" : "regions"') && graphDoc.includes('function regions() { return LAYOUT === "regions"; }'), "no layout fork")
  harness.check("html: layout=force ships a document that declares force", /<html[^>]*data-bb-layout="force"/.test(forceDoc), "the force slot does not declare itself")
  harness.negative("html: and it is not the region document again", forceDoc.length > 0 && forceDoc !== graphDoc, forceDoc === graphDoc ? "byte-identical to the region document" : "")
  harness.check("text: the graph view names the layout it will draw", (await text({ scope: "project", view: "graph", format: "text" })).includes("layout: regions "), "the text reply never names a layout")
  harness.check("text: and names the other one when it is asked for", (await text({ scope: "project", view: "graph", layout: "force", format: "text" })).includes("layout: force "), "layout=force is not named")
  harness.check("json: the layout rides the answer", (JSON.parse(await text({ scope: "project", view: "graph", format: "json" })) as { layout: string }).layout === "regions", "no layout in json")
  harness.check("json: layout=force is carried too", (JSON.parse(await text({ scope: "project", view: "graph", layout: "force", format: "json" })) as { layout: string }).layout === "force", "layout=force lost in json")
  // A force layout has no parts to anchor to and no parts to summarise between, so it
  // must neither seed per region nor draw pods NOR bundle -- and it must say so.
  harness.check("map: the force layout seeds the whole graph, not per region", forceDoc.includes("if (regions()) {") && forceDoc.includes("var ga = i * 2.399963229728653;"), "no global seed")
  harness.check("map: the anchor pull belongs to the region layout only", forceDoc.includes("if (regions()) {\n            var an2 = ANCHOR[MODULE_OF[m2]];"), "the anchor pull is not gated")
  harness.check("map: the force layout publishes the simulation's own positions", forceDoc.includes("function publishForce() {") && forceDoc.includes("if (!regions()) { publishForce(); deOverlap(); return; }"), "no force placement")
  harness.check("map: no pods are drawn there", forceDoc.includes("if (regions()) drawModuleRegions();"), "pods are not gated")
  harness.check("map: the encoding key explains only the marks the layout draws", forceDoc.includes('text: regions() ? "outline = module region (see Modules)"') && forceDoc.includes("no region pods in this layout"), "the key still describes the other layout's marks")
  harness.check("map: both arrangements are published, with what each draws", forceDoc.includes('{ value: "regions", label: "Regions"') && forceDoc.includes('{ value: "force", label: "Force"'), "no layouts() API")
  harness.check("map: switching restarts the simulation rather than reusing positions", forceDoc.includes("function restartLayout()") && forceDoc.includes("lay = N.length > 0 ? makeLayout(N, L) : null;"), "no restart")
  harness.check("studio: the switch is in the sidebar and it calls the view", html.includes('id="layouts"') && html.includes("v.setLayout(l.value)") && html.includes("renderLayouts(view)"), "no layout switch in the shell")
  harness.check("studio: a view with no second arrangement shows no switch", html.includes('layoutSection.classList.toggle("hide", !list.length)'), "the switch is always shown")

  // ── the relationship box gets out of the way WITHOUT costing the pick (fourth pass) ──
  //
  // MEASURED in the reader's report: the box's only exit was its X, and that X also ran
  // `sel = null` -- so hiding the panel to see the whole picture threw away the focus and
  // the zoom the reader had just asked for. The two intentions are now two controls, and
  // this is the assertion that keeps them apart: the collapse handler must NOT clear the
  // selection, and the X must.
  // Matched to the end of the LINE rather than to the first brace: the handler body is a
  // one-liner, and a brace-bounded capture truncates it mid-call, which is how this
  // assertion first failed against correct code.
  const collapseHandler = graphDoc.match(/collapseEl\.onclick = function \(\) \{[^\n]*/)
  const closeHandler = graphDoc.match(/getElementById\("dclose"\)\.onclick = function \(\) \{[^\n]*/)
  harness.check("map: collapsing is its own control", !!collapseHandler && collapseHandler[0].includes("setPanel({ collapsed: !panelCollapsed })"), collapseHandler ? collapseHandler[0].trim() : "no collapse handler")
  harness.negative("map: and it does not clear the selection", !!collapseHandler && !collapseHandler[0].includes("sel = null"), collapseHandler && collapseHandler[0].includes("sel = null") ? "collapse clears the pick" : "")
  harness.check("map: the X is the control that clears", !!closeHandler && closeHandler[0].includes("sel = null"), closeHandler ? closeHandler[0].trim() : "no close handler")
  harness.check("map: a collapsed box still names what is picked", graphDoc.includes("function summaryOf(o)") && graphDoc.includes("if (dtitleEl) dtitleEl.textContent = summaryOf(o);"), "a collapsed box cannot say what it hides")
  harness.check("map: the box docks to either side", graphDoc.includes('setPanel({ dock: dock === "left" ? "right" : "left" })') && /#detail\.dock-left\{left:14px;right:auto\}/.test(graphDoc) && /#detail\.dock-right\{left:auto;right:14px\}/.test(graphDoc), "no dock rule")
  harness.check("map: and a drag across the middle of the frame moves it", graphDoc.includes("Math.abs(ev.clientX - start.x) > 40") && graphDoc.includes('setPanel({ dock: ev.clientX < window.innerWidth / 2 ? "left" : "right" })'), "no drag-to-dock")
  // state() grew the live rows in the code map's pass (V11), so the assertion is anchored on the
  // two facts it is about -- the layout and the panel are read off the view -- rather than on the
  // exact tail of the object literal, which a further key would have failed.
  harness.check("map: its state is published, not only painted", graphDoc.includes("panel: panelState,") && graphDoc.includes("setPanel: setPanel,") && graphDoc.includes("layout: LAYOUT, panel: panelState(),"), "no panel state on the API")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
