// script/m25/feature-assertions.ts — M25.V1 shared feature-assertion core.
//
// ONE library for per-feature assertions over a bb_lsp-backed editor, reused
// across VS Code (E5), forks (E6), and later milestones (M27 adapts new
// transports only). Per-editor runners implement `LspTransport` — the core
// owns everything else: assertions, warm-p95 measurement, and the in-editor
// budget gate (contract §3, unchanged — editor overhead is included in the
// measurement, because §3 budgets are what the user experiences).
//
// Declared guarantees (gated by script/m25/verify-harness-core.ts):
//   transport:  runners implement request/notify/ready only; zero editor
//               imports here — headless-verifiable by lint
//   assertions: every feature asserts real content against the fixture
//               workspace (shared with M24's harness fixture), not just
//               "no error"; honest absence is asserted where declared
//   budgets:    warm p95 per op must stay below the declared budget (§3 warm
//               numbers — the user experiences the editor stack); a missing
//               op is a violation, a miss fails the gate
//   can-fail:   weakened assertions and raised budgets are caught
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as os from "node:os"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/** The shared fixture — the exact M24 harness fixture text, EXTENDED for
 *  M44.U5 (issue #692): an explicit constructor, placed AFTER greet so every
 *  pre-U5 position (FIXTURE_HOVER_POS, the greet seeds, the highlight
 *  derivation) stays byte-stable. The constructor is the U5 member target:
 *  hover it, click Impact analysis, and the panel must RENDER (the impact
 *  resolves through the owning class) — not the declared not-in-index error. */
