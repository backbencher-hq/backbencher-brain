// script/m24/lsp_harness.ts — M24.V1 reference LSP client harness (I1 gate).
//
// A real LSP client, in-repo, no editor. It speaks the protocol over stdio
// to the spawned server (Content-Length framing, JSON-RPC 2.0), drives the
// full lifecycle and every L1-L5 feature against a fixture workspace with a
// seeded brain.db, asserts positive AND negative cases, and measures latency
// per operation. Machine + repo + commit + fixture stats are recorded with
// every measurement (contract §3).
//
// Runtimes (--runtime):
//   node-source: npx tsx src/lsp/server.ts --dir <ws>      (this repo)
//   node-dist:   node dist/lsp/server.js --dir <ws>        (compiled)
//   bun-source:  bun src/lsp/server.ts --dir <ws>          (bun, source)
// Missing runtime/binary = a FAILED or BLOCKED check, never a silent skip
// (contract: silence is guilt). The harness reports every leg explicitly.
//
// Exit code: 0 when every executed leg passed its assertions; non-zero on
// any real failure. A blocked leg (runtime missing) is recorded with reason
// but does not by itself fail the harness — the verifier decides the status.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import os from "node:os"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SERVER_SOURCE = join(ROOT, "src", "lsp", "server.ts")
const SERVER_DIST = join(ROOT, "dist", "lsp", "server.js")

/**
 * The machine facts contract §3 requires every measured number to carry, with
 * each fact naming the API that produced it.
 *
 * `value: null` is a DECLARED ABSENCE and is legal — but only with a `reason`.
 * A number that reads as a measurement but is an artifact of a failed read
 * (`ramGb: 0`) or a string that reads as a name but is empty (`cpu: ""`) is a
 * quiet falsehood in a sealed record, and that is the defect this shape
 * exists to make impossible to publish.
 */
export interface MachineFacts {
  kernel: string
  kernelSource: string
  /** null = declared absent, and then `cpuReason` is required */
  cpu: string | null
  cpuSource: string
  cpuReason?: string
  /** null = declared absent, and then `ramReason` is required */
  ramGb: number | null
  ramSource: string
  ramReason?: string
  node: string
  runtime: string
}

export interface HarnessOptions {
  runtime: "node-source" | "node-dist" | "bun-source"
  /** Override workspace dir (defaults to a temp fixture). */
  workspaceDir?: string
  /** Override data dir (defaults to a temp fixture). */
  dataDir?: string
}

export interface FeatureMeasurement {
  op: string
  /** warm p95 in ms (budget regime: warm) */
  p95WarmMs: number
  samples: number
  passed: boolean
}

export interface HarnessRun {
  runtime: string
  status: "verified" | "failed" | "blocked"
  reason?: string
  commit: string
  machine: MachineFacts
  features: FeatureMeasurement[]
  checks: Array<{ name: string; ok: boolean; detail?: string }>
  fixtureStats: { files: number; symbols: number; relationships: number }
}

// --- Fixture workspace + seeded index ----------------------------------------

