// src/lsp/server.ts — M24.L1: bb_lsp server skeleton.
//
// A standalone LSP 3.18 server over stdio. This module owns the protocol
// layer only: lifecycle (initialize/initialized/shutdown/exit), capabilities
// advertisement, and project resolution. Feature handlers (hover, definition,
// references, symbols, call hierarchy) are registered in later issues (L2-L5)
// — capabilities advertise ONLY what is implemented here (IDE Honesty
// Contract §2: advertising an unimplemented capability is a gate failure).
//
// Declared guarantees (gated by script/m24/verify-server.ts):
//   lifecycle:     initialize → initialized → shutdown → exit honored;
//                  requests before initialize rejected with -32002; requests
//                  after shutdown rejected with -32600
//   capabilities:  advertised capabilities match registered handlers exactly
//                  (currently: none — features land in L2-L5)
//   transport:     JSON-RPC 2.0 with Content-Length framing over stdio
//   project:       workspace root resolves to the brain.db project id using
//                  the sha1-of-realpath convention (src/cli/index.ts)
//   index guard:   unindexed workspace → every request gets actionable
//                  guidance (mirrors the MCP index guard), never a crash
//   languages:     requests for files in non-launch languages receive
//                  declared-absent responses, never a crash
//
// Declared limitations (per contract §1):
//   - single-root workspaces only (multi-root is a filed decision for later)
//   - no completion, no diagnostics, no rename (complement stance, §7)
//   - feature handlers arrive in L2-L5; capabilities advertise only
//     registered handlers
//
// Run: npx tsx src/lsp/server.ts --dir <workspace-root>
//      (also runs from compiled dist: node dist/lsp/server.js --dir <path>)

import path from "node:path"
import { realpathSync, appendFileSync } from "node:fs"
import { getProjectId } from "../util/project-id"
import { documentHighlight } from "./document_highlight"
import { BACKBENCHER_BRAIN_VERSION } from "../version"

/** The launch set, its membership test, and the path→language map live in
 *  the single-owner module (M29.R2: one owner; the set was duplicated here
 *  and in hover.ts — a drift hazard the wave found). */
import { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath } from "./launch_languages"
export { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath }

/** LSP method names this server implements. The capabilities advertisement is
 *  derived from this table so the two can never drift apart. Features land in
 *  L2-L5; today the set is empty by design. */
export const IMPLEMENTED_METHODS: string[] = []

/** JSON-RPC / LSP error codes used by the lifecycle. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
} as const

/** A declared, machine-readable client-input error (M55.T2). Handlers throw
 *  this when a request cannot be answered for a reason IN THE REQUEST (a
 *  missing item, a malformed position): the wire answer is InvalidParams with
 *  a `bb/callHierarchy:` reason, never the InternalError an unhandled crash
 *  produces. `Cannot read properties of undefined` is not an error message. */
export class DeclaredParamsError extends Error {
  readonly code = ErrorCodes.InvalidParams
  constructor(message: string) {
    super(message)
    this.name = "DeclaredParamsError"
  }
}

export interface LspContext {
  /** absolute workspace root (single-root scope; declared limitation) */
  root: string
  /** brain.db project id (sha1-of-realpath convention) */
  projectId: string
  /** server info string sent in initialize result */
  serverInfo: { name: string; version: string }
}

export interface ProtocolEvent {
  direction: "in" | "out"
  method: string
  /** response error code, when the message is an error response */
  errorCode?: number
  at: string
}

