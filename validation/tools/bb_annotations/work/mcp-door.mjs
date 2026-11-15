// validation/tools/bb_annotations/work/mcp-door.mjs
//
// Phase A audit: bb_annotations through the REAL MCP stdio door, from SOURCE.
// Spawns the real server (src/mcp/server.ts via mcp-server-child.mts), speaks
// JSON-RPC over stdin/stdout, and records every frame. Checks are written from
// the tool's declared contract, not from the answer it happens to give, so a
// disagreement is recorded as a failing check with the observed value.
//
// Run: BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/mcp-door.mjs \
//        --workspace validation/tools/bb_annotations/work/probe-fixture \
//        --data validation/tools/bb_annotations/bbdata \
//        --out validation/tools/bb_annotations/raw/door-annotations.json
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const WORKSPACE = join(ROOT, arg("workspace", "validation/tools/bb_annotations/work/probe-fixture"))
const DATA = join(ROOT, arg("data", "validation/tools/bb_annotations/bbdata"))
const OUT = join(ROOT, arg("out", "validation/tools/bb_annotations/raw/door-annotations.json"))

const now = () => Number(process.hrtime.bigint()) / 1e6
const round = (n) => Math.round(n * 1000) / 1000
const sha256 = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null)

function findProjectId(workspace) {
  // The child computes the id with the product's own resolver; the parent only
  // needs to know which project directory to hash, so it mirrors the one rule
  // (canonical realpath -> sha1) rather than reimplementing a guess.
  let canonical = workspace
  try { canonical = realpathSync.native(workspace) } catch {}
  return createHash("sha1").update(canonical).digest("hex").substring(0, 40)
}
const PROJECT = findProjectId(WORKSPACE)
const PROJECT_DB = join(DATA, "projects", PROJECT, "brain.db")

function hashSet() {
  if (!existsSync(PROJECT_DB)) return { exists: false }
  const dir = dirname(PROJECT_DB)
  const out = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isFile()) out[name] = { bytes: statSync(p).size, sha256: sha256(p) }
  }
  return { exists: true, files: out }
}

const before = hashSet()

const child = spawn("npx", ["tsx", join(HERE, "mcp-server-child.mts"), WORKSPACE], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: DATA, BB_NO_AUTO_REFRESH: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
let buffer = ""
const frames = []
const nonJsonStdout = []
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try { frames.push(JSON.parse(line)) } catch { nonJsonStdout.push(line.slice(0, 300)) }
  }
})
let stderr = ""
child.stderr.on("data", (chunk) => { stderr += chunk.toString() })

const pending = new Map()
let nextId = 1
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n")
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function request(method, params) {
  const id = nextId++
  send({ jsonrpc: "2.0", id, method, params })
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
}
async function pump() {
  // Resolve responses through the same frame stream the evidence records.
  const deadline = Date.now() + 180000
  let seen = 0
  while (pending.size > 0 && Date.now() < deadline) {
    for (let i = seen; i < frames.length; i++) {
      const frame = frames[i]
      if (frame && typeof frame.id === "number" && pending.has(frame.id)) {
        const entry = pending.get(frame.id)
        pending.delete(frame.id)
        entry.resolve(frame)
      }
    }
    seen = frames.length
    await wait(20)
  }
  if (pending.size > 0) throw new Error(`MCP request timeout (${pending.size} pending)`)
}

