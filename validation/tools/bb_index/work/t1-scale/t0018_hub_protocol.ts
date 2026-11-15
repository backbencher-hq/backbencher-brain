// src/lsp/hub_protocol.ts — M42.H6 (issue #654): the SINGLE owner of the
// versioned webview→editor postMessage contract.
//
// The webview-to-editor direction is the last unbuilt direction of the hub
// flow ("click any usage → the editor reveals that symbol at that line").
// It gets the same contract discipline as bb/graph:
//
//   schema:  HUB_PROTOCOL_SCHEMA_VERSION (1). Every message carries it; a
//            mismatch is a LOUD declared error (bb/webview: prefix), never
//            silent coercion.
//   types:   navigate(file, line, symbolId, staleness) — the webview asks the
//            editor to reveal an INDEX-RESOLVED location (no client-side
//            position guessing: the row's data-file/data-line come from the
//            server's traversal result, never parsed from display text);
//            requestRefresh — the webview asks the panel to re-query the
//            server; ack — the editor's answer {ok, error?}.
//   errors:  every rejection carries the "bb/webview:" prefix (machine
//            contract, mirror of "bb/graph:").
//   purity:  ZERO imports — this module is imported by the extension host
//            (ide/vscode/src/hub-navigation.ts), bundled into the webview
//            bridge script text (buildBridgeScript), and read by the
//            verifier + the GENERATED contract doc (docs/m42/HUB-PROTOCOL.md,
//            byte-identical drift gate). One source, no wire-shape drift.
//
// The bridge script is ALSO generated here (never hand-duplicated in the
// webview), so the message shapes the webview sends are the shapes this
// module validates — by construction.

export const HUB_PROTOCOL_SCHEMA_VERSION = 1

/** Declared error prefix — the machine contract for webview rejections. */
export const HUB_PROTOCOL_ERROR_PREFIX = "bb/webview:"

/** Staleness that rides on a navigate click (honesty follows the click:
 *  a stale target is labeled stale AT the reveal, never silently fresh). */
export interface HubStaleness {
  stale: boolean
  status: string
}

export interface HubNavigateTarget {
  /** Absolute path of the target file (index-resolved, 0-based LSP line). */
  file: string
  line: number
  /** Optional 0-based character; absent = reveal the line start. */
  character?: number
  /** The hovered/clicked symbol name (focus + identity, never a guess). */
  symbolId?: string
}

export interface HubNavigateMessage {
  schemaVersion: number
  type: "navigate"
  target: HubNavigateTarget
  staleness?: HubStaleness
}

export interface HubRequestRefreshMessage {
  schemaVersion: number
  type: "requestRefresh"
  /** The symbol the panel is showing (re-query identity). */
  symbol: string
  file?: string
}

export interface HubAckMessage {
  schemaVersion: number
  type: "ack"
  ok: boolean
  /** Declared error when !ok — always prefixed bb/webview:. */
  error?: string
}

export type HubMessage = HubNavigateMessage | HubRequestRefreshMessage | HubAckMessage

export function ackOk(): HubAckMessage {
  return { schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION, type: "ack", ok: true }
}

export function ackError(error: string): HubAckMessage {
  return { schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION, type: "ack", ok: false, error }
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v)
}

/** Validate an arbitrary postMessage payload. Returns the message or a
 *  declared error string (bb/webview: prefix). Version gate first — a
 *  mismatched version never falls through to field coercion. */
