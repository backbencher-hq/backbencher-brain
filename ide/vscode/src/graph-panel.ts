// ide/vscode/src/graph-panel.ts — M26.X1: the graph webview panel (bar item 1:
// "Graph webview live in VS Code at I3").
//
// THIN CLIENT (the one-library rule): no per-IDE renderer fork. This panel
//   1. sends the versioned bb/graph request over the extension's REAL
//      LanguageClient (declared schemaVersion 2, per docs/m26/GRAPH-TRANSPORT.md),
//   2. renders the result through the ONE renderer core (script/m26/graph-core.ts)
//      via an escaping DOM port in the extension host,
//   3. emits the canonical W6 shell (buildWebviewHtml) with the pre-rendered
//      markup in the body.
// Loud errors on declared failure modes (not indexed, schema mismatch) are a
// contract §1 requirement: the panel renders the declared reason, never an
// empty graph that would read as "no connections".
import { window, workspace, ViewColumn, type ExtensionContext, type WebviewPanel, type Uri } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"

// Bundled at build time from script/m26/graph-core.ts (the ONE renderer).
// See esbuild-extension.mjs — importing it here is what makes the single-
// renderer rule structural: a per-IDE fork would have to bypass the bundle.
import { renderGraph } from "../../../script/m26/graph-core"
// Type-only import: erased at build time (thin client preserved). The shape is
// owned by the server's identity resolver (src/lsp/identity.ts).
import type { MemberResolution } from "../../../src/lsp/identity"
// M55.T1 (Truth Rule 2): the ONE panel-title rule, vscode-free so the truth
// gate can execute it (see ./identity-label).
import { applyResolutionTitle } from "./identity-label"
// M55.P1 (Truth Rule 6): the ONE panel-placement decision, likewise vscode-free.
// This module only injects the editor's column numbers and reads the setting.
import {
  PANEL_PLACEMENT_SETTING,
  panelKey,
  PanelRegistry,
  resolvePanelPlacement,
  type PanelPlacement,
} from "./panel-placement"

// The ONE escaping DOM port + serializer now lives in ./webview-dom (M55.V1):
// it never needed vscode, but it sat in this file — which does — so a PURE
// renderer that imported it inherited the editor dependency and could not be
// run by a headless gate. Re-exported here because the hub / impact / graph
// panels already import these names from this module (same pattern as
// applyResolutionTitle below): one implementation, one import site for them.
import { escapeHtmlValue, serialize, StringElement } from "./webview-dom"
export { escapeHtmlValue, serialize, StringElement } from "./webview-dom"

/** bb/graph request — schemaVersion-pinned per GRAPH-TRANSPORT.md. The
 *  method name as a string (same convention as bb/staleness). */
const GRAPH_METHOD = "bb/graph"

export interface GraphPanelDeps {
  client: LanguageClient | null
  cspSource: string
}

// M55.T1 (Truth Rule 2): the panel-title rule now lives in the vscode-free
// module ./identity-label, so the truth gate can EXECUTE it headlessly — a
// rule that cannot run in a gate cannot be verified, and this one silently
// failed the user once (a constructor graph titled `Store` with nothing
// said). Re-exported here because hub-panel and impact-panel already import
// from this module: one rule, one definition, two import sites.
export { applyResolutionTitle }

/** Pure, testable core: run bb/graph + render through the ONE core, return
 *  the shell inputs. Declared failures come back as { error } — loud, with
 *  the server's declared reason. */