export const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
  constructor() {}
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`

/** Position inside greet() (0-based LSP coordinates). */
export const FIXTURE_HOVER_POS = { line: 1, character: 2 } as const

/** Fixture symbol names the assertions require. */
export const FIXTURE_SYMBOLS = { className: "Greeter", method: "greet", fn: "main" } as const

/**
 * H1 highlight expectations over the shared fixture (M42 issue #649).
 * FULLY DERIVED from FIXTURE_MAIN text — every line number is found by
 * content, never hand-picked (a hand-picked line once pointed at a line
 * where the symbol does not occur; the derived -1 exposed it instantly).
 *
 * Target: `greet` — the ONLY fixture symbol whose occurrences are
 * edge-connected per the seeded graph (rel-1: main -> greet): the
 * declaration (inside sym-greet itself) and the `g.greet()` call site
 * (inside sym-main). `Greeter` has NO stored edge from main — under the
 * semantic-containment law its call site honestly does NOT highlight.
 */
const _hlLines = FIXTURE_MAIN.split("\n")
const _hlDeclLine = _hlLines.findIndex((l) => l.includes("greet():"))
const _hlCallLine = _hlLines.findIndex((l) => l.includes("g.greet()"))
export const FIXTURE_HIGHLIGHT = {
  symbolName: "greet",
  queryLine: _hlCallLine,
  queryCharacter: (_hlLines[_hlCallLine] ?? "").indexOf("greet"),
  expectedLines: [_hlDeclLine, _hlCallLine], // declaration + the call site
} as const

// ---------------------------------------------------------------------------
// Transport contract — the ONLY thing a per-editor runner implements.
// ---------------------------------------------------------------------------

export interface LspTransport {
  /** JSON-RPC request; resolves the full response message. */
  request(method: string, params: unknown): Promise<any>
  /** JSON-RPC notification (no response). */
  notify(method: string, params: unknown): void
  /** Resolves when the transport is ready to serve requests (client started). */
  ready(): Promise<void>
  /** Dispose the transport (stop the client/server). */
  dispose(): Promise<void>
  /** Last 8KB of server stderr — machine diagnostics for evidence (M29.R3). Optional: only the stdio transport provides it. */
  stderrTail?(): string
}

// ---------------------------------------------------------------------------
// Budget gate — contract §3 warm budgets; the editor stack is INSIDE the
// measurement (V1's whole point). A missing op is a violation.
// ---------------------------------------------------------------------------

/** Declared in-editor warm budgets (ms, p95). A miss is a failed gate. */
export const IN_EDITOR_WARM_BUDGETS: Record<string, number> = {
  hover: 50,
  definition: 50,
  references: 50,
  documentSymbol: 50,
  workspaceSymbol: 150,
  prepareCallHierarchy: 100,
  callHierarchyExpand: 100,
  documentHighlight: 25, // M42 §12.7: highlight is a cursor-rest op — the tightest budget
}

export interface FeatureMeasurement {
  op: string
  p95WarmMs: number
  samples: number
  /** Median of the warm samples (M29.R3 defect localization). */
  medianWarmMs?: number
  /** Sorted raw per-sample wall times in ms (M29.R3 defect localization). */
  rawSamplesMs?: number[]
}

/** The budget gate: violations list (empty = pass). */
export function budgetViolations(measurements: FeatureMeasurement[]): string[] {
  const violations: string[] = []
  const seen = new Set<string>()
  for (const m of measurements) {
    seen.add(m.op)
    const budget = IN_EDITOR_WARM_BUDGETS[m.op]
    if (budget === undefined) {
      violations.push(`${m.op}:no-budget-declared`)
      continue
    }
    if (m.p95WarmMs >= budget) {
      violations.push(`${m.op}:${m.p95WarmMs.toFixed(1)}ms>=${budget}ms`)
    }
  }
  for (const op of Object.keys(IN_EDITOR_WARM_BUDGETS)) {
    if (!seen.has(op)) violations.push(`${op}:missing`)
  }
  return violations
}

/** Warm p95 over N samples (warm = at least one prior request, §3). */
export async function measureWarmP95(op: string, fn: () => Promise<unknown>, iterations = 40): Promise<FeatureMeasurement> {
  await fn() // warm-up request defines the warm regime
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  // Full distribution recorded (M29.R3 defect localization): a p95 alone hides
  // whether a miss is a fat tail (one slow sample class) or a uniform shift.
  const round = (ms: number): number => Math.round(ms * 100) / 100
  return {
    op,
    p95WarmMs: samples[Math.floor(samples.length * 0.95)]!,
    samples: iterations,
    medianWarmMs: round(samples[Math.floor(samples.length / 2)]!),
    rawSamplesMs: samples.map(round),
  }
}

// ---------------------------------------------------------------------------
// The feature-assertion suite — real content, honest absence.
// ---------------------------------------------------------------------------

export interface AssertionResult {
  name: string
  ok: boolean
  detail?: string
}

export interface AssertionContext {
  transport: LspTransport
  /** absolute workspace dir hosting main.ts with FIXTURE_MAIN content */
  workspaceDir: string
  /**
   * Declared mode for host-managed transports (e.g. the extension's client
   * inside VS Code): the host already performed initialize/shutdown, so the
   * suite skips the lifecycle requests (a second initialize is a server
   * error) and the HOST's activation evidence stands in for the lifecycle
   * asserts. Stdio legs (V1) always run the full lifecycle.
   */
  skipLifecycle?: boolean
}

type Assert = (name: string, ok: boolean, detail?: string) => void

/**
 * Normalize the two transport surfaces: stdio transports return the full
 * JSON-RPC message ({jsonrpc, id, result}); typed editor clients (the
 * extension's LanguageClient) return the result payload directly. The core
 * asserts the payload on both — the unwrap is declared here, not guessed at
 * per-assertion.
 */
function unwrap(msg: any): any {
  return msg !== null && typeof msg === "object" && "result" in msg && ("id" in msg || "jsonrpc" in msg) ? msg.result : msg
}

/** Run every feature assertion over the transport. Returns all results. */
export async function runFeatureAssertions(ctx: AssertionContext, assert: Assert): Promise<FeatureMeasurement[]> {
  const { transport } = ctx
  await transport.ready()

  const mainUri = `file://${path.join(ctx.workspaceDir, "main.ts")}`
  const hoverPos = FIXTURE_HOVER_POS
  const results: FeatureMeasurement[] = []

  // --- Lifecycle (L1) — full handshake on stdio legs; host-managed
  // transports (skipLifecycle) prove lifecycle via their host evidence.
  let caps: any = {}
  if (ctx.skipLifecycle !== true) {
    const init = unwrap(await transport.request("initialize", { capabilities: {} }))
    caps = init?.capabilities ?? {}
    assert("L1: initialize returns capabilities", !!init?.capabilities, JSON.stringify(init ?? null).slice(0, 200))
    assert("L1: hover capability advertised", caps.hoverProvider === true)
    assert("L1: definition capability advertised", caps.definitionProvider === true)
    assert("L1: references capability advertised", caps.referencesProvider === true)
    assert("L1: documentSymbol capability advertised", caps.documentSymbolProvider === true)
    assert("L1: workspaceSymbol capability advertised", caps.workspaceSymbolProvider === true)
    assert("L1: callHierarchy capability advertised", caps.callHierarchyProvider === true)
    transport.notify("initialized", {})
  }

  // --- Hover (L2): real content, provenance, honest absence ---
  // Two truth surfaces, both asserted: the SERVER response carries
  // machine-readable data + provenance (stdio legs); the USER-facing render
  // (what a typed editor client exposes and what the user reads) carries the
  // same facts as markdown text: symbol name, usage count, evidence tier,
  // staleness marker. The editor leg asserts the user surface; the stdio leg
  // asserts both.
  const hover = unwrap(await transport.request("textDocument/hover", { textDocument: { uri: mainUri }, position: hoverPos }))
  // Payload surfaces: the server's {contents, data, provenance}; the typed
  // editor client's converted Hover {contents:{kind,value}} (server-only
  // fields like `data` are stripped by the editor conversion — the user
  // surface carries the same facts as markdown text, asserted below).
  const hoverText = typeof hover?.contents === "string"
    ? hover.contents
    : typeof hover?.contents?.value === "string"
      ? hover.contents.value
      : ""
  assert("L2: hover renders markdown", (hover?.contents?.kind ?? "markdown") === "markdown" && hoverText.includes("greet"), JSON.stringify(hover ?? null).slice(0, 300))
  assert("L2: hover names greet", (hover?.data?.name ?? "") === FIXTURE_SYMBOLS.method || hoverText.includes("**greet**"), JSON.stringify(hover?.data ?? null))
  assert("L2: hover usage count matches fixture relationship", hover?.data?.usageCount === 1 || hoverText.includes("1 usage"))
  assert("L2: hover provenance labels bb index source", (hover?.provenance?.source ?? "") === "bb_index" || hoverText.includes("_source: bb index"))
  assert("L2: hover carries the evidence tier (honesty contract §2)", hover?.data?.tier !== undefined || hoverText.includes("evidence:"), hoverText.slice(0, 120))

  // --- Rich hover (M42.H2): connected summary + clickable links ---
  // Derived from FIXTURE_MAIN text — the fixture's one seeded edge is
  // rel-1: main -> greet, so greeting `greet` must render "called by main"
  // and an index-backed link to main's declaration (site label = file:line,
  // 1-based human line).
  const _fLines = FIXTURE_MAIN.split("\n")
  const _fMainDeclLine = _fLines.findIndex((l) => l.includes("function main")) + 1 // 1-based display
  assert("H2: rich hover renders the connected summary (called by main)", hoverText.includes("**connected**: called by"), hoverText.slice(0, 220))
  assert(
    "H2: usage link is clickable with an index-backed file:line target",
    hoverText.includes(`[main — main.ts:${_fMainDeclLine}](command:bb.openUsage?`),
    hoverText.slice(0, 300),
  )
  assert("H2: definition footnote is a link (bb.openDefinition)", hoverText.includes("bb.openDefinition?"), hoverText.slice(0, 200))
  assert("H2: no show-all-usages link for a single-usage symbol", !hoverText.includes("bb.showAllUsages"), "single usage needs no N-more escape hatch")

  // --- Enrichment on hover (M42.H3, issue #651) ---
  // The seeded rel-1 carries a REAL enrichment record (see buildFixtureWorkspace):
  // role consumer · layer core→core · low criticality · 1 referring row. The
  // connected summary must annotate its single usage with these stored facts,
  // labeled as index-inferred — never at an evidence tier (§12.3).
  assert("H3: stored enrichment surfaces on hover (role/layer/frequency)", hoverText.includes("role consumer") && hoverText.includes("layer core→core") && hoverText.includes("1 referring row"), hoverText.slice(0, 400))
  assert("H3: enrichment is labeled index-inferred, never parser-fact tier", hoverText.includes("(enriched by index)"), hoverText.slice(0, 400))
  assert("H3: enrichment annotation never upgrades the evidence tier", !/^\s*evidence:.*role consumer/m.test(hoverText) && (hover?.data?.evidenceTiers ?? []).every((t: string) => t !== "role"), JSON.stringify(hover?.data?.evidenceTiers ?? null))

  // --- Hover actions (M42.H4, issue #652) ---
  // The actions row is the hover's door to the deep surfaces. Its args are
  // the SERVER-RESOLVED identity of the hovered symbol (greet): name + the
  // index-stored declaration location. Assert presence + parseability + the
  // symbol identity — the click behavior is proven in the E5 leg.
  assert("H4: hover embeds the actions row", hoverText.includes("**actions**: [Open in graph](command:bb.openGraph?") && hoverText.includes("[Impact analysis](command:bb.openImpact?") && hoverText.includes("[Call hierarchy](command:bb.showCallHierarchy?"), hoverText.slice(0, 500))
  const _h4re = /\]\(command:(bb\.openGraph|bb\.openImpact|bb\.showCallHierarchy)\?([^)]+)\)/g
  const _h4actions: Array<{ cmd: string; args: Record<string, unknown> }> = []
  let _h4m: RegExpExecArray | null
  while ((_h4m = _h4re.exec(hoverText)) !== null) {
    try {
      const _dec = JSON.parse(decodeURIComponent(_h4m[2]))
      const _args = (Array.isArray(_dec) ? _dec[0] : _dec) as Record<string, unknown>
      _h4actions.push({ cmd: _h4m[1], args: _args })
    } catch {}
  }
  assert("H4: exactly the three action commands embed parseable args", _h4actions.length === 3 && new Set(_h4actions.map((a) => a.cmd)).size === 3, JSON.stringify(_h4actions.map((a) => a.cmd)))
  assert(
    "H4: action args are the server-resolved symbol identity (greet)",
    _h4actions.length === 3 && _h4actions.every((a) => a.args.symbol === FIXTURE_SYMBOLS.method && typeof a.args.file === "string" && String(a.args.file).endsWith("main.ts") && typeof a.args.line === "number" && typeof a.args.character === "number"),
    JSON.stringify(_h4actions[0]?.args ?? null),
  )
  const hoverMiss = unwrap(await transport.request("textDocument/hover", { textDocument: { uri: mainUri }, position: { line: 20, character: 0 } }))
  const missOk = hoverMiss == null || hoverMiss?.contents === null || hoverMiss?.contents?.value === "" || hoverMiss?.contents?.value === undefined
  assert("L2: hover outside index is declared absent", missOk, JSON.stringify(hoverMiss ?? null).slice(0, 200))

  // --- Definition + references (L3) ---
  const def = unwrap(await transport.request("textDocument/definition", { textDocument: { uri: mainUri }, position: hoverPos }))
  // Payload surfaces: the server's {found, symbol, location:{path,line,…}}
  // (a non-conforming shape the editor converter passes through) or the
  // converted editor Location {uri, range:{start:{line}}} / Location[].
  const defLocs: any[] = Array.isArray(def) ? def : def ? [def] : []
  const defOk = def?.found === true || defLocs.some((d: any) => d?.range !== undefined || d?.line !== undefined || d?.location?.line !== undefined)
  assert("L3: definition resolves greet", defOk, JSON.stringify(def ?? null).slice(0, 300))
  const defLine = def?.location?.line ?? def?.line ?? defLocs.find((d: any) => d?.range?.start?.line !== undefined)?.range?.start?.line
  assert("L3: definition location is 0-based line 1", defLine === 1, JSON.stringify(def?.location ?? defLocs[0] ?? null))
  const refs = unwrap(await transport.request("textDocument/references", { textDocument: { uri: mainUri }, position: hoverPos, context: { includeDeclaration: true } }))
  const refList = Array.isArray(refs?.locations) ? refs.locations : Array.isArray(refs) ? refs : null
  assert("L3: references returns locations", Array.isArray(refList) && refList.length > 0, JSON.stringify(refs ?? null).slice(0, 200))
  // Derived past-EOF position (the constructor grew the fixture — a
  // hand-picked 10 was briefly INSIDE main's range and resolved honestly,
  // failing the declared-absence check).
  const _defMissPos = { line: FIXTURE_MAIN.split("\n").length + 5, character: 0 }
  const defMiss = unwrap(await transport.request("textDocument/definition", { textDocument: { uri: mainUri }, position: _defMissPos }))
  const missEmpty = defMiss == null || defMiss?.found === false || (Array.isArray(defMiss) && defMiss.length === 0) || defMiss?.locations?.length === 0
  assert("L3: definition outside index is honest empty", missEmpty, JSON.stringify(defMiss ?? null))

  // --- Symbols (L4) ---
  const docSym = unwrap(await transport.request("textDocument/documentSymbol", { textDocument: { uri: mainUri } }))
  const symList: any[] = Array.isArray(docSym) ? docSym : Array.isArray(docSym?.symbols) ? docSym.symbols : []
  assert("L4: documentSymbol returns Greeter root", symList[0]?.name === FIXTURE_SYMBOLS.className, JSON.stringify(docSym ?? null).slice(0, 200))
  assert("L4: documentSymbol hierarchy has greet child", (symList[0]?.children ?? []).some((c: any) => c.name === FIXTURE_SYMBOLS.method))
  const wsSym = unwrap(await transport.request("workspace/symbol", { query: "greet" }))
  const wsList: any[] = Array.isArray(wsSym) ? wsSym : Array.isArray(wsSym?.symbols) ? wsSym.symbols : []
  assert("L4: workspace/symbol finds greet", wsList.some((s: any) => s.name === FIXTURE_SYMBOLS.method), JSON.stringify(wsSym ?? null).slice(0, 200))

  // --- Call hierarchy (L5) ---
  const prep = unwrap(await transport.request("textDocument/prepareCallHierarchy", { textDocument: { uri: mainUri }, position: hoverPos }))
  const item = prep?.item ?? (Array.isArray(prep) ? prep[0] : prep)
  assert("L5: prepareCallHierarchy returns item", item?.name === FIXTURE_SYMBOLS.method, JSON.stringify(prep ?? null).slice(0, 200))
  const incoming = item ? unwrap(await transport.request("callHierarchy/incomingCalls", { item })) : null
  assert("L5: incomingCalls returns callers", Array.isArray(incoming?.calls) || Array.isArray(incoming), JSON.stringify(incoming ?? null).slice(0, 150))
  const outgoing = item ? unwrap(await transport.request("callHierarchy/outgoingCalls", { item })) : null
  assert("L5: outgoingCalls returns callees", Array.isArray(outgoing?.calls) || Array.isArray(outgoing), JSON.stringify(outgoing ?? null).slice(0, 150))

  // --- In-editor latency (the §3 gate over the editor stack) ---
  results.push(await measureWarmP95("hover", () => transport.request("textDocument/hover", { textDocument: { uri: mainUri }, position: hoverPos })))
  results.push(await measureWarmP95("definition", () => transport.request("textDocument/definition", { textDocument: { uri: mainUri }, position: hoverPos })))
  results.push(await measureWarmP95("references", () => transport.request("textDocument/references", { textDocument: { uri: mainUri }, position: hoverPos, context: { includeDeclaration: true } })))
  results.push(await measureWarmP95("documentSymbol", () => transport.request("textDocument/documentSymbol", { textDocument: { uri: mainUri } })))
  results.push(await measureWarmP95("workspaceSymbol", () => transport.request("workspace/symbol", { query: "greet" })))
  results.push(await measureWarmP95("prepareCallHierarchy", () => transport.request("textDocument/prepareCallHierarchy", { textDocument: { uri: mainUri }, position: hoverPos })))
  if (item) {
    results.push(await measureWarmP95("callHierarchyExpand", () => transport.request("callHierarchy/incomingCalls", { item })))
  }

  // --- Document highlights (H1, M42): semantic, staleness-labeled, absent-honest ---
  const hl = unwrap(
    await transport.request("textDocument/documentHighlight", {
      textDocument: { uri: mainUri },
      position: { line: FIXTURE_HIGHLIGHT.queryLine, character: FIXTURE_HIGHLIGHT.queryCharacter },
    }),
  )
  const hlItems: any[] = Array.isArray(hl) ? hl : []
  assert("H1: documentHighlight returns wire items", hlItems.length > 0, JSON.stringify(hl ?? null).slice(0, 200))
  const hlLines = new Set(hlItems.map((it) => it?.range?.start?.line))
  assert(
    "H1: declaration + call site highlight (semantic set)",
    FIXTURE_HIGHLIGHT.expectedLines.every((l) => hlLines.has(l)),
    `expected ${FIXTURE_HIGHLIGHT.expectedLines}, got ${[...hlLines]}`,
  )
  assert("H1: items carry staleness metadata in data (\u00a712.2)", hlItems.every((it) => it?.data?.staleness !== undefined && typeof it?.data?.staleness?.stale === "boolean"), JSON.stringify(hlItems[0]?.data ?? null))
  const hlMiss = unwrap(
    await transport.request("textDocument/documentHighlight", {
      textDocument: { uri: mainUri },
      position: { line: 20, character: 0 }, // past EOF — not an identifier position
    }),
  )
  assert("H1: highlight outside index is declared absent (wire null)", hlMiss === null, JSON.stringify(hlMiss ?? null).slice(0, 150))
  results.push(
    await measureWarmP95("documentHighlight", () =>
      transport.request("textDocument/documentHighlight", {
        textDocument: { uri: mainUri },
        position: { line: FIXTURE_HIGHLIGHT.queryLine, character: FIXTURE_HIGHLIGHT.queryCharacter },
      }),
    ),
  )

  // --- Shutdown lifecycle (stdio legs only; the host owns it otherwise) ---
  if (ctx.skipLifecycle !== true) {
    const shutdown = unwrap(await transport.request("shutdown", null))
    assert("L1: shutdown returns null result", shutdown === null)
    transport.notify("exit", {})
  }

  return results
}