export function validateHubMessage(raw: unknown): { ok: true; message: HubMessage } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} message must be an object carrying schemaVersion and type` }
  }
  const m = raw as Record<string, unknown>
  if (m.schemaVersion !== HUB_PROTOCOL_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `${HUB_PROTOCOL_ERROR_PREFIX} schema version mismatch — message carries ${JSON.stringify(m.schemaVersion) ?? "nothing"}, editor implements ${HUB_PROTOCOL_SCHEMA_VERSION}`,
    }
  }
  if (m.type === "navigate") {
    const t = m.target
    if (typeof t !== "object" || t === null) return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.target must be an object` }
    const target = t as Record<string, unknown>
    if (typeof target.file !== "string" || target.file.length === 0) {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.target.file must be a non-empty string` }
    }
    if (!isInt(target.line) || target.line < 0) {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.target.line must be a non-negative integer` }
    }
    if (target.character !== undefined && (!isInt(target.character) || target.character < 0)) {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.target.character must be a non-negative integer` }
    }
    if (target.symbolId !== undefined && typeof target.symbolId !== "string") {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.target.symbolId must be a string` }
    }
    let staleness: HubStaleness | undefined
    if (m.staleness !== undefined) {
      const s = m.staleness
      if (typeof s !== "object" || s === null) return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.staleness must be an object` }
      const st = s as Record<string, unknown>
      if (typeof st.stale !== "boolean" || typeof st.status !== "string") {
        return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} navigate.staleness must carry {stale: boolean, status: string}` }
      }
      staleness = { stale: st.stale, status: st.status }
    }
    return {
      ok: true,
      message: {
        schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION,
        type: "navigate",
        target: {
          file: target.file,
          line: target.line,
          ...(target.character !== undefined ? { character: target.character } : {}),
          ...(typeof target.symbolId === "string" ? { symbolId: target.symbolId } : {}),
        },
        ...(staleness !== undefined ? { staleness } : {}),
      },
    }
  }
  if (m.type === "requestRefresh") {
    if (typeof m.symbol !== "string" || m.symbol.length === 0) {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} requestRefresh.symbol must be a non-empty string` }
    }
    if (m.file !== undefined && typeof m.file !== "string") {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} requestRefresh.file must be a string` }
    }
    return {
      ok: true,
      message: {
        schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION,
        type: "requestRefresh",
        symbol: m.symbol,
        ...(typeof m.file === "string" ? { file: m.file } : {}),
      },
    }
  }
  if (m.type === "ack") {
    // Acks are editor→webview, but they are part of the versioned contract:
    // they must validate round-trip. A webview echoing one back reaches the
    // handler's no-loop answer (never a silent accept, never a loop).
    if (typeof m.ok !== "boolean") {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} ack.ok must be a boolean` }
    }
    if (m.error !== undefined && typeof m.error !== "string") {
      return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} ack.error must be a string` }
    }
    return {
      ok: true,
      message: {
        schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION,
        type: "ack",
        ok: m.ok,
        ...(typeof m.error === "string" ? { error: m.error } : {}),
      },
    }
  }
  return { ok: false, error: `${HUB_PROTOCOL_ERROR_PREFIX} unknown message type ${JSON.stringify(m.type) ?? "missing"}` }
}

/** The webview bridge script text — GENERATED here, never hand-duplicated.
 *  Nonce-bound inline (the W6 shell injects it); no new origins, no remote
 *  code. Row clicks read the row's MACHINE attrs (data-file/data-line/data-
 *  symbol-id — index-resolved, set by the ONE renderer core) and post a
 *  versioned navigate message; a refresh control posts requestRefresh.
 *  Keyboard parity (M44.U2 §13.3): Enter/Space on a focused row navigates
 *  exactly like a click — same target attrs, same message, same staleness
 *  labeling. The U3 expander (data-action="bb-expand") is a LOCAL toggle
 *  (expand/collapse never leaves the client): clicking or Enter/Space on it
 *  flips the declared collapsed class + attrs and never navigates. Strict:
 *  unknown click targets are ignored (never guessed). */