export async function renderGraphForPanel(
  params: { symbol: string; file?: string },
  deps: GraphPanelDeps,
): Promise<{ ok: true; markup: string; stateJson: string; resolution?: MemberResolution } | { ok: false; error: string }> {
  if (deps.client === null) return { ok: false, error: "bb_lsp is not running — restart the server (command: Backbencher: Restart server)." }
  let raw: unknown
  try {
    raw = await deps.client.sendRequest(GRAPH_METHOD, {
      schemaVersion: 2,
      symbol: params.symbol,
      direction: "both",
      maxDepth: 3,
      // M55.T1: the defining-file identity disambiguates same-name members;
      // every transport passes it through (Truth Rule 2).
      ...(params.file ? { file: params.file } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Declared server errors carry the bb/graph: prefix — surface the reason
    // verbatim (contract §1: loud, machine-parseable, never hidden).
    return { ok: false, error: message.startsWith("bb/graph:") ? message : `bb/graph request failed: ${message}` }
  }
  if (raw === null || typeof raw !== "object") return { ok: false, error: "bb/graph returned a malformed result (not an object)" }
  const result = raw as Parameters<typeof renderGraph>[0]

  const root = new StringElement("div")
  const dom = { create: (t: string) => new StringElement(t), root: () => root }
  let stats
  try {
    stats = renderGraph(result as never, dom as never)
  } catch (e) {
    return { ok: false, error: `bb/graph result failed renderer validation: ${e instanceof Error ? e.message : String(e)}` }
  }

  const markup = serialize(root)
  const stateJson = JSON.stringify({
    renderedBy: "bb_lsp graph core (one-library rule)",
    schemaVersion: 2,
    symbol: params.symbol,
    nodesRendered: stats.nodesRendered,
    nodesTotal: stats.nodesTotal,
    edgesRendered: stats.edgesRendered,
    edgesTotal: stats.edgesTotal,
    truncated: stats.nodesTruncated || stats.edgesTruncated,
  })
  // M55.T1 (Truth Rule 2): the declared substitution rides the outcome so the
  // panel title states it (one rule with impact + hub).
  const resolution = (raw as { resolution?: MemberResolution }).resolution
  return { ok: true, markup, stateJson, ...(resolution ? { resolution } : {}) }
}

// M55.P1: the placement decision (vscode-free, in ./panel-placement) needs the
// editor's own column numbers, and the setting is read from the workspace. This
// is the ONLY place a panel asks for a column — no panel file names one.
export function resolvePlacementFromSettings(): {
  viewColumn: ViewColumn
  preserveFocus: boolean
  mode: PanelPlacement
  warning?: string
} {
  const decision = resolvePanelPlacement(workspace.getConfiguration().get(PANEL_PLACEMENT_SETTING), {
    Active: ViewColumn.Active,
    Beside: ViewColumn.Beside,
  })
  return {
    viewColumn: decision.viewColumn as ViewColumn,
    preserveFocus: decision.preserveFocus,
    mode: decision.mode,
    ...(decision.warning ? { warning: decision.warning } : {}),
  }
}

/** The live graph panels, one per symbol+file (M55.P1 reuse rule). */
const GRAPH_PANELS = new PanelRegistry<WebviewPanel>()

/** Open (or reuse) the graph panel for a symbol. */
export async function showGraphPanel(symbol: string, deps: GraphPanelDeps, context: ExtensionContext, file?: string): Promise<WebviewPanel> {
  const key = panelKey("graph", symbol, file)
  const existing = GRAPH_PANELS.get(key)
  if (existing !== null) {
    // Reuse: same panel, fresh render — never a second column (M55.P1).
    const outcome = await renderGraphForPanel({ symbol, ...(file ? { file } : {}) }, deps)
    applyResolutionTitle(existing, `Backbencher Graph — ${symbol}`, outcome, symbol, "Graph")
    existing.webview.html = buildHtml(outcome, deps.cspSource, existing)
    existing.reveal(undefined, true)
    return existing
  }
  const placement = resolvePlacementFromSettings()
  const panel = window.createWebviewPanel(
    "bbGraph",
    `Backbencher Graph — ${symbol}`,
    { viewColumn: placement.viewColumn, preserveFocus: placement.preserveFocus },
    {
      enableScripts: false,
      localResourceRoots: [],
    },
  )
  context.subscriptions.push(panel)
  GRAPH_PANELS.set(key, panel)
  panel.onDidDispose(() => GRAPH_PANELS.delete(key))
  const outcome = await renderGraphForPanel({ symbol, ...(file ? { file } : {}) }, deps)
  applyResolutionTitle(panel, `Backbencher Graph — ${symbol}`, outcome, symbol, "Graph")
  const html = buildHtml(outcome, deps.cspSource, panel)
  panel.webview.html = html
  return panel
}

import { buildWebviewHtml } from "../../../script/m26/webview-html"

function buildHtml(outcome: Awaited<ReturnType<typeof renderGraphForPanel>>, cspSource: string, panel: WebviewPanel): string {
  if (outcome.ok) {
    return buildWebviewHtml({ cspSource, stateJson: outcome.stateJson, bodyMarkup: outcome.markup }).html
  }
  // Loud declared failure: the reason is rendered as content, with a nonce-
  // bound empty state payload — never a silent empty graph.
  const shell = buildWebviewHtml({ cspSource, stateJson: JSON.stringify({ error: outcome.error }), bodyMarkup: "" })
  const safe = outcome.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return shell.html.replace('<div id="bb-graph-root"></div>', `<div id="bb-graph-root" class="bb-graph-error"><p>${safe}</p></div>`)
}

/** Uri helper kept for tests (panel title uses the symbol, not the uri). */
export function panelTitleFor(uri: Uri, symbol: string): string {
  void uri
  return `Backbencher Graph — ${symbol}`
}
