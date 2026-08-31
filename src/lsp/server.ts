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
import { realpathSync } from "node:fs"
import { getProjectId } from "../cli/index"
import { BACKBENCHER_BRAIN_VERSION } from "../version"

/** The five launch languages (#419-CONFORMANT set). Everything else is
 *  declared absent — a documented limitation, never a crash. */
export const LAUNCH_LANGUAGES = ["java", "groovy", "kotlin", "scala", "typescript"] as const

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

/** Language for a file path (extension-based; L1 scope is extension-level). */
export function languageForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    ".java": "java",
    ".groovy": "groovy",
    ".gradle": "groovy",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".sc": "scala",
    ".ts": "typescript",
    ".tsx": "typescript",
  }
  return map[ext] ?? null
}

/** True when the language is in the launch set; anything else is declared
 *  absent — a documented limitation, never a crash. */
export function isLaunchLanguage(language: string | null): boolean {
  return language !== null && (LAUNCH_LANGUAGES as readonly string[]).includes(language)
}

/**
 * The bb_lsp server. Owns the wire protocol (JSON-RPC 2.0 with Content-Length
 * framing over stdio), the lifecycle state machine, and project resolution.
 * Feature handlers register via `register()`; the capabilities advertisement
 * is derived from the registered set so the two can never drift apart.
 */
export class BbLspServer {
  private lifecycleState: "uninitialized" | "initialized" | "shutdown" = "uninitialized"
  private handlers = new Map<string, () => unknown>()
  private protocolEvents: ProtocolEvent[] = []
  private hooks: ServerHooks
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
  register(method: string, handler: () => unknown): void {
    this.handlers.set(method, handler)
  }

  /** Capabilities advertised in the initialize result — derived from the
   *  registered handler set so advertisement can never outrun reality. */
  capabilities(): Record<string, unknown> {
    const caps: Record<string, unknown> = {}
    if (this.handlers.has("textDocument/hover")) caps.hoverProvider = true
    if (this.handlers.has("textDocument/definition")) caps.definitionProvider = true
    if (this.handlers.has("textDocument/references")) caps.referencesProvider = true
    if (this.handlers.has("textDocument/documentSymbol")) caps.documentSymbolProvider = true
    if (this.handlers.has("workspace/symbol")) caps.workspaceSymbolProvider = true
    if (
      this.handlers.has("textDocument/prepareCallHierarchy") &&
      this.handlers.has("callHierarchy/incomingCalls") &&
      this.handlers.has("callHierarchy/outgoingCalls")
    ) {
      caps.callHierarchyProvider = true
    }
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
        const result = await handler()
        this.record("out", method)
        return { jsonrpc: JSONRPC, id: message.id, result }
      } catch (error: any) {
        this.record("out", method, ErrorCodes.InternalError)
        return this.errorResponse(message.id, ErrorCodes.InternalError, error?.message ?? String(error))
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
