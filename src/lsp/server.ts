// src/lsp/server.ts — M24.L1: bb_lsp server skeleton.
//
// A standalone LSP 3.18 server over stdio. This module owns the protocol
// layer: lifecycle (initialize/initialized/shutdown/exit), capabilities
// advertisement, and project resolution. Feature handlers (hover, definition,
// references, document highlight, symbols, call hierarchy, and the bb/
// honesty transports) register in `wireFeatures` below.
//
// Declared guarantees (gated by script/m24/verify-server.ts):
//   lifecycle:     initialize → initialized → shutdown → exit honored;
//                  requests before initialize rejected with -32002; requests
//                  after shutdown rejected with -32600
//   capabilities:  the advertised key set is derived from the LIVE handler set
//                  (a key appears only when every method it requires is
//                  registered), and CAPABILITY_COVERAGE below is the exhaustive
//                  method → key declaration the gate enforces in both
//                  directions — IDE Honesty Contract §2 (advertisement must
//                  match registration exactly)
//   transport:     JSON-RPC 2.0 with Content-Length framing over stdio
//   project:       workspace root canonicalized with realpath(3) BEFORE the
//                  project id is derived, so identity is sha1-of-realpath
//                  (src/cli/index.ts) and not sha1-of-whatever-path-was-typed
//   index guard:   unindexed workspace → every request gets actionable
//                  guidance (mirrors the MCP index guard), never a crash
//   languages:     requests for files in non-launch languages receive
//                  declared-absent responses, never a crash
//
// Declared limitations (per contract §1):
//   - single-root workspaces only; advertised as `workspace.workspaceFolders
//     .supported: false` so a client learns it from the wire instead of
//     discovering it (contract §11.6)
//   - no completion, no diagnostics, no rename (complement stance, §7)
//   - NO textDocumentSync is advertised, and that is the truthful state: this
//     server registers no `textDocument/did*` handler, so a client that sent
//     document sync would be sending into a void. The declared sync model is
//     filesystem-side, not client-side — `src/lsp/freshness.ts` runs a
//     recursive fs.watch, debounces 300 ms (DEBOUNCE_MS), and runs the
//     incremental reindex itself; a watcher failure degrades to scan-on-read
//     rather than to silent staleness (contract §4.2).
//
// Run: npx tsx src/lsp/server.ts --dir <workspace-root>
//      (also runs from compiled dist: node dist/lsp/server.js --dir <path>)

import path from "node:path"
import { realpathSync, appendFileSync } from "node:fs"
import { getProjectId } from "../util/project-id"
import { documentHighlight } from "./document_highlight"
import { PositionError } from "./positions"
import { BACKBENCHER_BRAIN_VERSION } from "../version"

/** The launch set, its membership test, and the path→language map live in
 *  the single-owner module (M29.R2: one owner; the set was duplicated here
 *  and in hover.ts — a drift hazard the wave found). */
import { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath } from "./launch_languages"
export { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath }

/** How a capability key reaches the initialize result. */
export type CapabilityKind =
  /** Emitted only when EVERY method in `methods` is registered on the server. */
  | "handler"
  /**
   * An unconditional DECLARATION of a server constant — it states something
   * that is true whether or not a handler exists, so deriving it from handlers
   * would be wrong. `workspace` (workspaceFolders.supported: false, contract
   * §11.6 single-root) is the only one. Its payload is gated separately, and
   * an entry here whose truth depends on a handler is a defect.
   */
  | "static"

export interface CapabilityCoverage {
  /** the initialize-result capability key this entry governs */
  key: string
  /** the LSP methods the key is served by (empty for a `static` declaration) */
  methods: string[]
  kind: CapabilityKind
  /**
   * The advertised payload for a `handler` entry. A factory, not a constant,
   * so the schema versions named here cannot drift from the components that
   * enforce them on inbound requests.
   */
  value?: () => unknown
}

/** Schema version bb/staleness answers with. bb/staleness has no version
 *  constant of its own in `freshness.ts` (it is a marker, not a request
 *  envelope), so the wire contract is declared HERE and gated against the real
 *  handler's response shape by script/m24/verify-server.ts (G7). Bump this and
 *  the gate fails until the handler agrees. */
export const STALENESS_SCHEMA_VERSION = 1

/** The advertised bb/staleness payload. The response shape IS the contract:
 *  `StaleMarker` from src/lsp/freshness.ts. Advertising it lets a client
 *  render the stale marker without having read our source, and G7 asserts the
 *  LIVE handler answers exactly these fields — so this description cannot
 *  describe a shape the handler stopped producing. */
