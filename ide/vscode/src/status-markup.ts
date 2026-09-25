// ide/vscode/src/status-markup.ts — M55.V1 component: the status SURFACE.
//
// FOUND BY THE FRAMES (owner live test, 2026-09-13). `Backbencher: Show status`
// claims "every fact carries its claim level", but it rendered through
// `window.showInformationMessage(lines.join("\n"))` — and VS Code renders a
// notification as ONE line. The frame (validation/m55/frames/live-7/7-status.png)
// shows exactly what survived: "launch: compiled dist (bundled) — …". Every
// fact the command exists to deliver — the server state, the activation
// budget, the index phase, the staleness marker, the per-language evidence
// levels — was collapsed into a line the user never sees. Truth Rule 1: a fact
// that cannot be read was not delivered.
//
// This module is the surface's OWNER, and it is PURE (no vscode import) so a
// headless gate can fail it: script/m55/verify-status-panel.ts. The model stays
// where it was (ide/vscode/src/status-model.ts, gated by
// script/m25/verify-status-surface.ts) — this module only renders what the
// model decided, and it renders EVERY line, in order, with no truncation.
//
// Styling reuses the ONE hub stylesheet's vocabulary (script/m26/hub-css.ts is
// the single style owner; U2's law: the hub can never render as unstyled text),
// so the surface arrives styled by construction and needs no new CSS.

// From the vscode-free port module, NOT from ./graph-panel: importing the port
// through a module that imports vscode would make this renderer’s purity a
// claim instead of a fact, and script/m55/verify-status-panel.ts runs it
// headlessly.
import { serialize, StringElement } from "./webview-dom"

/** Everything the surface shows, already decided by the model. */
export interface StatusSurfaceInput {
  /** the honest facts, one per line, in the model's declared order
   *  (StatusView.tooltipLines). Order is preserved: a surface that reorders
   *  or drops facts is not the model's surface. */
  lines: string[]
  /** law-stale: the marker line; non-null exactly when the active file is
   *  stale/missing/unknown — rendered FIRST and loud (never buried). */
  staleBadge: string | null
  /** declared-absence notice when there is no active editor (the model's
   *  per-file facts then do not exist; silence here would read as "fresh"). */
  noActiveFileNote: string | null
  /** M55.V1: which server is running and what it cost to start — the facts
   *  `bbLsp.showServerStatus` exists to show. They lived in their OWN 4-line
   *  notification, which collapsed to one line exactly like the main surface
   *  did (frame: live-8/7-status.png showed only "launch: compiled dist…").
   *  One surface, one place to look: these render as the provenance section. */
  serverFacts: string[]
  /** the per-language declared levels (StatusView.perLanguage) */
  perLanguage: Array<{ language: string; level: string; description: string }>
  /** remediation actions for failure states (StatusView.actions) */
  actions: Array<{ title: string; command: string }>
}

/** The markup, escaped through the ONE DOM port (StringElement) — every
 *  repo-controlled string goes through textContent, so escaping is the port's
 *  job, never string concatenation's (W6 law). */
