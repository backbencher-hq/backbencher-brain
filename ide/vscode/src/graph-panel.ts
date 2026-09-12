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
import { window, ViewColumn, type ExtensionContext, type WebviewPanel, type Uri } from "vscode"
import type { LanguageClient } from "vscode-languageclient/node"

// Bundled at build time from script/m26/graph-core.ts (the ONE renderer).
// See esbuild-extension.mjs — importing it here is what makes the single-
// renderer rule structural: a per-IDE fork would have to bypass the bundle.
import { renderGraph } from "../../../script/m26/graph-core"
// Type-only import: erased at build time (thin client preserved). The shape is
// owned by the server's identity resolver (src/lsp/identity.ts).
import type { MemberResolution } from "../../../src/lsp/identity"

/** Escaping DOM port over strings (browser Element API, no vscode import).
 *  Exported (M42.H4) so the impact panel shares the SAME port + serializer —
 *  one escaping implementation across webview surfaces. */
export class StringElement {
  tagName: string
  className = ""
  attrs: Record<string, string> = {}
  textContent = ""
  children: StringElement[] = []
  constructor(tag: string) {
    this.tagName = tag
  }
  addClass(c: string): void {
    this.className = this.className ? `${this.className} ${c}` : c
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v
  }
  appendChild(child: StringElement): StringElement {
    this.children.push(child)
    return child
  }
}

export function escapeHtmlValue(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function serialize(el: StringElement): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtmlValue(v)}"`)
    .join("")
  const cls = el.className ? ` class="${escapeHtmlValue(el.className)}"` : ""
  const open = `<${el.tagName}${cls}${attrs}`
  if (el.children.length === 0) return `${open}>${escapeHtmlValue(el.textContent)}</${el.tagName}>`
  return `${open}>${el.children.map(serialize).join("")}</${el.tagName}>`
}

/** bb/graph request — schemaVersion-pinned per GRAPH-TRANSPORT.md. The
 *  method name as a string (same convention as bb/staleness). */
const GRAPH_METHOD = "bb/graph"

export interface GraphPanelDeps {
  client: LanguageClient | null
  cspSource: string
}

/** M55.T1 (Truth Rule 2): the ONE panel-title rule for a declared
 *  substitution. When the server rooted a MEMBER through its owning
 *  declaration, the title states it — a substitution the user cannot see is
 *  the defect this exists to prevent (the filing run: the constructor graph
 *  opened titled `Store` with nothing said). Direct resolutions keep the
 *  plain title. Lives here because every panel module already imports from
 *  graph-panel (one rule, no per-panel fork, no import cycle). */
export function applyResolutionTitle(
  panel: { title: string },
  plainTitle: string,
  outcome: { ok: true; resolution?: MemberResolution } | { ok: false; error: string },
  symbol: string,
  noun: string,
): void {
  panel.title = plainTitle
  if (!outcome.ok) return
  const r = outcome.resolution
  if (r?.through === "owning-declaration" && r.ownerName) {
    panel.title = `Backbencher ${noun} — ${symbol} → ${r.ownerName} (owning declaration)`
  }
}

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

/** Open (or reuse) the graph panel for a symbol. */
export async function showGraphPanel(symbol: string, deps: GraphPanelDeps, context: ExtensionContext, file?: string): Promise<WebviewPanel> {
  const panel = window.createWebviewPanel("bbGraph", `Backbencher Graph — ${symbol}`, ViewColumn.Beside, {
    enableScripts: false,
    localResourceRoots: [],
  })
  context.subscriptions.push(panel)
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