export interface ServerHooks {
  /** called for every wire message (requests, responses, notifications) */
  onEvent?: (event: ProtocolEvent) => void
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

const JSONRPC = "2.0"

function isRequest(msg: { id?: unknown; method?: unknown }): boolean {
  return msg.method !== undefined && msg.id !== undefined
}

function isNotification(msg: { id?: unknown; method?: unknown }): boolean {
  return msg.method !== undefined && msg.id === undefined
}

function isResponse(msg: { id?: unknown; method?: unknown }): boolean {
  return msg.method === undefined && msg.id !== undefined
}

/**
 * The bb_lsp server. Owns the wire protocol (JSON-RPC 2.0 with Content-Length
 * framing over stdio), the lifecycle state machine, and project resolution.
 * Feature handlers register via `register()`; the capabilities advertisement
 * is derived from the registered set so the two can never drift apart.
 */
export class BbLspServer {
  private lifecycleState: "uninitialized" | "initialized" | "shutdown" = "uninitialized"
  private handlers = new Map<string, (params: any) => unknown>()
  private protocolEvents: ProtocolEvent[] = []
  private hooks: ServerHooks
  private stderrLogPath: string | null = process.env.BB_LSP_STDERR_LOG ?? null
  readonly context: LspContext

  constructor(root: string, hooks: ServerHooks = {}) {
    const resolved = path.resolve(root)
    // Canonical realpath keeps identity identical to the CLI's convention.
    let canonical = resolved
    try {
      canonical = realpathSync.native(resolved)
    } catch {
      // Nonexistent roots keep deterministic lexical identity (getProjectId
      // handles the same fallback for validation).
    }
    this.context = {
      root: canonical,
      projectId: getProjectId(canonical),
      serverInfo: { name: "bb_lsp", version: BACKBENCHER_BRAIN_VERSION },
    }
    this.hooks = hooks
  }

  /** Register a feature handler. Capabilities derive from this table. */
  register(method: string, handler: (params: any) => unknown): void {
    this.handlers.set(method, handler)
  }

  /** Capabilities advertised in the initialize result — derived from the
   *  registered handler set so advertisement can never outrun reality. */
  capabilities(): Record<string, unknown> {
    const caps: Record<string, unknown> = {}
    if (this.handlers.has("textDocument/hover")) caps.hoverProvider = true
    if (this.handlers.has("textDocument/definition")) caps.definitionProvider = true
    if (this.handlers.has("textDocument/references")) caps.referencesProvider = true
    if (this.handlers.has("textDocument/documentHighlight")) caps.documentHighlightProvider = true
    if (this.handlers.has("textDocument/documentSymbol")) caps.documentSymbolProvider = true
    if (this.handlers.has("workspace/symbol")) caps.workspaceSymbolProvider = true
    if (
      this.handlers.has("textDocument/prepareCallHierarchy") &&
      this.handlers.has("callHierarchy/incomingCalls") &&
      this.handlers.has("callHierarchy/outgoingCalls")
    ) {
      caps.callHierarchyProvider = true
    }
    if (this.handlers.has("bb/graph")) caps.graphProvider = { schemaVersion: 2 }
    return caps
  }

  state(): string {
    return this.lifecycleState
  }

  events(): ProtocolEvent[] {
    return this.protocolEvents
  }

  private record(direction: ProtocolEvent["direction"], method: string, errorCode?: number): void {
    const event: ProtocolEvent = { direction, method, at: new Date().toISOString() }
    if (errorCode !== undefined) event.errorCode = errorCode
    this.protocolEvents.push(event)
    this.hooks.onEvent?.(event)
  }