export function stalenessProviderPayload(): Record<string, unknown> {
  return {
    schemaVersion: STALENESS_SCHEMA_VERSION,
    marker: {
      stale: "boolean",
      status: ["fresh", "stale", "missing", "unknown"],
      pendingReindex: "boolean",
    },
    /** The declared sync model (contract §4.2): filesystem-side, debounced by
     *  DEBOUNCE_MS in src/lsp/freshness.ts, with a scan-on-read fallback when
     *  the watcher fails. No latency figure is advertised — this gate measures
     *  none, and an unmeasured budget presented as a budget is a §1 claim
     *  violation. */
    syncModel: {
      source: "filesystem-watch",
      debounceMs: 300,
      fallback: "scan-on-read",
      clientDocumentSync: false,
    },
  }
}

/** The advertised bb/impact payload. The version number is copied from the
 *  module that ENFORCES it (IMPACT_SCHEMA_VERSION in ./impact_request) rather
 *  than imported: those transports load via `await import(...)` inside their
 *  handlers so the graph engine never enters the startup module graph (contract
 *  §7.3 activation budget). The copy is therefore gated, not trusted — G7 fails
 *  if this number stops matching the owner's constant. */
export function impactProviderPayload(): Record<string, unknown> {
  return { schemaVersion: 1 }
}

/** The declared-absence channel advertisement. One factory, read by both
 *  `capabilities()` and CAPABILITY_COVERAGE, so the advertised shape and the
 *  emitted record cannot drift (G11 gates that they agree). */
export function absenceProviderPayload(): Record<string, unknown> {
  return {
    schemaVersion: ABSENCE_SCHEMA_VERSION,
    method: ABSENCE_METHOD,
    direction: "serverToClient",
    carriers: [ABSENCE_METHOD, "window/logMessage"],
    /** The reason vocabulary, advertised so a client renders known reasons
     *  correctly instead of string-matching on prose. */
    reasons: ["language_not_launched", "not_indexed", "unresolvable_location", "unsupported_language"],
    /** What a client is being told, stated plainly: an EMPTY standard result
     *  on these methods is not evidence that nothing exists. */
    emptyResultMeans: "absent-or-unserved — not 'nothing found'; read the bb/absence notice for which",
  }
}

/** The declared `workspace` capability: a server CONSTANT, not a
 *  handler-derived fact. Single-root only (contract §11.6), declared on the
 *  wire so a client learns it from the initialize result instead of inferring
 *  it from a request that never answers. */
export function workspaceProviderPayload(): Record<string, unknown> {
  return { workspaceFolders: { supported: false, changeNotifications: false } }
}

/**
 * The exhaustive method → capability-key law (contract §2: advertisement must
 * reflect reality exactly, in both directions).
 *
 * WHY A TABLE AND NOT A COMMENT — the defect this replaces: this file used to
 * export `IMPLEMENTED_METHODS: string[] = []` under the comment "the
 * capabilities advertisement is derived from this table so the two can never
 * drift apart … today the set is empty by design". Every clause was false. The
 * set was empty while twelve handlers were registered; `capabilities()`
 * derived from `this.handlers`, never from that export; and the export had zero
 * consumers repo-wide. That is a stale exported lie, and a comment asserting a
 * guarantee the code does not provide is worse than no comment at all (contract
 * §1, §8.7). The export is deleted — a handler set is per-instance, so the
 * honest form of that constant is `BbLspServer.implementedMethods()`. The law
 * the comment described now lives here, and "can never drift" is a GATE in
 * script/m24/verify-server.ts rather than a sentence in a comment:
 *   - a registered handler with no entry here                  → FAIL
 *   - an advertised key that is not in here                     → FAIL
 *   - an entry whose methods are only partly registered while its
 *     key is advertised (or all registered while it is not)    → FAIL
 *   - a wired server whose advertisement is missing bb/staleness or
 *     bb/impact (the reachability half of the original defect) → FAIL
 *
 * WHY `capabilities()` IS NOT A LOOP OVER THIS TABLE: the per-key guards in
 * `capabilities()` are the emission site, and
 * `script/m26/verify-graph-transport.ts` plants its M5 mutant ("advertisement
 * gone") on the literal source line
 * `if (this.handlers.has("bb/graph")) caps.graphProvider = { schemaVersion: 2 }`.
 * Replacing that line with a table lookup would leave m26 printing "SKIP
 * (anchor not found)" — a silently skipped gate, which contract §8.3 counts as
 * a failure — so the line stays verbatim until that lane re-anchors. The
 * duplication is therefore deliberate, and machine-enforced from both sides by
 * G6, rather than removed and left ungated.
 */
