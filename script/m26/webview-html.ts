// script/m26/webview-html.ts — M26.W6: the canonical webview HTML shell.
//
// Single owner of the graph webview's HTML document (the future webview
// provider consumes this; per-IDE forks of the shell are banned, same rule
// as the renderer core). Hardening per issue #547:
//
//   CSP:         strict — `default-src 'none'`; scripts and styles are
//                nonce-bound; images limited to the editor's own cspSource;
//                NO remote origins, NO unsafe-inline, NO eval.
//   escaping:    every repo-controlled string (symbol names, file paths,
//                hover markdown) passes escapeHtml() BEFORE insertion; the
//                shell renders user data only through this function.
//   structure:   buildWebviewHtml() is a pure function of (nonce, cspSource,
//                state) — deterministic, import-pure except node:crypto for
//                nonce generation, no editor imports (the provider adapts).
//
// Declared guarantees (gated by script/m26/verify-content-security.ts):
//   G1 csp:        the emitted CSP blocks inline script, remote origins, eval
//   G2 escaping:   every repo-controlled string is escaped before render;
//                  adversarial fixtures render inert
//   G3 mutation:   removed escaping, relaxed CSP, and raw markdown injection
//                  are each caught by the verifier

import { randomBytes } from "node:crypto"
import { HUB_CSS } from "./hub-css"

/** Strict CSP for the webview. nonce goes into script-src/style-src; the
 *  editor's own cspSource covers local resources (icons). No remote origin
 *  is ever present. */
export function cspFor(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `img-src ${cspSource} data:`,
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
}

/** HTML-escape every repo-controlled string before render. Escapes & < > "
 *  ' — the full set that can break out of an element body or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Adversarial fixtures: hostile symbol names / paths / markdown payloads a
 *  crafted repo could produce. Every one must render inert. */
export const ADVERSARIAL_FIXTURES: Array<{ name: string; payload: string; mustContain: string; mustNotContain: string[] }> = [
  {
    name: "script tag in symbol name",
    payload: "<script>alert(1)</script>",
    mustContain: "&lt;script&gt;alert(1)&lt;/script&gt;",
    mustNotContain: ["<script>"],
  },
  {
    name: "event handler attribute breakout",
    payload: '"><img src=x onerror=alert(1)>',
    mustContain: "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
    mustNotContain: ["<img src=x"],
  },
  {
    name: "svg onload payload",
    payload: "<svg onload=alert(1)>",
    mustContain: "&lt;svg onload=alert(1)&gt;",
    mustNotContain: ["<svg onload"],
  },
  {
    name: "quote edge case (attribute escape, JSON-embedded)",
    payload: 'name" onmouseover="alert(1)',
    // Inside the JSON state blob the payload's quotes arrive backslash-
    // escaped first (JSON), then HTML-escaped: " -> \" -> \&quot;
    mustContain: "name\\&quot; onmouseover=\\&quot;alert(1)",
    mustNotContain: ['" onmouseover="'],
  },
  {
    name: "unicode lookalike tags",
    payload: "‹script›alert(1)‹/script› ＜script＞",
    mustContain: "＜script＞",
    mustNotContain: [],
  },
  {
    name: "ampersand entity smuggling",
    payload: "&lt;script&gt;alert(1)&lt;/script&gt;",
    mustContain: "&amp;lt;script&amp;gt;",
    mustNotContain: [],
  },
]

/** The canonical webview HTML document. `state` is embedded as escaped JSON
 *  in a nonce-bound script tag; repo-controlled strings inside state are
 *  escaped by the consumer through escapeHtml() before embedding (defence in
 *  depth: the shell escapes the JSON delimiters too).
 *
 *  M44.U2 (issue #689): the shell injects the hub stylesheet (a static,
 *  repo-controlled string from script/m26/hub-css.ts — the ONE style owner)
 *  as a nonce-bound <style> block. `styles: false` opts out for providers
 *  that bring their own sheet; the default styles every consumer so the hub
 *  can never again render as unstyled text. */
export function buildWebviewHtml(options: { nonce?: string; cspSource: string; stateJson: string; bodyMarkup?: string; styles?: boolean }): { html: string; nonce: string; csp: string } {
  const nonce = options.nonce ?? randomBytes(16).toString("hex")
  const csp = cspFor(nonce, options.cspSource)
  // The state payload is double-defence: escapeHtml over the JSON string.
  const safeState = escapeHtml(options.stateJson)
  // bodyMarkup: pre-rendered markup produced by the ONE renderer core
  // (script/m26/graph-core.ts) through an escaping DOM port — the shell
  // accepts it verbatim because the producer already escaped every
  // repo-controlled string (W6 law; the verifier gates the producer).
  const body = options.bodyMarkup ? `<div id="bb-graph-root">${options.bodyMarkup}</div>` : `<div id="bb-graph-root"></div>`
  const styleBlock = options.styles === false ? "" : `<style nonce="${nonce}">${HUB_CSS}</style>`
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    `<title>Backbencher Graph</title>`,
    styleBlock,
    "</head>",
    "<body>",
    body,
    `<script nonce="${nonce}" type="application/json" id="bb-state">${safeState}</script>`,
    "</body>",
    "</html>",
  ].filter((s) => s.length > 0).join("\n")
  return { html, nonce, csp }
}