const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`

/**
 * THE OWNER of this record's machine facts (contract §3: every measured number
 * records kernel, CPU and RAM).
 *
 * It is node:os only — no `uname`, no `/proc`, no shell — for three measured
 * reasons:
 *
 *  1. THE DEFECT THIS REPLACES. The previous owner read
 *     `sh -c "grep -m1 'model name' /proc/cpuinfo | …"` and
 *     `sh -c "grep MemTotal /proc/meminfo | awk …"`. On a `sh -c` PIPELINE the
 *     exit status is the LAST stage's, so `grep` failing and `awk` succeeding
 *     meant `execFileSync` returned NORMALLY with an empty string: the
 *     `catch {}` on the CPU line never fired, `""` overwrote the `let cpu =
 *     "unknown"` fallback the author had clearly intended, and
 *     `Number("") / 1e6` rounded to `ramGb: 0`. Three sealed V1 runs published
 *     `{"cpu": "", "ramGb": 0}` as machine facts, under a VERIFIED verdict,
 *     with the grep error only on the gate's stderr. Silence is guilt (§8.3)
 *     and so is a plausible-looking zero (§8.7).
 *  2. `os.cpus()` / `os.totalmem()` / `os.release()` are the runtime's own
 *     answers and work on darwin, linux and win32. `/proc` exists on linux
 *     only; this record is published with every latency number in it, so it
 *     must be emittable wherever the numbers are.
 *  3. The repo already made this call: `machineInfo` in
 *     script/m25/feature-assertions.ts:637 is node:os only with the same
 *     header rationale. This function is that owner, brought to M24 — plus the
 *     absence-with-reason discipline m25 does not have (its `?? "unknown"`
 *     cannot catch an EMPTY `os.cpus()[0].model`, which is the same quiet lie).
 *
 * `kernel` keeps the exact string `uname -sr` produced on this machine:
 * `${os.type()} ${os.release()}` === "Darwin 23.6.0" === `uname -sr` here, and
 * on linux both spell "Linux <release>". So the portable owner loses no
 * information and costs one process spawn fewer per run.
 *
 * Anything it cannot determine is published as null WITH a reason, never as a
 * zero or an empty string.
 */
export function machineFacts(runtime: string): MachineFacts {
  const kernel = `${os.type()} ${os.release()}`
  const cpuModel = os.cpus()[0]?.model?.trim() ?? ""
  const totalBytes = os.totalmem()
  const facts: MachineFacts = {
    kernel,
    kernelSource: "os.type() + os.release()",
    cpu: cpuModel === "" ? null : cpuModel,
    cpuSource: "os.cpus()[0].model",
    ramGb: Number.isFinite(totalBytes) && totalBytes > 0 ? Math.round((totalBytes / 1e9) * 10) / 10 : null,
    ramSource: "os.totalmem()",
    node: process.version,
    runtime,
  }
  if (facts.cpu === null) {
    facts.cpuReason = "os.cpus()[0].model was empty or absent — the runtime returned no CPU model on this host (common in some containers), so no CPU fact is claimed"
  }
  if (facts.ramGb === null) {
    facts.ramReason = `os.totalmem() returned ${String(totalBytes)} — a non-positive total cannot be published as a RAM measurement, so no RAM fact is claimed`
  }
  return facts
}

/** Seed a real brain.db at <dataDir>/projects/<projectId>/brain.db with the
 *  fixture symbols, so the server serves real content over the wire. */
async function seedFixtureIndex(wsDir: string, dataDir: string): Promise<{ files: number; symbols: number; relationships: number }> {
  const canonical = realpathSync.native(wsDir)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  const dbDir = join(dataDir, "projects", projectId)
  mkdirSync(dbDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fpath = join(wsDir, "main.ts")

  raw.prepare(
    `INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash)
     VALUES (?,?,?,?,?,?)`,
  ).run("file-1", projectId, fpath, "main.ts", "typescript", "fixture-hash-1")

  const symStmt = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type,
      line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  symStmt.run("sym-greeter", projectId, "file-1", "Greeter", null, "class", 1, 3, 7, 2, null, 10)
  symStmt.run("sym-greet", projectId, "file-1", "greet", "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
  symStmt.run("sym-main", projectId, "file-1", "main", null, "function", 7, 10, 10, 2, null, 5)

  raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence)
     VALUES (?,?,?,?,?,?)`,
  // relationship_type is "calls" — the REAL analyzer vocabulary (plural). The
  // graph engine's DEFAULT_REL_TYPES filter on it; the M24-era singular
  // "call" was invisible to the engine's call-hierarchy/impact traversals.
  ).run("rel-1", projectId, "sym-main", "sym-greet", "calls", 1.0)

  return { files: 1, symbols: 3, relationships: 1 }
}

// --- Minimal LSP client over stdio -------------------------------------------

class LspClient {
  private child: ReturnType<typeof spawn>
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (msg: any) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private stderr = ""
  private startedAt = Date.now()