  /**
   * Handle one decoded JSON-RPC message. Returns the response message to send
   * (null for notifications and responses, which produce no reply).
   */
  async handleMessage(message: any): Promise<Record<string, unknown> | null> {
    if (!message || typeof message !== "object") {
      return this.errorResponse(null, ErrorCodes.InvalidRequest, "invalid message")
    }

    if (isResponse(message)) return null

    const method: string | undefined = message.method
    if (typeof method !== "string") {
      return this.errorResponse(message.id ?? null, ErrorCodes.InvalidRequest, "missing method")
    }

    // Lifecycle gate: requests before initialize are rejected.
    if (this.lifecycleState === "uninitialized" && method !== "initialize" && method !== "exit") {
      this.record("in", method, ErrorCodes.ServerNotInitialized)
      if (isNotification(message)) return null
      return this.errorResponse(message.id, ErrorCodes.ServerNotInitialized, "server not initialized")
    }

    // After shutdown, only exit is meaningful; everything else is invalid.
    if (this.lifecycleState === "shutdown" && method !== "exit") {
      this.record("in", method, ErrorCodes.InvalidRequest)
      if (isNotification(message)) return null
      return this.errorResponse(message.id, ErrorCodes.InvalidRequest, "invalid request after shutdown")
    }

    // exit: the terminal notification. Always honored.
    if (method === "exit") {
      this.record("in", "exit")
      return null
    }

    if (method === "initialize") {
      this.record("in", "initialize")
      this.lifecycleState = "initialized"
      this.record("out", "initialize")
      return {
        jsonrpc: JSONRPC,
        id: message.id,
        result: {
          capabilities: this.capabilities(),
          serverInfo: this.context.serverInfo,
          protocolVersion: "3.18",
        },
      }
    }

    if (method === "initialized") {
      this.record("in", "initialized")
      return null
    }

    if (method === "shutdown") {
      this.record("in", "shutdown")
      this.lifecycleState = "shutdown"
      this.record("out", "shutdown")
      return { jsonrpc: JSONRPC, id: message.id, result: null }
    }

    // Feature methods: registered handlers, or declared-absent for methods we
    // will implement later; unsupported languages get declared-absent too.
    const handler = this.handlers.get(method)
    if (handler) {
      this.record("in", method)
      try {
        const result = await handler(message.params)
        this.record("out", method)
        return { jsonrpc: JSONRPC, id: message.id, result }
      } catch (error: any) {
        // The distinction is by TYPE, never by a duck-typed `.code` (Node's own
        // errors carry codes too). A declared input error is the client's to
        // fix; anything else is an internal failure and is reported as one.
        const code = error instanceof DeclaredParamsError ? ErrorCodes.InvalidParams : ErrorCodes.InternalError
        this.record("out", method, code)
        return this.errorResponse(message.id, code, error?.message ?? String(error))
      }
    }

    // Known feature surface not yet implemented: declared absence, not silence.
    this.record("in", method, ErrorCodes.MethodNotFound)
    if (isNotification(message)) return null
    return this.errorResponse(message.id, ErrorCodes.MethodNotFound, `method not implemented: ${method}`)
  }

