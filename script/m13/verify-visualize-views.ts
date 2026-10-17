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
  },
  limitations: [
    "No DOM/browser dependency exists in this repository, so the studio is asserted structurally and the pixels are verified out of band (validation/m13/results/viz-review-evidence).",
    "Interaction (drag, hover, tab switching) is not exercised here.",
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
const studioFor = async (view: string): Promise<{ html: string; payload: Record<string, string> }> => {
  const html = await text({ scope: "project", view, format: "html" })
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
  // symbol and called itself "Code map", which is the name of a different artifact. The negative
  // twin keeps the retired word from drifting back into the chrome.
  harness.check("html: the status line names the mounted view", html.includes("Symbol map view loaded"), "status missing")
  harness.negative("html: and the retired label is gone from the studio chrome", !html.includes("Code map view loaded") && !html.includes(">Code</span>"), "the old label is still in the shell")

  const graphStudio = await studioFor("graph")
  harness.check("html: view=graph mounts the map", graphStudio.html.includes('mount("graph")') && !graphStudio.html.includes('mount("codemap")'), (graphStudio.html.match(/mount\("\w+"\)/g) ?? []).join(","))
  const classStudio = await studioFor("class")
  harness.check("html: view=class mounts the UML document", classStudio.html.includes('mount("class")') && !classStudio.html.includes('mount("graph")'), (classStudio.html.match(/mount\("\w+"\)/g) ?? []).join(","))

  // ── the panels must survive the composition (F11) ──────────────────────────
  const hidden = /#hud\s*,\s*#legend\s*\{[^}]*display:\s*none/i.test(html)
  harness.negative("studio: no rule hides the census panel or the encoding key", !hidden, hidden ? "a rule hides #hud/#legend" : "")
  const graphDoc = payload.graph ?? ""
  harness.check("studio: the map document still carries the census panel the studio must not hide", graphDoc.includes('id="hud"'), "no #hud in the map document")
  harness.check("studio: and the encoding key", graphDoc.includes('id="legend"'), "no #legend in the map document")

  // ── composition keyed on the DOCUMENT (F14) ────────────────────────────────
  harness.check("studio: the style branch reads the document's own declaration", html.includes('getAttribute("data-bb-view")') && html.includes("function documentView()"), "no documentView()")
  harness.negative("studio: the style branch no longer branches on the mounted tab", !/if \(frame\.dataset\.mode/.test(html), "still branching on frame.dataset.mode")

  // ── no synthetic input, and a fit control instead (F16) ───────────────────
  //
  // The assertion looks for the CALL, not for the word: the script's own comment
  // explains why the wheel dispatch is gone, and a check that matched the prose
  // would fail on the explanation instead of on the behaviour.
  harness.negative("studio: no synthetic input on load", !html.includes("dispatchEvent(") && !html.includes("deltaY:"), "the studio still dispatches an event")
  harness.check("map: ships a fit control", graphDoc.includes('id="fitbtn"'), "no #fitbtn")
  harness.check("map: the fit control frames every node", graphDoc.includes("function fitAll()"), "no fitAll()")

  // ── the census value is a count, not `.length` of a count (F15) ──────────
  //
  // `graphDoc` is the JSON.PARSED slot, so the document text carries real quotes;
  // the escaped forms only ever exist inside the JSON string. The negative is
  // paired with the positive (fixed && !broken) so it cannot pass vacuously when
  // the expression moves.
  const broken = /row\("node types", uniq\(N\.map\(function \(n\) \{ return n\.type; \}\)\)\.length\)/.test(graphDoc)
  const fixed = /row\("node types", uniq\(N\.map\(function \(n\) \{ return n\.type; \}\)\)\)/.test(graphDoc)
  const languages = /row\("languages", uniq\(N\.map\(function \(n\) \{ return n\.group; \}\)\)\)/.test(graphDoc)
  harness.check("map: `node types` renders the count itself", fixed, "census expression not found")
  harness.negative("map: `node types` is not .length of a count (the row never rendered)", fixed && !broken, broken ? "still .length of a count" : "")
  harness.check("map: the languages row uses the same function", languages, "languages row missing")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