  constructor(
    private readonly runtime: string,
    wsDir: string,
    dataDir: string,
  ) {
    let command: string
    let args: string[]
    if (runtime === "node-source") {
      // tsx is invoked via npx (not a local dependency) — same convention as
      // every other verifier in the repo.
      command = "npx"
      args = ["tsx", SERVER_SOURCE, "--dir", wsDir]
    } else if (runtime === "node-dist") {
      command = process.execPath
      args = [SERVER_DIST, "--dir", wsDir]
    } else {
      command = "bun"
      args = [SERVER_SOURCE, "--dir", wsDir]
    }
    this.child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child.stdout.on("data", (d: Buffer) => this.onData(d))
    this.child.stderr.on("data", (d: Buffer) => {
      this.stderr += d.toString()
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf8")
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = parseInt(match[1]!, 10)
      if (this.buffer.length < headerEnd + 4 + length) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")
      this.buffer = this.buffer.subarray(headerEnd + 4 + length)
      let msg: any
      try {
        msg = JSON.parse(body)
      } catch {
        continue
      }
      if (msg && typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        p.resolve(msg)
      }
    }
  }

  /** Send a request, await its response, return the response message. */
  request(method: string, params: any): Promise<any> {
    const id = this.nextId++
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`timeout waiting for ${method} response`))
      }, 15000)
      this.pending.set(id, {
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
  }

  /** Send a notification (no response). */
  notify(method: string, params: any): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }))
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  getStderr(): string {
    return this.stderr
  }

  async close(): Promise<void> {
    try {
      this.child.stdin.end()
    } catch {}
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.child.kill("SIGKILL")
        resolve(null)
      }, 3000)
      this.child.on("exit", () => {
        clearTimeout(t)
        resolve(null)
      })
    })
  }
}

// --- Feature driving -----------------------------------------------------------

interface DriverCtx {
  client: LspClient
  checks: Array<{ name: string; ok: boolean; detail?: string }>
  measurements: FeatureMeasurement[]
}

function check(ctx: DriverCtx, name: string, ok: boolean, detail = ""): void {
  ctx.checks.push({ name, ok, detail })
}

/** Measure warm p95 for one operation over N iterations. */
async function measure(
  ctx: DriverCtx,
  op: string,
  fn: () => Promise<any>,
  iterations = 60,
): Promise<number> {
  // Warm up: at least one prior request (warm regime definition, §3).
  await fn()
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  ctx.measurements.push({ op, p95WarmMs: p95, samples: samples.length, passed: true })
  return p95
}