  /**
   * Wire loop: read Content-Length-framed JSON-RPC messages from stdin, feed
   * each to handleMessage, and write responses to stdout. Resolves when the
   * exit notification arrives (or stdin closes).
   */
  async run(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
    // Broken pipe = the editor side is GONE. Exit cleanly: a dead transport
    // cannot recover, and an unhandled EPIPE (via any console.* call racing
    // the death) turns a normal shutdown into a crash (found live by E6:
    // the host was SIGTERMed while the server wrote a stderr log line).
    const onEpipe = (err: NodeJS.ErrnoException): void => {
      if ((err as NodeJS.ErrnoException)?.code === "EPIPE") {
        try { output.end() } catch {}
        process.exit(0)
      }
    }
    process.on("error", onEpipe)
    if (output === process.stdout) process.stdout.on("error", onEpipe)
    if (input === process.stdin) process.stdin.on("error", onEpipe)

    const writeMessage = (message: Record<string, unknown> | null): void => {
      if (!message) return
      const body = Buffer.from(JSON.stringify(message), "utf8")
      output.write(`Content-Length: ${body.length}\r\n\r\n`)
      output.write(body)
    }

    return new Promise<void>((resolve) => {
      let finished = false
      const finish = () => {
        if (!finished) {
          finished = true
          resolve()
        }
      }

      // Proper byte-stream framing: accumulate bytes, parse headers up to
      // \r\n\r\n, then consume exactly Content-Length bytes as the body.
      let chunks: Buffer[] = []
      let buffered = 0
      let contentLength = -1

      const tryExtract = (): void => {
        while (true) {
          if (contentLength < 0) {
            // Look for the \r\n\r\n header terminator.
            const combined = Buffer.concat(chunks)
            const idx = combined.indexOf("\r\n\r\n")
            if (idx === -1) return
            const headerText = combined.subarray(0, idx).toString("utf8")
            const match = /Content-Length:\s*(\d+)\s*(?:\r\n.*)?$/is.exec(headerText)
            if (!match) {
              writeMessage(this.errorResponse(null, ErrorCodes.ParseError, "missing Content-Length header"))
              chunks = []
              buffered = 0
              return
            }
            contentLength = parseInt(match[1], 10)
            const rest = combined.subarray(idx + 4)
            chunks = [rest]
            buffered = rest.length
          }
          if (contentLength >= 0 && buffered >= contentLength) {
            const combined = Buffer.concat(chunks)
            const body = combined.subarray(0, contentLength)
            chunks = [combined.subarray(contentLength)]
            buffered = chunks[0].length
            contentLength = -1
            void this.dispatch(body.toString("utf8"), writeMessage, finish)
            if (finished) return
            continue
          }
          return
        }
      }

      input.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
        buffered += chunk.length
        tryExtract()
      })
      input.on("end", finish)
      input.on("error", finish)
    })
  }

  private async dispatch(
    body: string,
    write: (message: Record<string, unknown> | null) => void,
    finish: () => void,
  ): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(body)
    } catch {
      write(this.errorResponse(null, ErrorCodes.ParseError, "parse error"))
      return
    }

    if (message && isNotification(message) && (message as { method?: unknown }).method === "exit") {
      this.record("in", "exit")
      finish()
      return
    }
    const response = await this.handleMessage(message)
    // Test-only request/error trace (BB_LSP_STDERR_LOG): names the request
    // and any error response, so an editor leg can attribute a failure to
    // the exact method (E6 diagnosis; zero cost when unset).
    if (this.stderrLogPath) {
      const req = message as { id?: unknown; method?: unknown; params?: unknown }
      const err = (response as { error?: { message?: unknown } } | null)?.error
      try {
        appendFileSync(this.stderrLogPath, `[${new Date().toISOString()}] ${req.method ?? "?"} id=${String(req.id)} params=${JSON.stringify(req.params ?? null)?.slice(0, 220)} -> ${err ? "ERROR " + String(err.message).slice(0, 200) : "ok"}\n`)
      } catch {}
    }
    write(response)
  }

  private errorResponse(id: unknown, code: number, message: string): Record<string, unknown> {
    return {
      jsonrpc: JSONRPC,
      id: id ?? null,
      error: { code, message },
    }
  }
}

/** Create a server wired to a workspace root. Feature handlers register on
 *  the returned instance in L2-L5. */
export function createServer(root: string, hooks: ServerHooks = {}): BbLspServer {
  return new BbLspServer(root, hooks)
}

// --- Standalone entry ---------------------------------------------------------
// `bb lsp`-style binary: node dist/lsp/server.js --dir <workspace-root> or
// bun/npx tsx src/lsp/server.ts --dir <workspace-root>. Wires the L2-L5
// feature handlers over the persisted index and serves stdio.

import { fileURLToPath } from "node:url"
import { BrainDatabase } from "../brain/database"
import { hover } from "./hover"
import { resolveDefinition, resolveReferences } from "./navigation"
import { documentSymbols, workspaceSymbols, type DocumentSymbolEntry } from "./symbols"
import {
  prepareCallHierarchy,
  expandCalls,
  symbolKindFor,
  type CallHierarchyItem,
  type CallHierarchyIncomingCall,
  type CallHierarchyOutgoingCall,
} from "./call_hierarchy"