// ---------------------------------------------------------------------------
// Stdio transport — the headless reference adapter (also used by the
// in-editor runners' server leg). Proves the core with a REAL server.
// ---------------------------------------------------------------------------

export function createStdioTransport(options: { runtime: "node-source" | "node-dist" | "bun-source"; workspaceDir: string; dataDir: string }): LspTransport & { serverBlockedReason?: string } {
  const SERVER_SOURCE = path.join(ROOT, "src", "lsp", "server.ts")
  const SERVER_DIST = path.join(ROOT, "dist", "lsp", "server.js")

  let command: string
  let args: string[]
  let blockedReason: string | undefined
  let stderrRing = ""
  if (options.runtime === "node-dist") {
    if (!existsSync(SERVER_DIST)) {
      blockedReason = `dist binary missing: ${SERVER_DIST} (run npm run build)`
    }
    command = process.execPath
    args = [SERVER_DIST, "--dir", options.workspaceDir]
  } else if (options.runtime === "bun-source") {
    command = "bun"
    args = [SERVER_SOURCE, "--dir", options.workspaceDir]
  } else {
    command = "npx"
    args = ["tsx", SERVER_SOURCE, "--dir", options.workspaceDir]
  }

  let child: ReturnType<typeof spawn> | null = null
  let exitedCode: number | null = null
  let buffer = Buffer.alloc(0)
  const pending = new Map<number, { resolve: (msg: any) => void; reject: (e: Error) => void }>()
  let nextId = 1

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = buffer.subarray(0, headerEnd).toString("utf8")
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4)
        continue
      }
      const length = parseInt(match[1]!, 10)
      if (buffer.length < headerEnd + 4 + length) return
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")
      buffer = buffer.subarray(headerEnd + 4 + length)
      let msg: any
      try {
        msg = JSON.parse(body)
      } catch {
        continue
      }
      if (msg && typeof msg.id === "number" && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        p.resolve(msg)
      }
    }
  }

  return {
    get serverBlockedReason() {
      return blockedReason
    },
    /** Last 8KB of server stderr — machine diagnostics for evidence (M29.R3). */
    stderrTail(): string {
      return stderrRing
    },
    ready(): Promise<void> {
      if (blockedReason !== undefined) return Promise.reject(new Error(blockedReason))
      if (child !== null) return Promise.resolve()
      // Spawn and resolve: the server is silent until the first request
      // (same as M24's client) — stdin writes are buffered by the OS, so
      // requests sent immediately after spawn are answered.
      child = spawn(command, args, {
        cwd: ROOT,
        env: { ...process.env, BB_DATA_DIR: options.dataDir },
        stdio: ["pipe", "pipe", "pipe"],
      })
      child.stdout!.on("data", onData)
      // stderr is machine diagnostics (not protocol): ring-captured so a
      // budget miss can name its server-side cause (M29.R3).
      child.stderr!.on("data", (chunk: Buffer) => {
        stderrRing = (stderrRing + chunk.toString("utf8")).slice(-8000)
      })
      child.on("exit", (code) => {
        exitedCode = code
      })
      return Promise.resolve()
    },
    request(method: string, params: unknown): Promise<any> {
      const id = nextId++
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
      child!.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      child!.stdin.write(body)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          const stderr = stderrRing.replace(/\s+$/g, "").slice(-500)
          const exitNote = exitedCode === null ? "" : ` (server exited code ${exitedCode})`
          reject(new Error(`timeout waiting for ${method} response${exitNote}; server stderr: ${stderr || "(empty)"}`))
        }, 15_000)
        pending.set(id, {
          resolve: (msg) => {
            clearTimeout(timer)
            resolve(msg)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
      })
    },
    notify(method: string, params: unknown): void {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }))
      child!.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      child!.stdin.write(body)
    },
    async dispose(): Promise<void> {
      try {
        child?.stdin.end()
      } catch {}
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          child?.kill("SIGKILL")
          resolve(null)
        }, 3000)
        child?.on("exit", () => {
          clearTimeout(t)
          resolve(null)
        })
      })
    },
  } as LspTransport & { serverBlockedReason?: string }
}

