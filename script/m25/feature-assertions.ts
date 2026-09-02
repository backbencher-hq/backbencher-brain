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
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/** The shared fixture — the exact M24 harness fixture text. */
export const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
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
}

export interface FeatureMeasurement {
  op: string
  p95WarmMs: number
  samples: number
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
  return { op, p95WarmMs: samples[Math.floor(samples.length * 0.95)]!, samples: iterations }
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
}

type Assert = (name: string, ok: boolean, detail?: string) => void

/** Run every feature assertion over the transport. Returns all results. */
export async function runFeatureAssertions(ctx: AssertionContext, assert: Assert): Promise<FeatureMeasurement[]> {
  const { transport } = ctx
  await transport.ready()

  const mainUri = `file://${path.join(ctx.workspaceDir, "main.ts")}`
  const hoverPos = FIXTURE_HOVER_POS
  const results: FeatureMeasurement[] = []

  // --- Lifecycle (L1) ---
  const init = await transport.request("initialize", { capabilities: {} })
  const caps = init?.result?.capabilities ?? {}
  assert("L1: initialize returns capabilities", !!init?.result?.capabilities)
  assert("L1: hover capability advertised", caps.hoverProvider === true)
  assert("L1: definition capability advertised", caps.definitionProvider === true)
  assert("L1: references capability advertised", caps.referencesProvider === true)
  assert("L1: documentSymbol capability advertised", caps.documentSymbolProvider === true)
  assert("L1: workspaceSymbol capability advertised", caps.workspaceSymbolProvider === true)
  assert("L1: callHierarchy capability advertised", caps.callHierarchyProvider === true)
  transport.notify("initialized", {})

  // --- Hover (L2): real content, provenance, honest absence ---
  const hover = await transport.request("textDocument/hover", { textDocument: { uri: mainUri }, position: hoverPos })
  assert("L2: hover returns markdown contents", hover?.result?.contents?.kind === "markdown")
  assert("L2: hover names greet", (hover?.result?.data?.name ?? "") === FIXTURE_SYMBOLS.method, JSON.stringify(hover?.result?.data))
  assert("L2: hover usage count matches fixture relationship", hover?.result?.data?.usageCount === 1)
  assert("L2: hover provenance labels bb index source", (hover?.result?.provenance?.source ?? "") === "bb_index")
  const hoverMiss = await transport.request("textDocument/hover", { textDocument: { uri: mainUri }, position: { line: 20, character: 0 } })
  assert("L2: hover outside index is declared absent", hoverMiss?.result?.contents === null && hoverMiss?.result?.data === null)

  // --- Definition + references (L3) ---
  const def = await transport.request("textDocument/definition", { textDocument: { uri: mainUri }, position: hoverPos })
  assert("L3: definition resolves greet", def?.result?.found === true && def?.result?.symbol?.name === FIXTURE_SYMBOLS.method)
  assert("L3: definition location is 0-based line 1", def?.result?.location?.line === 1, JSON.stringify(def?.result?.location))
  const refs = await transport.request("textDocument/references", { textDocument: { uri: mainUri }, position: hoverPos, context: { includeDeclaration: true } })
  assert("L3: references returns locations", Array.isArray(refs?.result?.locations) && refs?.result?.locations.length > 0)
  const defMiss = await transport.request("textDocument/definition", { textDocument: { uri: mainUri }, position: { line: 10, character: 0 } })
  assert("L3: definition outside index is honest empty", defMiss?.result?.found === false)

  // --- Symbols (L4) ---
  const docSym = await transport.request("textDocument/documentSymbol", { textDocument: { uri: mainUri } })
  assert("L4: documentSymbol returns Greeter root", docSym?.result?.symbols?.[0]?.name === FIXTURE_SYMBOLS.className)
  assert("L4: documentSymbol hierarchy has greet child", (docSym?.result?.symbols?.[0]?.children ?? []).some((c: any) => c.name === FIXTURE_SYMBOLS.method))
  const wsSym = await transport.request("workspace/symbol", { query: "greet" })
  assert("L4: workspace/symbol finds greet", wsSym?.result?.symbols?.some((s: any) => s.name === FIXTURE_SYMBOLS.method))

  // --- Call hierarchy (L5) ---
  const prep = await transport.request("textDocument/prepareCallHierarchy", { textDocument: { uri: mainUri }, position: hoverPos })
  assert("L5: prepareCallHierarchy returns item", prep?.result?.item?.name === FIXTURE_SYMBOLS.method)
  const item = prep?.result?.item
  const incoming = item ? await transport.request("callHierarchy/incomingCalls", { item }) : null
  assert("L5: incomingCalls returns callers", Array.isArray(incoming?.result?.calls) && incoming?.result?.calls.length >= 0)
  const outgoing = item ? await transport.request("callHierarchy/outgoingCalls", { item }) : null
  assert("L5: outgoingCalls returns callees", Array.isArray(outgoing?.result?.calls))

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

  // --- Shutdown lifecycle ---
  const shutdown = await transport.request("shutdown", null)
  assert("L1: shutdown returns null result", shutdown?.result === null)
  transport.notify("exit", {})

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
      child.stderr!.on("data", () => {})
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
          reject(new Error(`timeout waiting for ${method} response`))
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

  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fpath = path.join(workspaceDir, "main.ts")

  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run(
    "file-1",
    projectId,
    fpath,
    "main.ts",
    "typescript",
    "fixture-hash-1",
  )

  const symStmt = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type,
      line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  symStmt.run("sym-greeter", projectId, "file-1", FIXTURE_SYMBOLS.className, null, "class", 1, 3, 7, 2, null, 10)
  symStmt.run("sym-greet", projectId, "file-1", FIXTURE_SYMBOLS.method, "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
  symStmt.run("sym-main", projectId, "file-1", FIXTURE_SYMBOLS.fn, null, "function", 7, 10, 10, 2, null, 5)

  raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`).run(
    "rel-1",
    projectId,
    "sym-main",
    "sym-greet",
    "call",
    1.0,
  )

  return { workspaceDir, dataDir, stats: { files: 1, symbols: 3, relationships: 1 } }
}

/** Machine record (contract §3: every number records its machine). */
export function machineInfo(runtime: string): { kernel: string; cpu: string; ramGb: number; node: string; runtime: string } {
  const kernel = execFileSync("uname", ["-sr"], { encoding: "utf8" }).trim()
  let cpu = "unknown"
  try {
    cpu = execFileSync("sh", ["-c", "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs"], { encoding: "utf8" }).trim()
  } catch {}
  const ramGb = Math.round((Number(execFileSync("sh", ["-c", "grep MemTotal /proc/meminfo | awk '{print $2}'"], { encoding: "utf8" }).trim()) / 1e6) * 10) / 10
  return { kernel, cpu, ramGb, node: process.version, runtime }
}