/** Convert a `file://` LSP URI to a filesystem path (or passthrough). */
export function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri)
    } catch {
      return uri.slice("file://".length)
    }
  }
  return uri
}

/** Wire all L2-L5 feature handlers onto a server instance. Each handler
 *  opens the project's persisted index and delegates to the component. */
export function wireFeatures(server: BbLspServer): void {
  const projectId = server.context.projectId

  // Freshness (M25.E5): the P2 monitor watches the workspace, debounces
  // edits into incremental reindexes, and answers bb/staleness with the
  // machine-readable stale marker (contract §4.3: unknown counts as stale —
  // silence is guilt). bb/ namespace = private honesty plumbing; it carries
  // no I-claim itself, it is what the status surface renders.
  // Lazy init: the raw handle opens async, so the monitor (and the watcher)
  // start on the first bb/staleness request.
  let monitor: import("./freshness").FreshnessMonitor | null = null
  async function freshnessMonitor(): Promise<import("./freshness").FreshnessMonitor> {
    if (monitor !== null) return monitor
    const { createFreshnessMonitor } = await import("./freshness")
    const { reindexFilesParallel } = await import("../ast/parallel-indexer")
    const raw = await BrainDatabase.getRawInstance(projectId)
    monitor = createFreshnessMonitor({
      projectId,
      projectPath: server.context.root,
      raw,
      fileIdForPath: (p: string): string | null => {
        try {
          const row = raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(p) as { id: string } | undefined
          return row?.id ?? null
        } catch {
          return null
        }
      },
      // LSP-safety-critical: the indexer's DEFAULT logger writes progress to
      // process.stdout — protocol poison on a stdio server (progress lines
      // corrupt JSON-RPC framing; the editor client dies with "Header must
      // provide a Content-Length property", found live by E5). All server-side
      // indexer output must go to stderr; worker forks already do the same.
      reindex: (changes) =>
        reindexFilesParallel(projectId, server.context.root, changes, {
          logger: { log: (...args: unknown[]) => console.error(...args), write: (s: string) => process.stderr.write(s) },
        }),
      log: (msg, meta) => console.error(`[bb_lsp] ${msg}`, meta ?? ""),
    })
    monitor.start()
    return monitor
  }

  server.register("bb/staleness", async (params: any) => {
    const mon = await freshnessMonitor()
    const filePath = uriToPath(params?.uri ?? "")
    let fileId: string | null = null
    try {
      const raw = await BrainDatabase.getRawInstance(projectId)
      const row = raw.prepare("SELECT id FROM brain_file WHERE path = ?").get(filePath) as { id: string } | undefined
      fileId = row?.id ?? null
    } catch {}
    if (fileId === null) {
      // Not in the index: honest marker, never a fabricated fresh claim.
      return { stale: true, status: "missing", pendingReindex: false }
    }
    return mon.marker(fileId)
  })

  // Graph transport (M26.W2): the declared, versioned custom request feeding
  // the webview. A missing/mismatched schemaVersion and an unindexed
  // workspace are LOUD declared errors (`bb/graph:` prefix, machine-parseable)
  // — never silent coercion, never an empty result that would render as
  // "no connections". Advertisement: bb/ methods surface through
  // capabilities.graphProvider so honest clients can detect the surface
  // before calling it; a client that calls without the version gets the
  // loud version error by design (that IS the versioning mechanism).
  server.register("bb/graph", async (params: any) => {
    const { handleGraphRequest } = await import("./graph_request")
    // A db that cannot open (never indexed, missing dirs) degrades to the
    // DECLARED not-indexed error inside handleGraphRequest — not an sqlite
    // InternalError the client cannot act on.
    let raw: Awaited<ReturnType<typeof BrainDatabase.getRawInstance>> | null = null
    try {
      raw = await BrainDatabase.getRawInstance(projectId)
    } catch {}
    return handleGraphRequest(raw, projectId, params)
  })

  // Impact transport (M42.H4): the declared, versioned custom request that
  // feeds the hover's "Impact analysis" action. Same law as bb/graph: schema
  // mismatch, unindexed workspace, and unknown symbol are LOUD declared
  // errors (`bb/impact:` prefix) — never an empty set that would read as
  // "nothing depends on this". Symbol resolution is server-side only.
  server.register("bb/impact", async (params: any) => {
    const { handleImpactRequest } = await import("./impact_request")
    let raw: Awaited<ReturnType<typeof BrainDatabase.getRawInstance>> | null = null
    try {
      raw = await BrainDatabase.getRawInstance(projectId)
    } catch {}
    return handleImpactRequest(raw, projectId, params)
  })


  server.register("textDocument/hover", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await hover(raw, {
      filePath: uriToPath(params?.textDocument?.uri ?? ""),
      position: params?.position ?? { line: 0, character: 0 },
    })
    // Wire law (same rule as definition below — LSP 3.18): hover answers a
    // PROTOCOL Hover, never the component envelope. The envelope's
    // `contents: null` declared-absence shape is INVALID on the wire — the
    // stock client converter throws on it ("Cannot read properties of null
    // (reading 'kind')", live VS Code session 2026-09-12) and VS Code then
    // logs "provider FAILED" and silently falls back to the native hover:
    // the absence contract renders as a crash. Presence keeps the honest
    // markdown; absence is wire `null`. M42/M44 extras (evidence tier,
    // provenance, action args) ride `Hover.data` — the spec's declared
    // data slot, which the client passes through untouched.
    if (r.contents === null || r.range === null || r.data === null) return null
    return {
      contents: r.contents,
      range: { start: r.range.start, end: r.range.end },
      data: { provenance: r.provenance, symbol: r.data },
    }
  })

  // Wire law (LSP 3.18) — same rule as documentHighlight below. The standard
  // read methods answer PROTOCOL shapes (Location[], DocumentSymbol[], …),
  // never the component envelopes (a typed editor client would crash or
  // drop them — found live: VS Code's documentSymbol/call-hierarchy adapters
  // iterate the result as an array and died reading `.name` of undefined,
  // owner test 2026-09-06). Honesty metadata the protocol cannot carry
  // (evidence tier, truncation, provenance) is declared and verified at the
  // component layer; where the spec HAS a data slot (DocumentSymbol.data,
  // CallHierarchyItem.data) the tier rides there.
  server.register("textDocument/definition", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await resolveDefinition(raw, {
      filePath: uriToPath(params?.textDocument?.uri ?? ""),
      line: params?.position?.line ?? 0,
      character: params?.position?.character ?? 0,
    })
    // Wire: Location | Location[] | null. Absence is `null`, never an
    // envelope that would read as a fabricated definition.
    if (!r.found || r.location === null) return null
    return navLocationToWire(r.location)
  })

  server.register("textDocument/documentHighlight", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await documentHighlight(raw, {
      filePath: uriToPath(params?.textDocument?.uri ?? ""),
      line: params?.position?.line ?? 0,
      character: params?.position?.character ?? 0,
    })
    // Wire law (LSP 3.18): the result is DocumentHighlight[] | null — never
    // a wrapper object (a typed editor client would drop it). The component's
    // declared metadata (evidence tier + staleness, §12.2) rides on each
    // item's `data`: a client that ignores data still renders ranges/kinds;
    // ours reads it to label the highlight render. Absence is wire `null`.
    if (r.highlights.length === 0) return null
    return r.highlights.map((h) => ({
      range: { start: h.start, end: h.end },
      kind: h.kind,
      data: { evidenceTier: r.evidenceTier, staleness: r.staleness, symbol: r.symbol },
    }))
  })

  server.register("textDocument/references", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await resolveReferences(raw, {
      filePath: uriToPath(params?.textDocument?.uri ?? ""),
      line: params?.position?.line ?? 0,
      character: params?.position?.character ?? 0,
      includeDeclaration: params?.context?.includeDeclaration ?? false,
    })
    // Wire: Location[]. Honesty (truncated/totalCount/evidenceTier) stays at
    // the component layer — the references UI renders what the index stores.
    return r.locations.map(navLocationToWire)
  })

  server.register("textDocument/documentSymbol", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = documentSymbols(raw, uriToPath(params?.textDocument?.uri ?? ""))
    // Wire: DocumentSymbol[] (3.17+ — each item MAY carry `data`; the tier
    // rides there for clients that read it, the tree renders regardless).
    const tier = r.evidenceTier
    const notIndexed = r.notIndexed
    const toWire = (e: DocumentSymbolEntry): unknown => ({
      name: e.name,
      detail: e.qualifiedName ?? undefined,
      kind: symbolKindFor(e.symbolType),
      range: symbolRangeToWire(e.range),
      selectionRange: symbolRangeToWire(e.selectionRange),
      children: e.children?.map(toWire),
      data: { id: e.id, evidenceTier: tier, notIndexed },
    })
    return r.symbols.map(toWire)
  })

  server.register("workspace/symbol", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = workspaceSymbols(raw, {
      query: params?.query ?? "",
      limit: params?.limit,
    })
    // Wire: SymbolInformation[] (flat). Each carries the index-resolved line
    // (zero-width range); absence is an empty array, never a fabricated hit.
    return r.symbols.map((s) => ({
      name: s.name,
      kind: symbolKindFor(s.symbolType),
      containerName: s.qualifiedName ?? undefined,
      location: {
        uri: `file://${s.path}`,
        range: {
          start: { line: s.line, character: 0 },
          end: { line: s.line, character: 0 },
        },
      },
    }))
  })

  server.register("textDocument/prepareCallHierarchy", async (params: any) => {
    // M55.T2: a malformed request is a declared client error, never a
    // silently-defaulted position that answers about the wrong symbol.
    const p = requireObject(params, "params")
    const doc = requireObject(p.textDocument, "params.textDocument")
    if (typeof doc.uri !== "string" || doc.uri.length === 0) {
      throw new DeclaredParamsError("bb/callHierarchy: params.textDocument.uri must be a non-empty string")
    }
    const pos = requireObject(p.position, "params.position")
    if (typeof pos.line !== "number" || typeof pos.character !== "number") {
      throw new DeclaredParamsError("bb/callHierarchy: params.position must carry numeric line and character")
    }
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await prepareCallHierarchy(raw, {
      filePath: uriToPath(doc.uri as string),
      line: pos.line as number,
      character: pos.character as number,
    })
    // Wire: CallHierarchyItem[] | null. The item's `data` (symbolId) is what
    // expand requests echo back — the client converter preserves it.
    return r.item === null ? null : [r.item]
  })

  server.register("callHierarchy/incomingCalls", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await expandCalls(raw, projectId, {
      item: requireCallHierarchyItem(params),
      direction: "incoming",
    })
    // Wire: CallHierarchyIncomingCall[] (plain array; the envelope's
    // truncation metadata stays at the component layer).
    return r.calls as CallHierarchyIncomingCall[]
  })

  server.register("callHierarchy/outgoingCalls", async (params: any) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const r = await expandCalls(raw, projectId, {
      item: requireCallHierarchyItem(params),
      direction: "outgoing",
    })
    return r.calls as CallHierarchyOutgoingCall[]
  })
}