export const CAPABILITY_COVERAGE: readonly CapabilityCoverage[] = [
  { key: "hoverProvider", methods: ["textDocument/hover"], kind: "handler", value: () => true },
  { key: "definitionProvider", methods: ["textDocument/definition"], kind: "handler", value: () => true },
  { key: "referencesProvider", methods: ["textDocument/references"], kind: "handler", value: () => true },
  {
    key: "documentHighlightProvider",
    methods: ["textDocument/documentHighlight"],
    kind: "handler",
    value: () => true,
  },
  { key: "documentSymbolProvider", methods: ["textDocument/documentSymbol"], kind: "handler", value: () => true },
  { key: "workspaceSymbolProvider", methods: ["workspace/symbol"], kind: "handler", value: () => true },
  {
    key: "callHierarchyProvider",
    methods: [
      "textDocument/prepareCallHierarchy",
      "callHierarchy/incomingCalls",
      "callHierarchy/outgoingCalls",
    ],
    kind: "handler",
    value: () => true,
  },
  { key: "graphProvider", methods: ["bb/graph"], kind: "handler", value: () => ({ schemaVersion: 2 }) },
  {
    key: "stalenessProvider",
    methods: ["bb/staleness"],
    kind: "handler",
    value: stalenessProviderPayload,
  },
  {
    key: "impactProvider",
    methods: ["bb/impact"],
    kind: "handler",
    value: impactProviderPayload,
  },
  {
    key: "workspace",
    methods: [],
    kind: "static",
    value: workspaceProviderPayload,
  },
  {
    /**
     * The declared-absence channel. `kind: "static"` because it describes a
     * SERVER-TO-CLIENT notification, not a request handler: it is offered
     * whenever the server is running, and there is deliberately no inbound
     * `bb/absence` handler to advertise (G10 asserts an inbound request gets
     * MethodNotFound). `direction` is stated so a client cannot build a
     * request around it.
     */
    key: "absenceProvider",
    methods: [],
    kind: "static",
    value: absenceProviderPayload,
  },
]

/** The capability key a given LSP method is advertised under (or undefined when
 *  the method is not part of the declared surface). The gate and the mutation
 *  suite both read the answer from here — never from a second inline list. */
export function capabilityKeyForMethod(method: string): string | undefined {
  return CAPABILITY_COVERAGE.find((e) => e.methods.includes(method))?.key
}

/** JSON-RPC / LSP error codes used by the lifecycle. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
} as const

/** The language a request names, read from the standard
 *  `textDocument.uri`/`workspace/symbol` shapes, or null. Used only to LABEL a
 *  declared absence — never to decide behaviour, so a client that sends an
 *  unusual shape still gets an answer (just an unlabelled one). */
function languageForMessage(params: any): string | null {
  const uri: unknown = params?.textDocument?.uri
  if (typeof uri !== "string" || uri.length === 0) return null
  return languageForPath(uriToPath(uri))
}

/**
 * The message `ASTEngine.parseTree` throws when `detectLanguage` returns null
 * (src/ast/engine.ts, the throw lane 2 hit live). Named here as ONE constant
 * because the seam's foreign-error arm is the only coupling between the LSP
 * transport and the analyzer's error TEXT, and a coupling that lives in one
 * named place can be drift-gated. It is: script/m24/verify-server.ts asserts
 * this constant still prefixes the message engine.ts actually throws, and turns
 * RED the day it does not. Before that gate existed, this was a string literal
 * buried in a boolean expression with a prose limitation describing the risk —
 * which is a comment, and a gate that reads a comment cannot fail.
 */
const ASTENGINE_UNROUTABLE_PREFIX = "Unsupported file type"

/**
 * Classify a fault raised inside an `absentable` handler as unroutability, or
 * as not-unroutable. Returns the DECLARED TYPE (`DocumentUnroutable | null`)
 * rather than a boolean, so the seam's decision is a type test on the one
 * place the type is produced, and a future handler that KNOWS its document is
 * unroutable can raise the type directly instead of relying on a message.
 *
 * Two arms, and the distinction between them is the whole point:
 *
 *   1. `error instanceof DocumentUnroutable` — the TYPED path. A component that
 *      knows the answer raises the declared type. This arm cannot be broken by
 *      a reword in engine.ts, and it is the arm every new handler should use.
 *
 *   2. the engine's own message prefix — the BACKSTOP, for a handler whose
 *      guard was forgotten. This arm exists because the alternative is a
 *      user-visible -32603 on a file the server simply does not serve, which
 *      contract §11.7 calls a violation. It cannot be typed: a plain
 *      `Error("…")` from a dependency carries no type to test. Its one known
 *      weakness — coupling to a foreign message — is drift-gated by the check
 *      named on `ASTENGINE_UNROUTABLE_PREFIX` above.
 *
 * A fault that is NEITHER is a bug (TypeError, null dereference, parser
 * timeout) and returns null, so the dispatch catch keeps its -32603.
 */