async function driveFeatureSuite(
  client: LspClient,
  wsDir: string,
  fixtureStats: { files: number; symbols: number; relationships: number },
): Promise<{ checks: Array<{ name: string; ok: boolean; detail?: string }>; measurements: FeatureMeasurement[] }> {
  const ctx: DriverCtx = { client, checks: [], measurements: [] }
  const mainUri = `file://${join(wsDir, "main.ts")}`
  const hoverPos = { line: 1, character: 2 } // inside greet()

  // --- Lifecycle (L1) ---
  const init = await client.request("initialize", { capabilities: {} })
  const caps = init?.result?.capabilities ?? {}
  check(ctx, "L1: initialize returns capabilities", !!init?.result?.capabilities)
  check(ctx, "L1: hover capability advertised", caps.hoverProvider === true)
  check(ctx, "L1: definition capability advertised", caps.definitionProvider === true)
  check(ctx, "L1: references capability advertised", caps.referencesProvider === true)
  check(ctx, "L1: documentSymbol capability advertised", caps.documentSymbolProvider === true)
  check(ctx, "L1: workspaceSymbol capability advertised", caps.workspaceSymbolProvider === true)
  check(ctx, "L1: callHierarchy capability advertised", caps.callHierarchyProvider === true)
  client.notify("initialized", {})

  // Request before initialize must be rejected (L1 negative).
  // (Sent in the negative suite below against a fresh process.)

  // --- Hover (L2) ---
  const hover = await client.request("textDocument/hover", {
    textDocument: { uri: mainUri },
    position: hoverPos,
  })
  check(ctx, "L2: hover returns markdown contents", hover?.result?.contents?.kind === "markdown")
  // Wire law (fixed 2026-09-12, M55.T2 re-run): the component envelope rides
  // `Hover.data` as `{ provenance, symbol }` — the spec's data slot. This
  // harness still read a flat `data.name` and a TOP-LEVEL `provenance` (which
  // LSP Hover does not have), so V1 sat KNOWN-GAP with four red legs while the
  // server was correct: the gate was asserting a shape the server had stopped
  // answering. Assert the declared contract, not the remembered one.
  check(ctx, "L2: hover names greet", (hover?.result?.data?.symbol?.name ?? "") === "greet", JSON.stringify(hover?.result?.data))
  check(ctx, "L2: hover usage count matches fixture relationship", hover?.result?.data?.symbol?.usageCount === 1, JSON.stringify(hover?.result?.data?.symbol?.usageCount))
  check(ctx, "L2: hover provenance labels bb index source", (hover?.result?.data?.provenance?.source ?? "") === "bb_index", JSON.stringify(hover?.result?.data?.provenance))
  // The staleness marker is a declared boolean on both blocks (contract §4):
  // this fixture seeds brain.db by hand, so the monitor may honestly report
  // `stale` — what must never happen is a MISSING or silently absent marker.
  check(ctx, "L2: hover declares its staleness marker", typeof hover?.result?.data?.provenance?.stale === "boolean" && typeof hover?.result?.data?.symbol?.stale === "boolean", JSON.stringify({ provenance: hover?.result?.data?.provenance?.stale, symbol: hover?.result?.data?.symbol?.stale }))

  // Hover at a not-indexed position: declared absence = wire `null` (a
  // `{contents: null}` envelope is INVALID on the wire — the stock client
  // converter throws reading `.kind` of null).
  const hoverMiss = await client.request("textDocument/hover", {
    textDocument: { uri: mainUri },
    position: { line: 20, character: 0 },
  })
  check(ctx, "L2: hover outside index is declared absent", hoverMiss?.result === null, JSON.stringify(hoverMiss?.result))

  // --- Definition + references (L3) ---
  // Wire law: the server answers PROTOCOL shapes (Location / Location[] /
  // DocumentSymbol[] / CallHierarchyItem[]), not component envelopes — a
  // typed editor client iterates these results as arrays (VS Code's
  // documentSymbol and call-hierarchy adapters crashed on the old envelope,
  // reading `.name` of undefined; owner test 2026-09-06).
  const def = await client.request("textDocument/definition", {
    textDocument: { uri: mainUri },
    position: hoverPos,
  })
  const defLoc = Array.isArray(def?.result) ? def?.result?.[0] : def?.result
  check(ctx, "L3: definition resolves to an LSP Location", defLoc?.uri?.startsWith("file://") && defLoc?.range?.start?.line !== undefined, JSON.stringify(def?.result).slice(0, 250))
  check(ctx, "L3: definition location is 0-based line 1", defLoc?.range?.start?.line === 1, JSON.stringify(defLoc))

  const refs = await client.request("textDocument/references", {
    textDocument: { uri: mainUri },
    position: hoverPos,
    context: { includeDeclaration: true },
  })
  check(ctx, "L3: references returns LSP Location[]", Array.isArray(refs?.result) && refs.result.length > 0 && (refs.result[0]?.uri ?? "").startsWith("file://"), JSON.stringify(refs).slice(0, 250))

  // Unresolved position: honest empty. Line 10 (0-based) is the trailing
  // empty line — in range but carries no symbol.
  const defMiss = await client.request("textDocument/definition", {
    textDocument: { uri: mainUri },
    position: { line: 10, character: 0 },
  })
  check(ctx, "L3: definition outside index is honest empty", defMiss?.result === null || (Array.isArray(defMiss?.result) && defMiss.result.length === 0), JSON.stringify(defMiss).slice(0, 250))

  // --- Symbols (L4) ---
  const docSym = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: mainUri },
  })
  const symList: any[] = Array.isArray(docSym?.result) ? docSym.result : []
  check(ctx, "L4: documentSymbol returns Greeter root (DocumentSymbol[])", symList[0]?.name === "Greeter" && symList[0]?.kind !== undefined, (JSON.stringify(docSym?.result) ?? "").slice(0, 300))
  check(ctx, "L4: documentSymbol hierarchy has greet child", (symList[0]?.children ?? []).some((c: any) => c.name === "greet"), (JSON.stringify(symList[0]?.children) ?? "").slice(0, 250))
  check(ctx, "L4: documentSymbol range contains symbol text", (() => {
    const root = symList[0]
    if (!root) return false
    const lines = FIXTURE_MAIN.split("\n")
    const firstLine = lines[root.range?.start?.line] ?? ""
    return firstLine.includes("Greeter")
  })())

  const wsSym = await client.request("workspace/symbol", { query: "greet" })
  const wsList: any[] = Array.isArray(wsSym?.result) ? wsSym.result : []
  check(ctx, "L4: workspace/symbol finds greet (SymbolInformation[])", wsList.some((s: any) => s.name === "greet" && (s.location?.uri ?? "").startsWith("file://")))

  // --- Call hierarchy (L5) ---
  const prep = await client.request("textDocument/prepareCallHierarchy", {
    textDocument: { uri: mainUri },
    position: hoverPos,
  })
  const prepItems: any[] = Array.isArray(prep?.result) ? prep.result : []
  check(ctx, "L5: prepareCallHierarchy returns CallHierarchyItem[]", prepItems[0]?.name === "greet" && prepItems[0]?.data?.symbolId !== undefined, (JSON.stringify(prep?.result) ?? "").slice(0, 250))

  const item = prepItems[0]
  const incoming = item ? await client.request("callHierarchy/incomingCalls", { item }) : null
  // The fixture's `main` calls `greet` (`g.greet()`), so a correct server always
  // answers at least one caller — and the call site must be the INVOCATION, not
  // the caller's declaration line (M55.T2 Truth Rule 1, exercised here too).
  const incomingList: any[] = Array.isArray(incoming?.result) ? incoming.result : []
  check(ctx, "L5: incomingCalls returns CallHierarchyIncomingCall[]", Array.isArray(incoming?.result), JSON.stringify(incoming?.result).slice(0, 200))
  check(ctx, "L5: the fixture's caller is reported", incomingList.some((c) => c.from?.name === "main"), JSON.stringify(incomingList.map((c) => c.from?.name)))
  check(ctx, "L5: the reported call site is the invocation of greet", (() => {
    const call = incomingList.find((c) => c.from?.name === "main")
    const r = call?.fromRanges?.[0]
    if (r === undefined || r.start.line !== r.end.line) return false
    const line = FIXTURE_MAIN.split("\n")[r.start.line] ?? ""
    return line.slice(r.start.character, r.end.character) === "greet"
  })(), JSON.stringify(incomingList.map((c) => c.fromRanges)))
  const outgoing = item ? await client.request("callHierarchy/outgoingCalls", { item }) : null
  check(ctx, "L5: outgoingCalls returns CallHierarchyOutgoingCall[]", Array.isArray(outgoing?.result))

  // --- Latency (budget gate, contract §3) ---
  await measure(ctx, "hover", () => client.request("textDocument/hover", { textDocument: { uri: mainUri }, position: hoverPos }))
  await measure(ctx, "definition", () => client.request("textDocument/definition", { textDocument: { uri: mainUri }, position: hoverPos }))
  await measure(ctx, "references", () => client.request("textDocument/references", { textDocument: { uri: mainUri }, position: hoverPos, context: { includeDeclaration: true } }))
  await measure(ctx, "documentSymbol", () => client.request("textDocument/documentSymbol", { textDocument: { uri: mainUri } }))
  await measure(ctx, "workspaceSymbol", () => client.request("workspace/symbol", { query: "greet" }))
  await measure(ctx, "prepareCallHierarchy", () => client.request("textDocument/prepareCallHierarchy", { textDocument: { uri: mainUri }, position: hoverPos }))
  if (item) {
    await measure(ctx, "callHierarchyExpand", () => client.request("callHierarchy/incomingCalls", { item }))
  }

  // --- Shutdown lifecycle (L1) ---
  const shutdown = await client.request("shutdown", null)
  check(ctx, "L1: shutdown returns null result", shutdown?.result === null)
  client.notify("exit", {})

  return { checks: ctx.checks, measurements: ctx.measurements }
}