// ---------------------------------------------------------------------------
// M55.T2: request validation for the call-hierarchy surface. A missing or
// malformed item is the CLIENT's error and is answered as InvalidParams with
// the exact field named — an unhandled property read is a defect, not a
// message.
// ---------------------------------------------------------------------------

function requireObject(value: unknown, what: string, shape?: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    // The reason names the field AND (when the door knows it) the shape the
    // client must send, so a malformed expand teaches the contract instead of
    // only rejecting it (M55.T2).
    throw new DeclaredParamsError(
      `bb/callHierarchy: ${what} must be an object${shape === undefined ? "" : ` carrying { ${shape} }`}`,
    )
  }
  return value as Record<string, unknown>
}

/** The item echoed back by the client on expand, validated field by field. */
function requireCallHierarchyItem(params: unknown): CallHierarchyItem {
  const p = requireObject(params, "params")
  const item = requireObject(p.item, "params.item", "symbolId: string, isExternal: boolean")
  const data = requireObject(item.data, "params.item.data", "symbolId: string, isExternal: boolean")
  if (typeof data.symbolId !== "string" || data.symbolId.length === 0) {
    throw new DeclaredParamsError("bb/callHierarchy: params.item.data.symbolId must be a non-empty string")
  }
  if (typeof data.isExternal !== "boolean") {
    throw new DeclaredParamsError("bb/callHierarchy: params.item.data.isExternal must be a boolean")
  }
  return item as unknown as CallHierarchyItem
}