export function asDocumentUnroutable(error: unknown): DocumentUnroutable | null {
  if (error instanceof DocumentUnroutable) return error
  if (error instanceof Error && typeof error.message === "string" && error.message.startsWith(ASTENGINE_UNROUTABLE_PREFIX)) {
    // Translate the foreign Error into the DECLARED type here, so everything
    // downstream of this function is a type test and nothing else has to know
    // that engine.ts phrases its throw the way it does.
    return new DocumentUnroutable(error.message)
  }
  return null
}

/**
 * The unroutability seam at the REGISTRATION boundary, so a fourth handler
 * repeating lane 2's defect is stopped structurally rather than by convention.
 *
 * The problem lane 2 hit: `parseForSafety` → `ASTEngine.parseTree` throws when
 * `detectLanguage` returns null, and the call site must guard it. Fixing one
 * call site fixes ONE handler; the next one that forgets reproduces it, and the
 * user gets -32603. Guarding at the seam means a handler does not have to
 * remember.
 *
 * Why a WRAPPER rather than a catch: the seam only knows a file is unroutable
 * by looking at the request's URI, and it can only do that for the standard
 * `textDocument.uri` shape. It must NOT pre-answer on that basis alone —
 * `workspace/symbol` and the `bb/` transports legitimately carry no URI, and a
 * handler given no document may still have real work to do. So the wrapper
 * LAUNCHES the handler, and only converts a fault `asDocumentUnroutable`
 * recognises. Everything else propagates untouched to the dispatch catch, which
 * keeps its -32603. A seam that pre-answered would also swallow genuine faults
 * in routable files, which is the dishonesty this design exists to avoid.
 */
function guardUnroutableDocument(
  method: string,
  handler: (params: any) => unknown,
): (params: any) => unknown {
  return async (params: any) => {
    const uri: unknown = params?.textDocument?.uri
    const hasDocument = typeof uri === "string" && uri.length > 0
    try {
      return await handler(params)
    } catch (error: any) {
      // Recognised unroutability ONLY, by the declared type (see
      // asDocumentUnroutable). Anything else is rethrown for the dispatch
      // catch to classify — a TypeError here must stay a -32603, never an
      // absence.
      if (asDocumentUnroutable(error) === null) throw error
      throw new DeclaredAbsenceThrow({
        method,
        reason: "language_not_launched",
        language: hasDocument ? languageForMessage(params) : null,
        detail:
          "this file's type is outside the analyzer's routed set, so it was never routed and the index was not searched",
        evidenceTier: "unsupported_language",
        searchedIndex: false,
        totalCount: null,
      })
    }
  }
}

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

// ---------------------------------------------------------------------------
// Declared absence: the reason a request was not answered, computed by the
// component and CARRIED TO THE CLIENT instead of discarded (contract §11.7).
// ---------------------------------------------------------------------------

/** Wire version of the `bb/absence` notice. A client that gates on this number
 *  can tell a future shape from the current one; it is advertised as
 *  `absenceProvider.schemaVersion` so a client never has to guess. */
export const ABSENCE_SCHEMA_VERSION = 1

/** Server→client absence channel. NOT a request method: there is no inbound
 *  `bb/absence` handler, and sending one answers MethodNotFound (G10). The
 *  advertisement says `direction: "serverToClient"` so a client does not build
 *  a request around it. */
export const ABSENCE_METHOD = "bb/absence"

/** The LSP MessageType for `window/logMessage`. 3 = Info. A declared absence is
 *  the contract working, not a fault: using Error (1) would train the user to
 *  ignore the channel, and Warning (2) would overstate it. */
export const ABSENCE_LOG_TYPE = 3

/**
 * WHY THIS REASON SET. The vocabulary is the union of what the components can
 * already prove, plus one the seam adds:
 *   language_not_launched    the file is outside the launch set. The index was
 *                            NEVER searched — `searchedIndex: false`. Distinct
 *                            from everything below because "we do not serve your
 *                            language" and "we looked and found nothing" are
 *                            different facts, and a client that cannot tell them
 *                            apart cannot label either honestly.
 *   not_indexed              the index WAS searched and stores nothing here.
 *   unresolvable_location    the request named a position or location that does
 *                            not resolve — e.g. out of range (contract §13.10,
 *                            PositionError).
 *   unsupported_language     the request is well formed but the analyzer cannot
 *                            serve this language at all.
 * Adding a reason is cheap; adding one that overlaps an existing reason is a
 * defect, because it reintroduces the conflation G9b gates.
 */
