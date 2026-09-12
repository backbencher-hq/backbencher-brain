// ide/vscode/src/impact-panel.ts — M42.H4 (issue #652): the impact webview
// panel behind the hover's "Impact analysis" action.
//
// THIN CLIENT, same law as graph-panel.ts (M26.X1): no per-IDE renderer.
//   1. sends the versioned bb/impact request over the extension's REAL
//      LanguageClient (declared schemaVersion; see src/lsp/impact_request.ts),
//   2. renders the W5 impact result through the ONE renderer core
//      (script/m26/graph-core.ts renderImpact) via the SAME escaping DOM
//      port the graph panel uses (graph-panel exports it — one serializer),
//   3. emits the canonical W6 shell (buildWebviewHtml).
// Loud errors on declared failure modes (not indexed, unknown symbol, schema
// mismatch) are a contract §1 requirement: the panel renders the declared
// reason verbatim — never an empty impact set that would read as "no one
// depends on this".
import { window, ViewColumn, type ExtensionContext, type WebviewPanel } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"

// Bundled at build time from script/m26/graph-core.ts (the ONE renderer).
// Same structural one-renderer rule as graph-panel's renderGraph import.
import { renderImpact } from "../../../script/m26/graph-core"
import { serialize, StringElement, applyResolutionTitle, resolvePlacementFromSettings } from "./graph-panel"
// M55.P1 (Truth Rule 6): the reuse registry — one impact panel per symbol+file.
import { panelKey, PanelRegistry } from "./panel-placement"

/** The live impact panels (M55.P1 reuse rule). */
const IMPACT_PANELS = new PanelRegistry<WebviewPanel>()
import { buildWebviewHtml } from "../../../script/m26/webview-html"
// Type-only import: erased at build time, so this stays a thin client — the
// SHAPE is owned by the server's identity resolver (src/lsp/identity.ts).
import type { MemberResolution } from "../../../src/lsp/identity"

/** bb/impact request — schemaVersion-pinned per src/lsp/impact_request.ts. */
const IMPACT_METHOD = "bb/impact"

export interface ImpactPanelDeps {
  client: LanguageClient | null
  cspSource: string
}

/** Pure, testable core: run bb/impact + render through the ONE core, return
 *  the shell inputs. Declared failures come back as { error } — loud, with
 *  the server's declared reason (bb/impact: prefix preserved verbatim). */
export async function renderImpactForPanel(
  params: { symbol: string; file?: string },
  deps: ImpactPanelDeps,
): Promise<{ ok: true; markup: string; stateJson: string; resolution?: MemberResolution } | { ok: false; error: string }> {
  if (deps.client === null) {
    return { ok: false, error: "bb_lsp is not running — restart the server (command: Backbencher: Restart server)." }
  }
  let raw: unknown
  try {
    raw = await deps.client.sendRequest(IMPACT_METHOD, {
      schemaVersion: 1,
      symbol: params.symbol,
      // X1 closure: the defining-file identity disambiguates same-name
      // members (constructors) — the server resolves through it when the
      // name alone is ambiguous.
      ...(params.file ? { file: params.file } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Declared server errors carry the bb/impact: prefix — surface the
    // reason verbatim (contract §1: loud, machine-parseable, never hidden).
    return { ok: false, error: message.startsWith("bb/impact:") ? message : `bb/impact request failed: ${message}` }
  }
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "bb/impact returned a malformed result (not an object)" }
  }

  const root = new StringElement("div")
  const dom = { create: (t: string) => new StringElement(t), root: () => root }
  let rendered: { nodesRendered: number; marker: unknown }
  try {
    rendered = renderImpact(raw as never, dom as never)
  } catch (e) {
    return { ok: false, error: `bb/impact result failed renderer validation: ${e instanceof Error ? e.message : String(e)}` }
  }

  const markup = serialize(root)
  const stateJson = JSON.stringify({
    renderedBy: "bb_lsp graph core renderImpact (one-library rule)",
    schemaVersion: 1,
    symbol: params.symbol,
    nodesRendered: rendered.nodesRendered,
  })
  // M55.T1 (Truth Rule 2): the declared substitution rides the outcome so the
  // panel TITLE states it too — the renderer's note is not the only place a
  // user learns what was actually shown (the filing defect: a member graph
  // titled with the member after the server had rooted at its owner).
  const resolution = (raw as { resolution?: MemberResolution }).resolution
  return { ok: true, markup, stateJson, ...(resolution ? { resolution } : {}) }
}

/** Open (or reuse) the impact panel for a symbol. Returns the panel AND the
 *  render outcome it shows — the caller (bb.openImpact) surfaces whether the
 *  panel rendered DATA or a declared failure (owner test, 2026-09-06: a
 *  click whose panel only ever renders the stale-null not-running banner is
 *  a wiring failure, not a success). */
export async function showImpactPanel(
  symbol: string,
  deps: ImpactPanelDeps,
  context: ExtensionContext,
  /** X1 closure: the hover's defining-file identity (same-name members). */
  file?: string,
): Promise<{ panel: WebviewPanel; outcome: Awaited<ReturnType<typeof renderImpactForPanel>> }> {
  const key = panelKey("impact", symbol, file)
  const existing = IMPACT_PANELS.get(key)
  if (existing !== null) {
    // Reuse, never duplicate (M55.P1): the same symbol is the same panel, and
    // a repeat click must not widen the layout or steal the cursor.
    const outcome = await renderImpactForPanel({ symbol, file }, deps)
    applyResolutionTitle(existing, `Backbencher Impact — ${symbol}`, outcome, symbol, "Impact")
    existing.webview.html = buildHtml(outcome, deps.cspSource)
    existing.reveal(undefined, true)
    return { panel: existing, outcome }
  }
  const placement = resolvePlacementFromSettings()
  const panel = window.createWebviewPanel(
    "bbImpact",
    `Backbencher Impact — ${symbol}`,
    { viewColumn: placement.viewColumn, preserveFocus: placement.preserveFocus },
    {
      enableScripts: false,
      localResourceRoots: [],
    },
  )
  context.subscriptions.push(panel)
  IMPACT_PANELS.set(key, panel)
  panel.onDidDispose(() => IMPACT_PANELS.delete(key))
  const outcome = await renderImpactForPanel({ symbol, file }, deps)
  applyResolutionTitle(panel, `Backbencher Impact — ${symbol}`, outcome, symbol, "Impact")
  panel.webview.html = buildHtml(outcome, deps.cspSource)
  return { panel, outcome }
}

function buildHtml(outcome: Awaited<ReturnType<typeof renderImpactForPanel>>, cspSource: string): string {
  if (outcome.ok) {
    return buildWebviewHtml({ cspSource, stateJson: outcome.stateJson, bodyMarkup: outcome.markup }).html
  }
  // Loud declared failure: the reason is rendered as content, with a nonce-
  // bound empty state payload — never a silent empty impact set.
  const shell = buildWebviewHtml({ cspSource, stateJson: JSON.stringify({ error: outcome.error }), bodyMarkup: "" })
  const safe = outcome.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return shell.html.replace('<div id="bb-graph-root"></div>', `<div id="bb-graph-root" class="bb-graph-error"><p>${safe}</p></div>`)
}