/** Wire helper: a NavigationLocation (component) -> LSP Location. */
function navLocationToWire(loc: { path: string; line: number; character: number; endLine: number; endCharacter: number }): unknown {
  return {
    uri: `file://${loc.path}`,
    range: {
      start: { line: loc.line, character: loc.character },
      end: { line: loc.endLine, character: loc.endCharacter },
    },
  }
}

/** Wire helper: a component SymbolRange -> LSP Range. */
function symbolRangeToWire(r: { line: number; character: number; endLine: number; endCharacter: number }): unknown {
  return {
    start: { line: r.line, character: r.character },
    end: { line: r.endLine, character: r.endCharacter },
  }
}

// Self-execution: node dist/lsp/server.js --dir <ws> (also bun src/lsp/server.ts).
// Detects being run as the entry regardless of runtime.
const isMain =
  typeof (globalThis as any).Bun !== "undefined"
    ? (import.meta as any).main === true
    : process.argv[1] !== undefined &&
      // Windows argv[1] uses backslashes (…\dist\lsp\server.js) — normalize
      // so the entry check is separator-independent (found by the E7 win32
      // CI leg: the server silently exited 0 without starting, 2026-09-05).
      (process.argv[1].replace(/\\/g, "/").endsWith("lsp/server.js") ||
        process.argv[1].replace(/\\/g, "/").endsWith("lsp/server.ts"))