export type AbsenceReason =
  | "language_not_launched"
  | "not_indexed"
  | "unresolvable_location"
  | "unsupported_language"

export interface DeclaredAbsence {
  /** The method whose answer is being declared absent. */
  method: string
  /** Which fact, from the set above. Never a bare null. */
  reason: AbsenceReason
  /** The detected language, when one could be determined; else null. */
  language: string | null
  /** Human-readable sentence. Never an empty string and never a JSON blob:
   *  contract §15.4 forbids machine shapes in anything a developer reads. */
  detail: string
  /** evidenceTier when the component computed one, else null. */
  evidenceTier: string | null
  /** FALSE when the index was never searched (language_not_launched) — the
   *  field that separates "never searched" from "searched, nothing there". */
  searchedIndex: boolean
  /** Match count when the index was searched, else null. */
  totalCount: number | null
}

/**
 * A component that CANNOT answer, distinguished by construction from a
 * component that is BROKEN.
 *
 * THE BOUNDARY, AND WHY IT IS DRAWN HERE. The seam must not be a blanket
 * catch: turning every fault into declared absence is the same dishonesty with
 * a friendlier face, because the client would render "nothing here" while the
 * server is in fact broken. So the conversion is OPT-IN per handler — a handler
 * declares itself answerable-or-absentable — and it still fires only for the
 * error TYPES below, each of which is a declared, expected inability:
 *
 *   PositionError      out-of-range / mid-codepoint positions (§13.10 names a
 *                       wire error here a defect)
 *   DeclaredAbsenceThrow  a component computed an absence and raised it (the
 *                       shape the read handlers use)
 *   DocumentUnroutable  the file cannot be parsed because its type is outside
 *                       the analyzer's routed set — lane 2's live defect, whose
 *                       call-site fix does not stop a FOURTH handler repeating it
 *
 * Anything else — a TypeError, a null dereference, a parser timeout — is a bug
 * and stays -32603. G10 gates both directions, and the "stays -32603" checks
 * are what stop the seam from widening into a blanket catch.
 */
export class DocumentUnroutable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DocumentUnroutable"
  }
}

