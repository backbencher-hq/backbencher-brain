// ide/vscode/src/hub-panel.ts — M42.H5 (issue #653) / M44.U1 (issue #688):
// the hub webview panel — the surface behind the hover's "Open in graph"
// action (H4).
//
// THIN CLIENT, same law as graph-panel / impact-panel:
//   1. ONE bb/graph request in the declared usages mode (schemaVersion 2,
//      mode "usages" — the hub profile, docs/m42/HUB.md; M44.U1 serves the
//      GROUPED shape: one entry per caller/callee symbol with declared
//      multiplicity),
//   2. THREE pre-rendered sections from that single result through the ONE
//      renderer core (graph-core renderHubList/renderHubTree): list by file,
//      list by caller, call tree,
//   3. the W6 shell with a tiny nonce-bound LOCAL script that toggles
//      between the sections (CSP unchanged; no postMessage — the webview→
//      editor contract is H6's issue),
//   4. a whole-panel staleness marker from bb/staleness for the root file
//      (rule §12.2: a stale render is labeled stale).
// Loud declared failures (not indexed, unknown symbol, schema mismatch)
// render as content — never a silent empty hub.
import { window, ViewColumn, type ExtensionContext, type WebviewPanel } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"

// Bundled at build time from script/m26/graph-core.ts (the ONE renderer).
import { renderHubList, renderHubTree } from "../../../script/m26/graph-core"
import { serialize, StringElement, applyResolutionTitle, resolvePlacementFromSettings } from "./graph-panel"
// M55.P1 (Truth Rule 6): the reuse registry — one hub panel per symbol+file.
import { panelKey, PanelRegistry } from "./panel-placement"
import { buildWebviewHtml } from "../../../script/m26/webview-html"
// M42.H6 (issue #654): the ONE protocol owner + the extension-side handler.
import { buildBridgeScript } from "../../../src/lsp/hub_protocol"
// Type-only import: erased at build time (thin client preserved).
import type { MemberResolution } from "../../../src/lsp/identity"
import { vscodeDeps, wireWebviewMessages } from "./hub-navigation"

const GRAPH_METHOD = "bb/graph"
const STALENESS_METHOD = "bb/staleness"

export interface HubPanelDeps {
  client: LanguageClient | null
  cspSource: string
}

export type HubRenderOutcome =
  | {
      ok: true
      markup: string
      stateJson: string
      staleMarkup: string
      counts: { callers: number; callees: number }
      /** M55.T1 (Truth Rule 2): present when the server rooted a MEMBER target
       *  through its owning declaration. The panel title and the render both
       *  state it — a substitution the user cannot see is a defect. The shape
       *  is owned by the server's identity resolver (one decision). */
      resolution?: MemberResolution
    }
  | { ok: false; error: string }

/** Pure, testable core: run the usages query + staleness, render all three
 *  sections through the ONE core, return the shell inputs. Declared failures
 *  come back as { error } with the server's reason verbatim. */