// --- Leg driver ---------------------------------------------------------------

export async function runHarness(options: HarnessOptions): Promise<HarnessRun> {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

  // Runtime availability: a missing binary/runtime is BLOCKED with reason,
  // never a silent skip (contract: silence is guilt).
  if (options.runtime === "node-dist" && !existsSync(SERVER_DIST)) {
    return {
      runtime: options.runtime,
      status: "blocked",
      reason: `dist binary missing: ${SERVER_DIST} (run npm run build)`,
      commit,
      machine: machineFacts(options.runtime),
      features: [],
      checks: [{ name: "runtime availability", ok: false, detail: "dist binary missing" }],
      fixtureStats: { files: 0, symbols: 0, relationships: 0 },
    }
  }
  if (options.runtime === "bun-source") {
    try {
      execFileSync("which", ["bun"], { encoding: "utf8", stdio: "pipe" })
    } catch {
      return {
        runtime: options.runtime,
        status: "blocked",
        reason: "bun runtime not found on PATH",
        commit,
        machine: machineFacts(options.runtime),
        features: [],
        checks: [{ name: "runtime availability", ok: false, detail: "bun not found" }],
        fixtureStats: { files: 0, symbols: 0, relationships: 0 },
      }
    }
  }

  const wsDir = options.workspaceDir ?? mkdtempSync(join(tmpdir(), "bblsp-v1-ws-"))
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "bblsp-v1-data-"))
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(wsDir, "main.ts"), FIXTURE_MAIN)

  const fixtureStats = await seedFixtureIndex(wsDir, dataDir)

  const client = new LspClient(options.runtime, wsDir, dataDir)
  let checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  let measurements: FeatureMeasurement[] = []
  let fatal: string | undefined

  try {
    const result = await driveFeatureSuite(client, wsDir, fixtureStats)
    checks = result.checks
    measurements = result.measurements
  } catch (error: any) {
    fatal = error?.message ?? String(error)
    checks.push({ name: "harness drive", ok: false, detail: fatal })
  } finally {
    await client.close()
  }

  if (!options.workspaceDir) {
    try { rmSync(wsDir, { recursive: true, force: true }) } catch {}
  }
  if (!options.dataDir) {
    try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  }

  const ok = fatal === undefined && checks.every((c) => c.ok)
  return {
    runtime: options.runtime,
    status: ok ? "verified" : "failed",
    reason: fatal,
    commit,
    machine: machineFacts(options.runtime),
    features: measurements,
    checks,
    fixtureStats,
  }
}

// Self-execution: npx tsx script/m24/lsp_harness.ts --runtime <r> [--keep]
if (process.argv[1]?.endsWith("lsp_harness.ts")) {
  const runtime = (process.argv[process.argv.indexOf("--runtime") + 1] ?? "node-source") as HarnessOptions["runtime"]
  const keep = process.argv.includes("--keep")
  runHarness({ runtime, workspaceDir: keep ? "/tmp/bblsp-v1-ws" : undefined, dataDir: keep ? "/tmp/bblsp-v1-data" : undefined })
    .then((run) => {
      console.log(JSON.stringify(run, null, 2))
      process.exit(run.status === "verified" ? 0 : run.status === "blocked" ? 0 : 1)
    })
    .catch((e) => {
      console.error("harness crashed:", e)
      process.exit(1)
    })
}