/** A component raising this answers with `null` AND emits the absence notice. */
export class DeclaredAbsenceThrow extends Error {
  readonly absence: DeclaredAbsence
  constructor(absence: DeclaredAbsence) {
    super(absence.detail)
    this.name = "DeclaredAbsenceThrow"
    this.absence = absence
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

/** A server→client JSON-RPC notification queued for the wire. */
export interface ServerNotification {
  jsonrpc: typeof JSONRPC
  method: string
  params: unknown
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
  /** Methods opted into the declared-absence seam (see register). */
  private absentableMethods = new Set<string>()
  /**
   * Server→client notifications produced by the most recent handleMessage
   * call, drained by the wire loop. Queueing them here (rather than writing
   * straight to the stream) keeps handleMessage pure and testable, and is what
   * lets the verifier assert on EXACTLY what a client would receive.
   */
  private outboundNotifications: ServerNotification[] = []
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

  /** Register a feature handler. Capabilities derive from this table.
   *
   *  `absentable: true` opts the method into the declared-absence seam: a
   *  component fault of a DECLARED type (PositionError, DeclaredAbsenceThrow,
   *  DocumentUnroutable) then answers as declared absence with a reason the
   *  client can read, instead of -32603. The opt-in is per method and
   *  deliberate: a blanket catch over all handlers would let a genuine bug
   *  render as "nothing here", and G10 gates exactly that regression. */
  register(method: string, handler: (params: any) => unknown, opts: { absentable?: boolean } = {}): void {
    this.handlers.set(method, opts.absentable ? guardUnroutableDocument(method, handler) : handler)
    if (opts.absentable) this.absentableMethods.add(method)
  }

  /** The LSP methods this instance can actually serve — the honest successor
   *  to the deleted `IMPLEMENTED_METHODS` export, which was a frozen empty
   *  array while twelve handlers were registered. Handler set is per-instance
   *  (it is whatever `register`/`wireFeatures` put there), so the truth is an
   *  instance read, not a module constant. */
  implementedMethods(): string[] {
    return [...this.handlers.keys()].sort()
  }

  /** Capabilities advertised in the initialize result — derived from the
   *  registered handler set so advertisement can never outrun reality, and
   *  cross-checked against CAPABILITY_COVERAGE by script/m24/verify-server.ts
   *  (G6) in both directions.
   *
   *  The three additions below are the ones a client could not previously
   *  discover:
   *    - stalenessProvider / impactProvider: bb/staleness and bb/impact were
   *      registered but had NO capability key, so a client could only reach
   *      them blind. LSP 3.18 has no standard `impactProvider`, and the
   *      `bb/` namespace is private honesty plumbing rather than a standard
   *      provider, so these ride top-level keys exactly as bb/graph already
   *      did (`graphProvider`) — with the schemaVersion the handler ENFORCES
   *      on inbound requests, so a client can detect a version mismatch before
   *      it sends one. The G6 table makes their absence a gate failure.
   *    - workspace: the single-root limitation is a server CONSTANT, not a
   *      handler-derived fact, so it is declared unconditionally. Advertising
   *      `workspaceFolders.supported: false` is how a client learns it from the
   *      wire (contract §11.6) instead of inferring it from a hang.
   *  What is deliberately NOT here: `textDocumentSync`. This server registers
   *  no `textDocument/did*` handler, so advertising a sync kind would tell the
   *  client to send notifications into a void — a capability we do not
   *  implement, which contract §2 calls a gate failure. The sync model is
   *  filesystem-side (see the file header) and is advertised, truthfully, as
   *  `stalenessProvider.syncModel`. G8 pins the absence so a future edit that
   *  advertises a sync kind without a did* handler fails the gate. */
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
    if (this.handlers.has("bb/staleness")) caps.stalenessProvider = stalenessProviderPayload()
    if (this.handlers.has("bb/impact")) caps.impactProvider = impactProviderPayload()
    caps.absenceProvider = absenceProviderPayload()
    caps.workspace = workspaceProviderPayload()
    return caps
  }

  state(): string {
    return this.lifecycleState
  }

  /** The server→client notifications queued by the last handleMessage call.
   *  Read-only: a test may inspect them, and the wire loop still drains the
   *  same queue, so what the test asserts on is byte-for-byte what a client
   *  receives. */
  notifications(): ServerNotification[] {
    return [...this.outboundNotifications]
  }

  /** Take the queued notifications, leaving the queue empty. */
  private drainNotifications(): ServerNotification[] {
    const queued = this.outboundNotifications
    this.outboundNotifications = []
    return queued
  }

  /** Queue a server→client notification. Every notification this server emits
   *  goes through here so the carriers cannot drift: `bb/absence` for the
   *  machine-readable record and `window/logMessage` for the human line are
   *  emitted as ONE unit from `emitAbsence`, never separately. */
  private notify(method: string, params: unknown): void {
    this.outboundNotifications.push({ jsonrpc: JSONRPC, method, params })
  }

  /**
   * Announce a declared absence on BOTH carriers, from one call, so they cannot
   * disagree:
   *   - `bb/absence` (versioned, machine-readable; what a client should read)
   *   - `window/logMessage` (the protocol's own channel; reaches a client that
   *     has never heard of bb/*)
   * Emitted ONLY on the absence path — never on a served request (G9's negative
   * case gates that; logging every successful hover would be noise the user
   * learns to ignore, which is how a warning channel dies).
   */
  private emitAbsence(absence: DeclaredAbsence): void {
    this.notify(ABSENCE_METHOD, { schemaVersion: ABSENCE_SCHEMA_VERSION, ...absence })
    this.notify("window/logMessage", {
      type: ABSENCE_LOG_TYPE,
      // Named by method so the log line is actionable on its own: a user who
      // only sees this in an output panel learns WHICH request was not
      // answered, and why.
      message: `bb ${absence.method}: declared absence (${absence.reason}) — ${absence.detail}`,
    })
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
      // Each request starts with an empty outbox: a notice belongs to the
      // request that caused it, never to whatever ran before it.
      this.outboundNotifications = []
      try {
        const result = await handler(message.params)
        this.record("out", method)
        return { jsonrpc: JSONRPC, id: message.id, result }
      } catch (error: any) {
        // THE BOUNDARY between "cannot answer" and "is broken". Read in order,
        // narrowest reason first, and every branch names what it decides:
        //   1. DeclaredParamsError — the CLIENT sent something malformed. Theirs
        //      to fix; InvalidParams with the offending field named.
        //   2. DeclaredAbsenceThrow — the component computed an absence and
        //      raised it. Answer the protocol's honest empty shape AND emit the
        //      reason, so "nothing here" is distinguishable from "not served".
        //   3. PositionError — an out-of-range position (§13.10: a wire error
        //      where the contract requires honest emptiness is a defect).
        //   4. DocumentUnroutable — the file's type is outside the analyzer's
        //      routed set, so there was never an answer to give.
        // Branches 2-4 fire ONLY for methods that opted in with
        // `{ absentable: true }`, and only for these TYPES. Everything else —
        // TypeError, null dereference, parser timeout — is a BUG and stays
        // -32603, because reporting a broken server as "nothing here" is a lie
        // the user cannot detect. G10 gates both directions.
        if (error instanceof DeclaredParamsError) {
          this.record("out", method, ErrorCodes.InvalidParams)
          return this.errorResponse(message.id, ErrorCodes.InvalidParams, error.message)
        }
        const absentable = this.absentableMethods.has(method)
        if (absentable && error instanceof DeclaredAbsenceThrow) {
          this.emitAbsence(error.absence)
          this.record("out", method)
          return { jsonrpc: JSONRPC, id: message.id, result: null }
        }
        if (absentable && error instanceof PositionError) {
          this.emitAbsence({
            method,
            reason: "unresolvable_location",
            language: languageForMessage(message.params),
            detail: `${error.message} — the position does not resolve, so there is no answer to give (contract §13.10)`,
            evidenceTier: null,
            searchedIndex: false,
            totalCount: null,
          })
          this.record("out", method)
          return { jsonrpc: JSONRPC, id: message.id, result: null }
        }
        if (absentable && error instanceof DocumentUnroutable) {
          this.emitAbsence({
            method,
            reason: "language_not_launched",
            language: null,
            detail: `${error.message} — this file type is outside the analyzer's routed set, so the index was never searched`,
            evidenceTier: null,
            searchedIndex: false,
            totalCount: null,
          })
          this.record("out", method)
          return { jsonrpc: JSONRPC, id: message.id, result: null }
        }
        // A genuine unexpected fault. Reported as an internal error, never
        // dressed up as an absence (G10 gates this).
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

    // Server→client notifications (the declared-absence carrier) are written
    // AFTER the response that caused them, so a client reading the stream in
    // order sees the answer first and the reason attached to it. Each is
    // independently framed: one notification is one message on the wire, not a
    // concatenated blob.
    const writeNotification = (notification: ServerNotification): void => {
      const body = Buffer.from(JSON.stringify(notification), "utf8")
      output.write(`Content-Length: ${body.length}\r\n\r\n`)
      output.write(body)
    }
    const drainNotifications = (): void => {
      for (const notification of this.drainNotifications()) writeNotification(notification)
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
            void this.dispatch(body.toString("utf8"), writeMessage, finish, drainNotifications)
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
    drainNotifications: () => void,
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
      drainNotifications()
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


  // Every read handler below is registered `absentable: true`: a component
  // that CANNOT answer (unroutable file, out-of-range position) degrades to a
  // declared absence with a reason, instead of leaking -32603 to the editor.
  // The opt-in is per method so the seam can never widen into a blanket catch
  // over handlers that must stay loud (G10).
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
    //
    // ABSENCE IS DECLARED, NOT DISCARDED (contract §11.7). The wire shape is
    // still a bare `null` — LSP 3.18 has nowhere in `Hover | null` to carry a
    // reason, and inventing a field on a standard result is banned — so the
    // reason travels on the `bb/absence` carrier instead. `provenance.limitations`
    // is the component's own sentence about WHY, and it is now READ here rather
    // than dropped: previously a user in an unsupported language got a silent
    // null that reads as "nothing known about this symbol".
    if (r.contents === null || r.range === null || r.data === null) {
      const limits = r.provenance?.limitations ?? []
      const notLaunched = limits.some((l) => l.includes("launch language set"))
      throw new DeclaredAbsenceThrow({
        method: "textDocument/hover",
        reason: notLaunched ? "language_not_launched" : "not_indexed",
        language: languageForMessage(params),
        // Human prose, never a JSON blob (§15.4): the component's own
        // limitation sentences, joined.
        detail:
          limits.length > 0
            ? limits.join("; ")
            : "no indexed symbol at this position (the index was searched and stores nothing here)",
        evidenceTier: r.provenance?.evidenceClass ?? null,
        // A launch-language miss means the index WAS asked. A non-launch file
        // means it never was — the distinction that lets a client label the
        // difference instead of guessing.
        searchedIndex: !notLaunched,
        totalCount: null,
      })
    }
    return {
      contents: r.contents,
      range: { start: r.range.start, end: r.range.end },
      data: { provenance: r.provenance, symbol: r.data },
    }
  }, { absentable: true })

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
    //
    // The reason travels on the `bb/absence` carrier (contract §11.7): LSP 3.18
    // mandates `Location | null` here, so there is no field on this result a
    // reason could ride. Previously `!r.found` collapsed to a silent null, and
    // a client could not tell "this server does not serve your language" from
    // "there is no definition here" — two facts that need different labels.
    if (!r.found || r.location === null) {
      throw new DeclaredAbsenceThrow(
        navigationAbsence("textDocument/definition", params, r.evidenceTier, {
          limit: r.symbol?.qualifiedName ?? r.symbol?.name ?? null,
        }),
      )
    }
    return navLocationToWire(r.location)
  }, { absentable: true })

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
    //
    // §11.7 + lane 2's finding: `evidenceTier` is NOT decoration. The component
    // now distinguishes `unsupported_language` ("the router never routed this
    // file") from `not_indexed` ("the index was asked and had nothing"), and a
    // bare `null` flattened that distinction into silence. The reason travels
    // on the `bb/absence` carrier, and the tier rides in the record so a
    // client can render it without re-deriving anything.
    if (r.highlights.length === 0) {
      const tier = r.evidenceTier
      const notLaunched = tier === "unsupported_language"
      throw new DeclaredAbsenceThrow({
        method: "textDocument/documentHighlight",
        reason: notLaunched ? "language_not_launched" : "not_indexed",
        language: languageForMessage(params),
        detail: notLaunched
          ? "this file's type is outside the analyzer's routed set, so it was never routed and the index was not searched"
          : "the index was searched and stores no occurrence of this symbol at the requested position",
        evidenceTier: tier,
        searchedIndex: !notLaunched,
        totalCount: 0,
      })
    }
    return r.highlights.map((h) => ({
      range: { start: h.start, end: h.end },
      kind: h.kind,
      data: { evidenceTier: r.evidenceTier, staleness: r.staleness, symbol: r.symbol },
    }))
  }, { absentable: true })

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
    // §11.7, and this is the sharpest instance: an empty `[]` is EXACTLY the
    // shape that "reads as 'no references found'" — so returning it bare for an
    // unsupported language told the user their symbol has no callers when the
    // truth was that the server never looked. The result stays `[]` (LSP 3.18
    // mandates `Location[]`); the reason goes out of band on `bb/absence`.
    if (r.locations.length === 0) {
      throw new DeclaredAbsenceThrow(navigationAbsence("textDocument/references", params, r.evidenceTier))
    }
    return r.locations.map(navLocationToWire)
  }, { absentable: true })

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