export async function renderHubForPanel(
  params: { symbol: string; file?: string },
  deps: HubPanelDeps,
): Promise<HubRenderOutcome> {
  if (deps.client === null) {
    return { ok: false, error: "bb_lsp is not running — restart the server (command: Backbencher: Restart server)." }
  }
  let raw: unknown
  try {
    raw = await deps.client.sendRequest(GRAPH_METHOD, {
      schemaVersion: 2,
      symbol: params.symbol,
      mode: "usages",
      // X1 closure: the defining-file identity disambiguates same-name
      // members (constructors) — the server resolves through it when the
      // name alone is ambiguous.
      ...(params.file ? { file: params.file } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message.startsWith("bb/graph:") ? message : `bb/graph request failed: ${message}` }
  }
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "bb/graph returned a malformed result (not an object)" }
  }
  // Compile-time drift gate (U1): the renderer's structural GroupedHub is
  // checked against this server-typed value right here — a shape mismatch
  // between graph_usages.ts and graph-core.ts fails the build.
  const result = raw as unknown as import("../../../src/lsp/graph_usages").GroupedUsages
  const rootName = result.root?.name ?? params.symbol

  // Whole-panel staleness (§12.2): ask the server for the root symbol's file
  // marker. Any failure degrades to a declared unknown — never a fresh lie.
  let stale = false
  let staleStatus = "unknown"
  if (typeof params.file === "string" && params.file.length > 0) {
    try {
      const marker = (await deps.client.sendRequest(STALENESS_METHOD, { uri: `file://${params.file}` })) as
        | { stale: boolean; status: string }
        | null
        | undefined
      stale = Boolean(marker?.stale)
      staleStatus = marker?.status ?? "unknown"
    } catch {
      staleStatus = "unknown"
    }
  }

  const render = (fn: (r: typeof result, d: never) => { nodesRendered: number }, extraClass: string, attr: Record<string, string>): { markup: string } | { error: string } => {
    const root = new StringElement("div")
    const dom = { create: (t: string) => new StringElement(t), root: () => root }
    try {
      fn(result, dom as never)
    } catch (e) {
      return { error: `bb/graph result failed hub renderer validation: ${e instanceof Error ? e.message : String(e)}` }
    }
    for (const [k, v] of Object.entries(attr)) root.setAttribute(k, v)
    root.addClass(extraClass)
    // M42.H6: staleness is a PANEL fact — the bridge labels a stale click by
    // reading the enclosing bb-hub-view's data-stale attrs (never per-row
    // surgery). Honest: no stale view ever renders without the marker data.
    if (stale) {
      root.setAttribute("data-stale", "1")
      root.setAttribute("data-stale-status", staleStatus)
    }
    return { markup: serialize(root) }
  }
  const byFile = render((r, d) => renderHubList(r, d, "file"), "bb-hub-view", { "data-view": "list", "data-group": "file" })
  if ("error" in byFile) return { ok: false, error: byFile.error }
  const byCaller = render((r, d) => renderHubList(r, d, "caller"), "bb-hub-view", { "data-view": "list", "data-group": "caller" })
  if ("error" in byCaller) return { ok: false, error: byCaller.error }
  const tree = render((r, d) => renderHubTree(r, d), "bb-hub-view", { "data-view": "tree" })
  if ("error" in tree) return { ok: false, error: tree.error }

  const markup = `${byFile.markup}${byCaller.markup}${tree.markup}`
  // M55.T1: the declared substitution rides the outcome (the renderers already
  // emitted the visible note + attrs through the ONE core helper).
  const resolution = (result as { resolution?: MemberResolution }).resolution
  // §13.4: header counts equal the GROUP counts the rows render (the raw
  // multiplicity rides alongside as callerRows/calleeRows).
  const counts = {
    callers: result.counts?.callerGroups ?? 0,
    callees: result.counts?.calleeGroups ?? 0,
  }
  const staleMarkup = stale
    ? `<div class="bb-stale-marker" data-stale="true" data-status="${serializeAttr(staleStatus)}">⚠️ stale — file changed since indexing (${serializeAttr(staleStatus)})</div>`
    : ""
  const stateJson = JSON.stringify({
    renderedBy: "bb_lsp graph core renderHub* (one-library rule)",
    schemaVersion: 1,
    mode: "usages",
    symbol: params.symbol,
    rootName,
    counts,
    stale,
    staleStatus,
    ...(resolution ? { resolution } : {}),
  })
  return { ok: true, markup, stateJson, staleMarkup, counts, ...(resolution ? { resolution } : {}) }
}

function serializeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Open (or reuse) the hub panel for a symbol. Returns the panel AND the
 *  render outcome it shows — the caller (bb.openGraph) surfaces whether the
 *  panel rendered DATA or a declared failure (owner test, 2026-09-06: a
 *  click whose panel only ever renders the stale-null not-running banner is
 *  a wiring failure, not a success). */
/** The live hub panels, one per symbol+file (M55.P1 reuse rule). */
const HUB_PANELS = new PanelRegistry<WebviewPanel>()