// ---------------------------------------------------------------------------
// Fixture workspace builder — real files, REAL index (seeded like M24's).
// ---------------------------------------------------------------------------

export async function buildFixtureWorkspace(baseDir: string): Promise<{ workspaceDir: string; dataDir: string; stats: { files: number; symbols: number; relationships: number } }> {
  const workspaceDir = mkdtempSync(path.join(baseDir || tmpdir(), "v1-ws-"))
  const dataDir = mkdtempSync(path.join(baseDir || tmpdir(), "v1-data-"))
  writeFileSync(path.join(workspaceDir, "main.ts"), FIXTURE_MAIN)

  const canonical = realpathSync.native(workspaceDir)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  const dbDir = path.join(dataDir, "projects", projectId)
  mkdirSync(dbDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  // Windows ESM loader rejects raw drive-letter paths in dynamic import() —
  // file:// URLs are portable (found by the E7 win32 CI leg, 2026-09-05).
  const { BrainDatabase } = await import(pathToFileURL(path.join(ROOT, "src", "brain", "database.ts")).href)
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fpath = path.join(workspaceDir, "main.ts")

  // File id follows the indexer's upsert convention (<projectId>:<relPath>)
  // so the P2 incremental reindex updates THIS row (M25.E5 staleness loop
  // lands on the same row it watches). The seeded row records the REAL hash
  // + stat metadata of the file on disk — a fixture that starts stale would
  // make the E5 live loop's first marker dishonest (found live by E5).
  const { hashFileContent } = await import(pathToFileURL(path.join(ROOT, "src", "brain", "freshness.ts")).href)
  const fileStat = statSync(fpath)
  const fileId = `${projectId}:main.ts`
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash, size_bytes, last_modified) VALUES (?,?,?,?,?,?,?,?)`).run(
    fileId,
    projectId,
    fpath,
    "main.ts",
    "typescript",
    hashFileContent(readFileSync(fpath)),
    fileStat.size,
    Math.floor(fileStat.mtimeMs),
  )

  const symStmt = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type,
      line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  symStmt.run("sym-greeter", projectId, fileId, FIXTURE_SYMBOLS.className, null, "class", 1, 6, 7, 2, null, 10)
  symStmt.run("sym-greet", projectId, fileId, FIXTURE_SYMBOLS.method, "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
  // M44.U5: the constructor member (the fixture's derived lines — never
  // hand-picked) with the owner + containment row the REAL indexer writes
  // (R0-proven in script/m44/verify-impact-resolution.ts). main's row is
  // derived too: the constructor shifted it down one line, and a stale
  // stored line would render a usage-site label the text disproves.
  const _u5Lines = FIXTURE_MAIN.split("\n")
  const _u5CtorLine = _u5Lines.findIndex((l) => l.includes("constructor()")) + 1
  const _u5MainLine = _u5Lines.findIndex((l) => l.includes("function main")) + 1
  symStmt.run("sym-ctor", projectId, fileId, "constructor", "Greeter.constructor", "constructor", _u5CtorLine, _u5CtorLine, 28, 14, "sym-greeter", 6)
  symStmt.run("sym-main", projectId, fileId, FIXTURE_SYMBOLS.fn, null, "function", _u5MainLine, _u5MainLine + 3, 10, 2, null, 5)

  // rel-1 models an ANALYZER + ENRICHMENT row: analyzer evidence fields
  // (evidenceClass in metadata, M24 era) plus the enrichment pass's stored
  // facts (role/layerFlow/criticality/frequency/inferredAt — shape observed
  // on REAL freshly-indexed rows; enrichment runs in the CLI after analysis).
  // inferredAt is stamped AFTER the insert (time_updated default = insert
  // wall-clock ms), so the row is FRESH — never the stale path in this
  // fixture. M42.H3 surfaces these facts on hover in-editor (E5 leg).
  // relationship_type is "calls" (the REAL analyzer vocabulary, plural —
  // M42.H5's bb/graph usages traversal filters on the graph engine's
  // DEFAULT_REL_TYPES; the M24-era singular "call" was invisible to it, a
  // fixture convention the E5 hub leg exposed).
  const relMeta = JSON.stringify({
    evidenceClass: "structural",
    role: "consumer",
    layerFlow: "core→core",
    criticality: "low",
    frequency: "one_of_1",
    inferredAt: Date.now(),
  })
  raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata) VALUES (?,?,?,?,?,?,?)`).run(
    "rel-1",
    projectId,
    "sym-main",
    "sym-greet",
    "calls",
    1.0,
    relMeta,
  )
  // M44.U5: the indexer's universal containment row for the constructor
  // (owner → member) — the ONLY relationship the constructor has.
  raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`).run(
    "rel-ctor-contains",
    projectId,
    "sym-greeter",
    "sym-ctor",
    "contains",
    1.0,
  )

  return { workspaceDir, dataDir, stats: { files: 1, symbols: 4, relationships: 2 } }
}

/**
 * Machine record (contract §3: every number records its machine).
 * Portable: node:os only — no uname//proc/shell, so the record is
 * machine-emittable on linux, darwin AND win32 (the E7 OS-matrix legs).
 */
export function machineInfo(runtime: string): { kernel: string; cpu: string; ramGb: number; node: string; runtime: string } {
  const kernel = `${os.type()} ${os.release()}`
  const cpu = (os.cpus()[0]?.model ?? "unknown").trim()
  const ramGb = Math.round((os.totalmem() / 1e9) * 10) / 10
  return { kernel, cpu, ramGb, node: process.version, runtime }
}