export function buildBridgeScript(): string {
  return `
(function () {
  var VERSION = ${HUB_PROTOCOL_SCHEMA_VERSION}
  var api = null
  try { api = acquireVsCodeApi() } catch (e) { /* headless render: no host */ }
  function post(msg) { if (api !== null) { try { api.postMessage(msg) } catch (e) {} } }
  function parseLine(v) { var n = parseInt(v, 10); return Number.isNaN(n) || n < 0 ? null : n }
  function navigateFrom(row) {
    var file = row.getAttribute("data-file")
    var lineRaw = row.getAttribute("data-line")
    var symbolId = row.getAttribute("data-symbol-id") || undefined
    var line = parseLine(lineRaw)
    if (typeof file !== "string" || file.length === 0 || line === null) return
    // Staleness is a PANEL fact (bb/staleness for the root file): the
    // enclosing bb-hub-view carries data-stale/data-stale-status; a stale
    // click is labeled stale at the reveal (honesty follows the click).
    var view = row
    var stale = false
    var staleStatus = "unknown"
    while (view !== null && view !== document) {
      if (view.classList && view.classList.contains("bb-hub-view")) break
      view = view.parentElement
    }
    if (view !== null && view !== document) {
      stale = view.getAttribute("data-stale") === "1"
      staleStatus = view.getAttribute("data-stale-status") || "unknown"
    }
    var msg = { schemaVersion: VERSION, type: "navigate", target: { file: file, line: line, symbolId: symbolId } }
    if (stale) msg.staleness = { stale: true, status: staleStatus }
    post(msg)
  }
  // U3 expand/collapse: the expander is a LOCAL DOM toggle (no postMessage —
  // expansion is client state, never a server round trip). The toggle flips
  // the declared classes/attrs the renderer emitted: the row's children
  // wrapper (bb-hub-children) loses/gains bb-hub-collapsed, the row's
  // data-expanded and the control's aria-expanded flip, and the glyph turns.
  function expanderFrom(el) {
    for (var n = el; n !== null && n !== document; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute("data-action") === "bb-expand") return n
    }
    return null
  }
  function toggleExpand(expander) {
    var row = expander.parentElement
    if (row === null) return
    var wrap = null
    for (var i = 0; i < row.children.length; i++) {
      if (row.children[i].classList && row.children[i].classList.contains("bb-hub-children")) { wrap = row.children[i]; break }
    }
    if (wrap === null) return
    var collapsed = wrap.classList.contains("bb-hub-collapsed")
    if (collapsed) wrap.classList.remove("bb-hub-collapsed")
    else wrap.classList.add("bb-hub-collapsed")
    row.setAttribute("data-expanded", collapsed ? "1" : "0")
    expander.setAttribute("aria-expanded", collapsed ? "true" : "false")
    expander.textContent = collapsed ? "▾" : "▸"
  }
  document.addEventListener("click", function (ev) {
    // An expander click toggles the subtree — never navigates.
    var expander = expanderFrom(ev.target)
    if (expander !== null) { toggleExpand(expander); return }
    var row = null
    for (var el = ev.target; el !== null && el !== document; el = el.parentElement) {
      if (el.classList && el.classList.contains("bb-hub-row")) { row = el; break }
    }
    if (row === null) return
    navigateFrom(row)
  })
  // Keyboard parity (M44.U2 §13.3 + M44.U3): Enter/Space on a focused
  // expander toggles it; on a focused data-clickable row it navigates
  // exactly like a click — same target attrs, same message, same staleness.
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return
    var target = ev.target
    if (target && target.getAttribute && target.getAttribute("data-action") === "bb-expand") {
      ev.preventDefault()
      toggleExpand(target)
      return
    }
    var row = null
    for (var el = ev.target; el !== null && el !== document; el = el.parentElement) {
      if (el.classList && el.classList.contains("bb-hub-row")) { row = el; break }
    }
    if (row === null) return
    if (row.getAttribute("data-clickable") !== "1") return
    ev.preventDefault()
    navigateFrom(row)
  })
  var refreshers = Array.prototype.slice.call(document.querySelectorAll("[data-hub-refresh]"))
  refreshers.forEach(function (b) {
    b.addEventListener("click", function () {
      var symbol = b.getAttribute("data-hub-refresh")
      post({ schemaVersion: VERSION, type: "requestRefresh", symbol: symbol })
    })
  })
})()
`
}

/** Doc facts for the GENERATED contract doc (single source — the doc cannot
 *  drift from this module). */
export const HUB_PROTOCOL_DOC = {
  title: "bb/webview — the hub→editor postMessage contract (M42.H6)",
  schemaVersion: HUB_PROTOCOL_SCHEMA_VERSION,
  errorPrefix: HUB_PROTOCOL_ERROR_PREFIX,
  messageTypes: [
    {
      type: "navigate",
      purpose: "click a hub usage row → the editor reveals that symbol at that line",
      fields: [
        { name: "schemaVersion", kind: "number", required: true, note: "must equal 1 — a mismatch is a loud declared error, never silent coercion" },
        { name: "type", kind: '"navigate"', required: true },
        { name: "target.file", kind: "string (absolute)", required: true, note: "index-resolved — the renderer's machine attrs, never parsed from display text" },
        { name: "target.line", kind: "integer ≥ 0", required: true, note: "0-based LSP line of the target symbol (stored by the index)" },
        { name: "target.character", kind: "integer ≥ 0", required: false },
        { name: "target.symbolId", kind: "string", required: false, note: "symbol identity for focus — never a guess" },
        { name: "staleness", kind: "{stale: boolean, status: string}", required: false, note: "a stale target is labeled stale AT the reveal — honesty follows the click" },
      ],
    },
    {
      type: "requestRefresh",
      purpose: "the webview asks the panel to re-query the server for a symbol",
      fields: [
        { name: "schemaVersion", kind: "number", required: true },
        { name: "type", kind: '"requestRefresh"', required: true },
        { name: "symbol", kind: "string", required: true },
        { name: "file", kind: "string", required: false },
      ],
    },
    {
      type: "ack",
      purpose: "the editor's answer to a webview message",
      fields: [
        { name: "schemaVersion", kind: "number", required: true },
        { name: "type", kind: '"ack"', required: true },
        { name: "ok", kind: "boolean", required: true },
        { name: "error", kind: "string (bb/webview: prefix)", required: false, note: "present exactly when !ok" },
      ],
    },
  ],
  bridgeScript: "buildBridgeScript() generates the nonce-bound webview script — the shapes the webview sends are the shapes this module validates.",
}