if (isMain) {
  const dirIdx = process.argv.indexOf("--dir")
  const root = dirIdx !== -1 ? process.argv[dirIdx + 1] : process.cwd()
  // Test-only crash trace: the extension host drops server stderr (no output
  // channel configured), so the editor leg cannot see WHY a server died.
  // When BB_LSP_STDERR_LOG is set, fatal errors append to that file.
  if (process.env.BB_LSP_STDERR_LOG) {
    const trace = (what: string, err: unknown) => {
      try {
        appendFileSync(process.env.BB_LSP_STDERR_LOG as string, `[${new Date().toISOString()}] ${what}: ${(err as Error)?.stack ?? String(err)}\n`)
      } catch {}
    }
    process.on("uncaughtException", (e) => trace("uncaughtException", e))
    process.on("unhandledRejection", (e) => trace("unhandledRejection", e))
  }
  const server = createServer(root)
  wireFeatures(server)
  server.run().catch((error: any) => {
    console.error("bb_lsp failed:", error?.message ?? String(error))
    if (process.env.BB_LSP_STDERR_LOG) {
      try {
        appendFileSync(process.env.BB_LSP_STDERR_LOG, `[${new Date().toISOString()}] run-failed: ${(error as Error)?.stack ?? String(error)}\n`)
      } catch {}
    }
    process.exit(1)
  })
}