export async function showHubPanel(
  params: { symbol: string; file?: string },
  deps: HubPanelDeps,
  context: ExtensionContext,
): Promise<{ panel: WebviewPanel; outcome: HubRenderOutcome }> {
  const key = panelKey("hub", params.symbol, params.file)
  const existing = HUB_PANELS.get(key)
  if (existing !== null) {
    // Reuse: same panel, fresh render — a second click on the same symbol must
    // not open a second column (M55.P1; the filing run reached four columns).
    const outcome = await renderHubForPanel(params, deps)
    applyResolutionTitle(existing, `Backbencher Hub — ${params.symbol}`, outcome, params.symbol, "Hub")
    existing.webview.html = buildHubHtml(outcome, deps.cspSource)
    existing.reveal(undefined, true)
    return { panel: existing, outcome }
  }
  const placement = resolvePlacementFromSettings()
  const panel = window.createWebviewPanel(
    "bbHub",
    `Backbencher Hub — ${params.symbol}`,
    { viewColumn: placement.viewColumn, preserveFocus: placement.preserveFocus },
    {
      // The toggle needs a script; the W6 shell ships nonce-bound and CSP-locked
      // (default-src 'none'): enableScripts only makes the nonce-bound local
      // toggle possible — no remote code can run (H6 adds postMessage on top).
      enableScripts: true,
      localResourceRoots: [],
    },
  )
  context.subscriptions.push(panel)
  HUB_PANELS.set(key, panel)
  panel.onDidDispose(() => HUB_PANELS.delete(key))
  // M42.H6: the webview→editor door. One message channel per panel, wired to
  // the shared handler (version validation, fabricated-path guard, stale
  // labeling); requestRefresh re-renders THIS panel from its stored query.
  const refresh = async (): Promise<void> => {
    const fresh = await renderHubForPanel(params, deps)
    panel.webview.html = buildHubHtml(fresh, deps.cspSource)
  }
  context.subscriptions.push(wireWebviewMessages(panel.webview, vscodeDeps(), refresh))
  const outcome = await renderHubForPanel(params, deps)
  // M55.T1 (Truth Rule 2): the panel title names what is ACTUALLY rendered,
  // through the ONE title rule the other panels use too. A member rooted
  // through its owning declaration says so, so a substitution can never be
  // read as the symbol the user clicked (the filing run's defect: the
  // constructor graph opened titled `Store`, silently).
  applyResolutionTitle(panel, `Backbencher Hub — ${params.symbol}`, outcome, params.symbol, "Hub")
  panel.webview.html = buildHubHtml(outcome, deps.cspSource)
  return { panel, outcome }
}

/** Toggle script (local only): switches the active hub section. Nonce-bound
 *  inline — allowed by the strict CSP (script-src 'nonce-…'); no postMessage,
 *  no remote code. */
const TOGGLE_SCRIPT = `
(function () {
  var views = Array.prototype.slice.call(document.querySelectorAll(".bb-hub-view"))
  var show = function (view, group) {
    views.forEach(function (v) {
      var dataView = v.getAttribute("data-view")
      var dataGroup = v.getAttribute("data-group")
      var match = dataView === view && (group === undefined || dataGroup === group)
      v.style.display = match ? "block" : "none"
      if (match) v.setAttribute("data-active", "1")
      else v.removeAttribute("data-active")
    })
  }
  window.__bbHubShow = show
  show("list", "file")
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-hub-target]"))
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-hub-target").split(":")
      show(t[0], t[1] === "none" ? undefined : t[1])
    })
  })
})()
`

function buildHubHtml(outcome: HubRenderOutcome, cspSource: string): string {
  if (outcome.ok) {
    const shell = buildWebviewHtml({ cspSource, stateJson: outcome.stateJson, bodyMarkup: outcome.markup })
    const controls =
      '<div class="bb-hub-controls">' +
      '<button type="button" data-hub-target="list:file">List (by file)</button>' +
      '<button type="button" data-hub-target="list:caller">List (by caller)</button>' +
      '<button type="button" data-hub-target="tree:none">Call tree</button>' +
      "</div>" +
      outcome.staleMarkup
    const withControls = shell.html.replace('<div id="bb-graph-root">', `<div id="bb-graph-root">${controls}`)
    // M42.H6: the bridge script is GENERATED by the protocol owner — the
    // shapes the webview sends are the shapes the handler validates. Both
    // scripts are nonce-bound (strict W6 CSP unchanged, issue #654).
    return withControls.replace("</body>", `<script nonce="${shell.nonce}">${TOGGLE_SCRIPT}</script><script nonce="${shell.nonce}">${buildBridgeScript()}</script></body>`)
  }
  // Loud declared failure: the reason is rendered as content.
  const shell = buildWebviewHtml({ cspSource, stateJson: JSON.stringify({ error: outcome.error }), bodyMarkup: "" })
  const safe = outcome.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return shell.html.replace('<div id="bb-graph-root"></div>', `<div id="bb-graph-root" class="bb-graph-error"><p>${safe}</p></div>`)
}