async function main() {
  // The server attaches asynchronously; initialize is the readiness probe.
  const initPromise = request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-annotations-audit", version: "1" } })
  await pump()
  const init = await initPromise
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  await wait(200)
  const listPromise = request("tools/list", {})
  await pump()
  const list = await listPromise

  const calls = []
  async function call(name, args) {
    const started = now()
    const p = request("tools/call", { name, arguments: args })
    await pump()
    const frame = await p
    const elapsed = now() - started
    const result = frame.result ?? {}
    const text = (result.content ?? []).map((c) => c.text ?? "").join("\n")
    let parsed = null
    try { parsed = JSON.parse(text) } catch {}
    const record = {
      tool: name,
      args,
      isError: result.isError === true,
      text,
      parsed,
      elapsedMs: round(elapsed),
      rawResultBytes: Buffer.byteLength(text),
    }
    calls.push(record)
    return record
  }

    const checks = []
  const check = (id, description, ok, detail) => checks.push({ id, description, ok: ok === true, detail: detail === undefined ? null : detail })

  // ── Phase A: declared absence before any note exists ────────────────────────
  const a = {}
  for (const [id, args] of [
    ["A1", {}],
    ["A2", { symbol: "Widget" }],
    ["A3", { path: "src/alpha.ts" }],
    ["A4", { path: "src/alpha.ts", includeNameLevel: true }],
    ["A5", { symbol: "Widget", path: "src/alpha.ts" }],
    ["A6", { target: "Widget" }],
    ["A7", { query: "Widget" }],
  ]) {
    const res = await call("bb_annotations", args)
    res.id = id
    a[id] = res
  }

  // ── Phase W: write the notes the read matrix filters ───────────────────────
  const writes = [
    ["W1", { symbol: "Widget", body: "name-level note about Widget" }],
    ["W2", { symbol: "Widget", path: "src/alpha.ts", body: "alpha copy of Widget" }],
    ["W3", { symbol: "buildThing", path: "src/alpha.ts", body: "buildThing note in alpha" }],
    ["W4", { symbol: "buildThing", path: "src/gamma.ts", body: "buildThing note in gamma" }],
    ["W5", { symbol: "duplicate", path: "src/alpha.ts", body: "duplicate note in alpha" }],
    ["W6", { symbol: "duplicate", path: "src/beta.ts", body: "duplicate note in beta" }],
    ["W7", { symbol: "Widget.render", body: "qualified-name note about Widget.render" }],
    ["W8", { symbol: "ghostSymbol", body: "note on a name the index never publishes" }],
    ["W9", { symbol: "layout", path: "./src/alpha.ts", body: "dot-prefixed path write" }],
    ["W10", { symbol: "Gadget", path: join(WORKSPACE, "src", "beta.ts"), body: "absolute-path write" }],
  ]
  const w = {}
  for (const [id, args] of writes) {
    const res = await call("bb_annotate", args)
    res.id = id
    w[id] = res
  }

  // ── Phase R: reads against the written store ──────────────────────────────
  const reads = [
    ["R1", { symbol: "Widget" }],
    ["R2", { symbol: "Widget", path: "src/alpha.ts" }],
    ["R3", { symbol: "Widget.render" }],
    ["R4", { symbol: "render" }],
    ["R5", { symbol: "ghostSymbol" }],
    ["R6", { path: "src/alpha.ts" }],
    ["R7", { path: "src/alpha.ts", includeNameLevel: true }],
    ["R8", { path: "./src/alpha.ts" }],
    ["R9", { path: join(WORKSPACE, "src", "alpha.ts") }],
    ["R10", { path: "src/alpha.ts", symbol: "duplicate" }],
    ["R11", {}],
    ["R12", { limit: 3 }],
    ["R13", { limit: 200 }],
    ["R14", { symbol: "duplicate" }],
    ["R15", { path: "src/beta.ts" }],
    ["R16", { symbol: "buildThing" }],
    ["R17", { symbol: "Gadget", path: "src/beta.ts" }],
    ["R18", { symbol: "nope-not-indexed" }],
    ["R19", { path: "src/gamma.ts" }],
    ["R20", { symbol: "   " }],
  ]
  const R = {}
  for (const [id, args] of reads) {
    const res = await call("bb_annotations", args)
    res.id = id
    R[id] = res
  }

  // ── Phase X: refusals the descriptor/contract promises ────────────────────
  const refusals = [
    ["X1", { limit: 0 }],
    ["X2", { limit: 201 }],
    ["X3", { limit: -1 }],
    ["X4", { limit: "5" }],
    ["X5", { limit: 1.5 }],
    ["X6", { bogus: 1 }],
    ["X7", { symbol: "Widget", target: "Other" }],
    ["X8", { path: 5 }],
    ["X9", { includeNameLevel: "true" }],
  ]
  const X = {}
  for (const [id, args] of refusals) {
    const res = await call("bb_annotations", args)
    res.id = id
    X[id] = res
  }

  // ── Checks: written from the declared contract ────────────────────────────
  const rowsOf = (res) => (Array.isArray(res?.parsed?.annotations) ? res.parsed.annotations : [])
  const names = (res) => rowsOf(res).map((row) => row.symbol_name)
  const hasError = (res) => res.isError === true && !res.parsed

  // Absence, all three shapes, declared and never an error.
  for (const [id, noteFragment] of [["A1", "no annotations stored for this project yet"], ["A2", "no annotations stored for 'Widget'"], ["A3", "no annotations stored for 'src/alpha.ts'"], ["A4", "no annotations stored for 'src/alpha.ts'"], ["A5", "no annotations stored for 'Widget' in 'src/alpha.ts'"]]) {
    const res = a[id] ?? R[id]
    check(id, `declared absence (${noteFragment})`, res.isError === false && res.parsed?.declaredAbsent === true && res.parsed?.count === 0 && res.parsed?.totalCountIfKnown === 0 && String(res.parsed?.absenceNote ?? "").includes(noteFragment), { text: res.text.slice(0, 240) })
  }
  check("A6", "symbol alias `target` is accepted and normalized", a.A6.isError === false && a.A6.parsed?.symbol === "Widget", a.A6.parsed?.symbol)
  check("A7", "symbol alias `query` is accepted and normalized", a.A7.isError === false && a.A7.parsed?.symbol === "Widget", a.A7.parsed?.symbol)

  // Writes must land in the store they claim.
  const stored = (id) => w[id]?.parsed?.annotation
  check("W1", "name-level write stores a NULL path", stored("W1")?.symbol_path === null && w.W1.parsed?.stored === true)
  check("W2", "file-scoped write stores the canonical relative path", stored("W2")?.symbol_path === "src/alpha.ts", stored("W2")?.symbol_path)
  check("W9", "dot-prefixed write path canonicalizes to the index spelling", stored("W9")?.symbol_path === "src/alpha.ts", stored("W9")?.symbol_path)
  check("W10", "absolute write path canonicalizes to the index spelling", stored("W10")?.symbol_path === "src/beta.ts", stored("W10")?.symbol_path)
  check("W7", "qualified-name write is stored", stored("W7")?.symbol_name === "Widget.render" && stored("W7")?.symbol_path === null, stored("W7")?.symbol_name)

  // Symbol / path / mixed filters.
  check("R1", "symbol name returns the name-level note and the file-scoped note", names(R.R1).filter((n) => n === "Widget").length === 2 && R.R1.parsed?.count === 2, names(R.R1))
  check("R2", "symbol+path returns that file's copy plus the name-level note about the symbol", R.R2.parsed?.count === 2 && names(R.R2).every((n) => n === "Widget"), names(R.R2))
  check("R3", "contract: reading by a symbol's QUALIFIED name finds the note written under it", names(R.R3).includes("Widget.render") && R.R3.parsed?.count >= 1, { observed: names(R.R3), text: R.R3.text.slice(0, 200) })
  check("R4", "contract: reading by a simple name finds notes written under its qualified name", names(R.R4).includes("Widget.render"), { observed: names(R.R4) })
  check("R5", "unindexed name falls back to the literal stored name", names(R.R5).includes("ghostSymbol") && R.R5.parsed?.count === 1, names(R.R5))
  check("R6", "path-only read returns that file's own notes and not the project's name-level notes", R.R6.parsed?.count === 4 && rowsOf(R.R6).every((row) => row.symbol_path === "src/alpha.ts"), { count: R.R6.parsed?.count, paths: rowsOf(R.R6).map((x) => x.symbol_path) })
  check("R7", "includeNameLevel adds the name-level notes to a path-only read", R.R7.parsed?.count === 7 && rowsOf(R.R7).filter((row) => row.symbol_path === null).length === 3, { count: R.R7.parsed?.count })
  check("R8", "dot-prefixed read path is canonicalized before filtering", R.R8.parsed?.count === R.R6.parsed?.count && R.R8.parsed?.path === "src/alpha.ts", { count: R.R8.parsed?.count, path: R.R8.parsed?.path })
  check("R9", "absolute read path is canonicalized before filtering", R.R9.parsed?.count === R.R6.parsed?.count && R.R9.parsed?.path === "src/alpha.ts", { count: R.R9.parsed?.count, path: R.R9.parsed?.path })
  check("R10", "symbol+path selects exactly that file's copy", R.R10.parsed?.count === 1 && rowsOf(R.R10)[0]?.symbol_path === "src/alpha.ts", { count: R.R10.parsed?.count })
  check("R11", "project-wide read returns every note with its true total", R.R11.parsed?.count === 10 && R.R11.parsed?.totalCountIfKnown === 10 && R.R11.parsed?.truncated === false, { count: R.R11.parsed?.count, total: R.R11.parsed?.totalCountIfKnown })
  check("R12", "limit truncation is declared with a true total and a reason", R.R12.parsed?.count === 3 && R.R12.parsed?.totalCountIfKnown === 10 && R.R12.parsed?.truncated === true && String(R.R12.parsed?.truncationReason ?? "").includes("limit 3"), { count: R.R12.parsed?.count, total: R.R12.parsed?.totalCountIfKnown, reason: R.R12.parsed?.truncationReason })
  check("R13", "limit at the declared cap is a complete page", R.R13.parsed?.count === 10 && R.R13.parsed?.truncated === false, { count: R.R13.parsed?.count })
  check("R14", "symbol name shared by two files returns both files' notes", R.R14.parsed?.count === 2, names(R.R14))
  check("R15", "path-only read of a second file is independent", R.R15.parsed?.count === 2 && rowsOf(R.R15).every((row) => row.symbol_path === "src/beta.ts"), { count: R.R15.parsed?.count })
  check("R16", "symbol name declared in two files returns both", R.R16.parsed?.count === 2, names(R.R16))
  check("R17", "symbol+path narrows a multi-file name to one file", R.R17.parsed?.count === 1, { count: R.R17.parsed?.count })
  check("R18", "absence for an unindexed, unannotated name is declared", R.R18.parsed?.declaredAbsent === true && R.R18.parsed?.count === 0 && R.R18.isError === false)
  check("R19", "path-only read stays scoped to one file", R.R19.parsed?.count === 1, { count: R.R19.parsed?.count })
  check("R20", "blank symbol is treated as omitted (project-wide read)", R.R20.parsed?.symbol === null && R.R20.parsed?.count === 10, { symbol: R.R20.parsed?.symbol, count: R.R20.parsed?.count })

  // Deterministic ordering: writes happened more than a millisecond apart, so
  // time_updated DESC must show the last write first and the first write last.
  check("R11-order", "project-wide rows are ordered newest-first deterministically", rowsOf(R.R11).length === 10 && rowsOf(R.R11)[0]?.symbol_name === "Gadget" && rowsOf(R.R11)[9]?.symbol_name === "Widget", { first: rowsOf(R.R11)[0]?.symbol_name, last: rowsOf(R.R11)[9]?.symbol_name })

  // Boundary options.
  check("X1", "limit 0 is a declared refusal", hasError(X.X1) && /between 1 and 200/.test(X.X1.text), X.X1.text.slice(0, 160))
  check("X2", "limit above the declared cap is a declared refusal", hasError(X.X2) && /between 1 and 200/.test(X.X2.text), X.X2.text.slice(0, 160))
  check("X3", "negative limit is a declared refusal naming the rule", hasError(X.X3) && /limit/i.test(X.X3.text) && /(non-negative|between 1 and 200)/.test(X.X3.text), X.X3.text.slice(0, 160))
  check("X4", "limit of the wrong JSON type is a declared refusal", hasError(X.X4), X.X4.text.slice(0, 160))
  check("X6", "unknown option is refused and the accepted options are named", hasError(X.X6) && /unknown or irrelevant options: bogus/.test(X.X6.text) && /accepted options/.test(X.X6.text), X.X6.text.slice(0, 240))
  check("X7", "conflicting alias and canonical symbol is refused", hasError(X.X7) && /aliases with different values/.test(X.X7.text), X.X7.text.slice(0, 240))
  check("X8", "wrong JSON type for path is refused", hasError(X.X8), X.X8.text.slice(0, 160))
  check("X9", "wrong JSON type for includeNameLevel is refused", hasError(X.X9), X.X9.text.slice(0, 160))
  check("X5", "fractional limit is either refused with a named rule or answers the floored page", X.X5.isError === true ? /limit/i.test(X.X5.text) : (X.X5.parsed?.count === 1 && X.X5.parsed?.isError !== true), { isError: X.X5.isError, text: X.X5.text.slice(0, 200), count: X.X5.parsed?.count })

  // Tool list contract: the tool is advertised with a description and schema.
  const listed = (list.result?.tools ?? []).find((tool) => tool.name === "bb_annotations")
  check("L1", "tools/list advertises bb_annotations with its schema", Boolean(listed) && typeof listed.description === "string" && listed.description.includes("totalCountIfKnown"), listed ? Object.keys(listed.inputSchema?.properties ?? {}) : null)
  check("L2", "stdout carries JSON-RPC frames only (no pollution)", nonJsonStdout.length === 0, nonJsonStdout.slice(0, 2))
  check("L3", "the paired write door stores the rows the read door reports", Object.values(w).every((res) => res.parsed?.stored === true), Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v.parsed?.stored ?? v.isError])))

  const after = hashSet()

  const out = {
    schemaVersion: 1,
    tool: "bb_annotations",
    phase: "Phase A audit",
    measuredAt: new Date().toISOString(),
    currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    door: {
      command: "node validation/tools/bb_annotations/work/mcp-door.mjs",
      childCommand: `npx tsx validation/tools/bb_annotations/work/mcp-server-child.mts ${WORKSPACE}`,
      env: { BB_DATA_DIR: DATA, BB_NO_AUTO_REFRESH: "1" },
      protocolVersion: "2024-11-05",
      serverInfo: init.result?.serverInfo ?? null,
    },
    workspace: WORKSPACE,
    projectId: PROJECT,
    storeBefore: before,
    storeAfter: after,
    toolsAdvertised: (list.result?.tools ?? []).map((tool) => tool.name),
    calls,
    checks,
    summary: {
      checks: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      failedIds: checks.filter((c) => !c.ok).map((c) => c.id),
    },
    stderrTail: stderr.slice(-4000),
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify({ out: OUT, summary: out.summary, failed: checks.filter((c) => !c.ok) }, null, 2))
  child.kill()
  await new Promise((resolve) => child.once("exit", resolve))
  if (out.summary.failed > 0) process.exitCode = 2
}

try {
  await main()
} catch (error) {
  console.error(error)
  child.kill()
  process.exitCode = 1
}