/**
 * Build the declared absence for a navigation read from what the component
 * actually proved — never from the mere fact that the result was empty.
 *
 * The decision order matters and is the whole point:
 *   1. If the file's language is outside the launch set, the index was NEVER
 *      searched. That is `language_not_launched` / `searchedIndex: false`, and
 *      it is a DIFFERENT fact from everything below — a client told "not
 *      indexed" for an unsupported language would be told a lie about work we
 *      never did.
 *   2. Otherwise the component reports `not_indexed`, meaning the index WAS
 *      asked and stores nothing here. `searchedIndex: true`.
 *
 * NOTE ON THE COMPONENT CONTRACT: navigation.ts at this commit exposes
 * `evidenceTier` ("indexed" | "not_indexed"), not Lane 4's richer
 * `absence: {reason, language, detail, searchedIndex, totalCount}` record —
 * that commit (04d56ab75) is not an ancestor of this branch. This helper reads
 * the fields that EXIST and derives the rest from the launch set through the
 * single owner (launch_languages.ts), so it is correct today and still correct
 * when `absence` lands: the reason vocabulary and the `searchedIndex` semantics
 * are already the ones Lane 4 publishes, and G9b gates the two cases apart.
 */
function navigationAbsence(
  method: string,
  params: any,
  evidenceTier: string,
  extra: { limit?: string | null } = {},
): DeclaredAbsence {
  const language = languageForMessage(params)
  // The launch set is the single owner of "do we serve this language", and a
  // file whose extension is not routed at all is also not launch-launched (it
  // could never be reached by any analyzer). `languageForPath` answers null
  // for an unmapped extension, which is a DIFFERENT state from "mapped to a
  // non-launch language" — both mean "not served", but naming them the same
  // would lose the distinction between "we know this language and decline" and
  // "we cannot read this file type at all".
  const notLaunched = language === null || !isLaunchLanguage(language)
  const what = extra.limit ? ` (asked for ${extra.limit})` : ""
  const which =
    language === null
      ? "this file's type is not routed by any analyzer"
      : `${language} is outside the launch-language set`
  return {
    method,
    reason: notLaunched ? "language_not_launched" : "not_indexed",
    language,
    detail: notLaunched
      ? `${which}, so the index was never searched for this position${what}`
      : `the index was searched and stores no matching symbol at this position${what}`,
    evidenceTier,
    searchedIndex: !notLaunched,
    totalCount: null,
  }
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