export function renderStatusMarkup(input: StatusSurfaceInput): string {
  const root = new StringElement("div")
  root.addClass("bb-status")
  root.setAttribute("data-surface", "status")

  // --- the staleness marker first: it is the fact that changes decisions ---
  if (input.staleBadge !== null && input.staleBadge.length > 0) {
    const marker = new StringElement("div")
    marker.addClass("bb-stale-marker")
    marker.setAttribute("data-stale", "true")
    marker.textContent = input.staleBadge
    root.appendChild(marker)
  }
  if (input.noActiveFileNote !== null && input.noActiveFileNote.length > 0) {
    const note = new StringElement("div")
    note.addClass("bb-hub-empty")
    note.setAttribute("data-no-active-file", "true")
    note.textContent = input.noActiveFileNote
    root.appendChild(note)
  }

  // --- the facts, one row per line, in the model's order -------------------
  const facts = new StringElement("div")
  facts.addClass("bb-hub-group")
  facts.setAttribute("data-section", "facts")
  facts.appendChild(sectionLabel("facts (each line states what it is and where it came from)"))
  input.lines.forEach((line, i) => {
    const row = new StringElement("div")
    row.addClass("bb-hub-row")
    row.setAttribute("data-fact", String(i))
    const name = new StringElement("span")
    name.addClass("bb-hub-row-name")
    name.textContent = line
    row.appendChild(name)
    facts.appendChild(row)
  })
  root.appendChild(facts)

  // --- which server, where from, at what cost -----------------------------
  if (input.serverFacts.length > 0) {
    const server = new StringElement("div")
    server.addClass("bb-hub-group")
    server.setAttribute("data-section", "server-provenance")
    server.appendChild(sectionLabel("server provenance (which binary is answering, and what starting it cost)"))
    input.serverFacts.forEach((line, i) => {
      const row = new StringElement("div")
      row.addClass("bb-hub-row")
      row.setAttribute("data-server-fact", String(i))
      const name = new StringElement("span")
      name.addClass("bb-hub-row-name")
      name.textContent = line
      row.appendChild(name)
      server.appendChild(row)
    })
    root.appendChild(server)
  }

  // --- the per-language evidence table ------------------------------------
  const langs = new StringElement("div")
  langs.addClass("bb-hub-group")
  langs.setAttribute("data-section", "per-language")
  langs.appendChild(sectionLabel(`per-language evidence levels (declared, drift-gated) — ${input.perLanguage.length} language(s)`))
  if (input.perLanguage.length === 0) {
    const empty = new StringElement("div")
    empty.addClass("bb-hub-empty")
    empty.setAttribute("data-empty", "per-language")
    empty.textContent = "No language has a declared claim level yet — nothing is claimed, and this line says so rather than showing an empty table."
    langs.appendChild(empty)
  }
  for (const p of input.perLanguage) {
    const row = new StringElement("div")
    row.addClass("bb-hub-row")
    row.setAttribute("data-language", p.language)
    const name = new StringElement("span")
    name.addClass("bb-hub-row-name")
    name.textContent = p.language
    const meta = new StringElement("span")
    meta.addClass("bb-hub-row-meta")
    meta.setAttribute("data-level", p.level)
    // The level is a machine fact on the row (data-level) and it is ALSO the
    // first thing `description` says, because describeLevel() renders
    // `${level} — ${meaning}`. Prepending it again ("I1 — I1 — protocol-passed",
    // read off the live frame live-10/7-status.png) tells the user nothing and
    // makes the surface look broken. One statement per fact.
    meta.textContent = p.description
    row.appendChild(name)
    row.appendChild(meta)
    langs.appendChild(row)
  }
  root.appendChild(langs)

  // --- remediation: what to run, and the exact command id -----------------
  if (input.actions.length > 0) {
    const actions = new StringElement("div")
    actions.addClass("bb-hub-group")
    actions.setAttribute("data-section", "actions")
    actions.appendChild(sectionLabel(`remediation — run from the palette (Backbencher: …)`))
    for (const a of input.actions) {
      const row = new StringElement("div")
      row.addClass("bb-hub-row")
      row.setAttribute("data-action", a.command)
      const name = new StringElement("span")
      name.addClass("bb-hub-row-name")
      name.textContent = a.title
      const meta = new StringElement("span")
      meta.addClass("bb-hub-row-meta")
      meta.textContent = a.command
      row.appendChild(name)
      row.appendChild(meta)
      actions.appendChild(row)
    }
    root.appendChild(actions)
  }

  return serialize(root)
}

function sectionLabel(text: string): StringElement {
  const label = new StringElement("div")
  label.addClass("bb-hub-group-label")
  label.textContent = text
  return label
}

/** The panel's machine-readable state slot (the shell embeds it as escaped
 *  JSON): a reader can tell what the surface was rendered FROM without
 *  parsing markup. */
export function statusSurfaceState(input: StatusSurfaceInput): string {
  return JSON.stringify({
    renderedBy: "ide/vscode/src/status-markup.ts (one surface owner)",
    schemaVersion: 1,
    surface: "status",
    facts: input.lines.length,
    serverFacts: input.serverFacts.length,
    staleMarker: input.staleBadge !== null,
    noActiveFile: input.noActiveFileNote !== null,
    perLanguage: input.perLanguage.length,
    actions: input.actions.length,
  })
}
