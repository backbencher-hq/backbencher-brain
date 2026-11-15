// validation/tools/bb_annotations/work/read-immutability.mjs
//
// Phase A audit: does a READ of bb_annotations write anything? Three probes, each
// in a fresh child process so no cached handle hides the open-path behaviour:
//
//   I1  an existing, fully indexed fixture store: hash every db file before and
//       after three reads (symbol, path, project-wide)
//   I2  a project that was never indexed: does asking for annotations CREATE a
//       store (a project directory + brain.db) for it?
//   I3  an existing store whose brain_annotation table was dropped (a legacy
//       database): does the read recreate the table — i.e. run DDL — on a read?
//
// Only this lane's BB_DATA_DIR and fixture copies are used; the shared store and
// the real-corpus indexes are never named.
//
// Run: BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/read-immutability.mjs
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const now = () => Number(process.hrtime.bigint()) / 1e6
const round = (n) => Math.round(n * 1000) / 1000
const sha256 = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null)
const manifest = JSON.parse(readFileSync(join(HERE, "..", "raw", "index-manifest.json"), "utf8"))
const PROBE_PID = manifest.tiers.probe.projectId
const PROBE_WORKSPACE = manifest.tiers.probe.workspace
const PROBE_DB = join(HERE, "..", "bbdata", "projects", PROBE_PID, "brain.db")

function snapshot(projectDir) {
  if (!existsSync(projectDir)) return { exists: false, files: {} }
  const files = {}
  for (const name of readdirSync(projectDir)) {
    const p = join(projectDir, name)
    if (statSync(p).isFile()) files[name] = { bytes: statSync(p).size, sha256: sha256(p), mtimeMs: statSync(p).mtimeMs }
  }
  return { exists: true, files }
}

function treeEntries(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(p).isDirectory()) { out.push(rel + "/"); walk(p, rel) } else out.push(rel)
    }
  }
  walk(dir, "")
  return out
}

// One real MCP stdio session: initialize, tools/list, then the given calls.
async function door(dataDir, workspace, calls) {
  const child = spawn("npx", ["tsx", join(HERE, "mcp-server-child.mts"), workspace], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const frames = []
  const nonJson = []
  let buffer = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString()
    let i
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      try { frames.push(JSON.parse(line)) } catch { nonJson.push(line.slice(0, 200)) }
    }
  })
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let nextId = 1
  const pending = new Map()
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n")
  const request = (method, params) => {
    const id = nextId++
    send({ jsonrpc: "2.0", id, method, params })
    return new Promise((resolve) => pending.set(id, resolve))
  }
  const drain = async () => {
    const deadline = Date.now() + 120000
    let seen = 0
    while (pending.size > 0 && Date.now() < deadline) {
      for (let i = seen; i < frames.length; i++) {
        const frame = frames[i]
        if (frame && typeof frame.id === "number" && pending.has(frame.id)) { pending.get(frame.id)(frame); pending.delete(frame.id) }
      }
      seen = frames.length
      await wait(20)
    }
  }
  const results = []
  try {
    const init = request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-annotations-immutability", version: "1" } })
    await drain()
    await init
    send({ jsonrpc: "2.0", method: "notifications/initialized" })
    await wait(150)
    for (const item of calls) {
      const started = now()
      const p = request("tools/call", { name: item.tool, arguments: item.args })
      await drain()
      const frame = await p
      const text = (frame?.result?.content ?? []).map((c) => c.text ?? "").join("\n")
      let parsed = null
      try { parsed = JSON.parse(text) } catch {}
      results.push({ tool: item.tool, args: item.args, isError: frame?.result?.isError === true, text: text.slice(0, 800), parsed, elapsedMs: round(now() - started) })
    }
  } finally {
    child.kill()
    await new Promise((resolve) => child.once("exit", resolve))
    await wait(200)
  }
  return { results, nonJson, stderrTail: stderr.slice(-2000) }
}

const out = {
  schemaVersion: 1,
  tool: "bb_annotations",
  action: "read-path immutability probes",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  rules: ["fresh child process per probe", "BB_NO_AUTO_REFRESH=1", "only this lane's BB_DATA_DIR is used", "hash every db file before and after"],
  probes: {},
}

// ── I1: existing store, read three ways ─────────────────────────────────────
{
  const dataDir = join(HERE, "..", "bbdata-immut-i1")
  rmSync(dataDir, { recursive: true, force: true })
  const dest = join(dataDir, "projects", PROBE_PID)
  mkdirSync(dest, { recursive: true })
  // Copy the store exactly as the write door left it (db + WAL + shm when present).
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(PROBE_DB + suffix)) cpSync(PROBE_DB + suffix, join(dest, `brain.db${suffix}`))
  }
  const before = snapshot(dest)
  const startTree = treeEntries(dataDir)
  const run = await door(dataDir, PROBE_WORKSPACE, [
    { tool: "bb_annotations", args: { symbol: "Widget" } },
    { tool: "bb_annotations", args: { path: "src/alpha.ts" } },
    { tool: "bb_annotations", args: {} },
  ])
  const after = snapshot(dest)
  out.probes.I1 = {
    question: "does a read move the store?",
    dataDir,
    before,
    after,
    treeBefore: startTree,
    treeAfter: treeEntries(dataDir),
    calls: run.results,
    nonJsonStdout: run.nonJson,
    changedFiles: Object.keys({ ...before.files, ...after.files }).filter((name) => JSON.stringify(before.files[name]) !== JSON.stringify(after.files[name])),
  }
}

// ── I2: a project that was never indexed ────────────────────────────────────
{
  const dataDir = join(HERE, "..", "bbdata-immut-i2")
  rmSync(dataDir, { recursive: true, force: true })
  const workspace = join(HERE, "unindexed-project")
  const before = { dataDirExists: existsSync(dataDir), entries: treeEntries(dataDir) }
  const run = await door(dataDir, workspace, [{ tool: "bb_annotations", args: {} }, { tool: "bb_annotations", args: { symbol: "lonely" } }])
  out.probes.I2 = {
    question: "does asking an unindexed project for annotations CREATE a store for it?",
    dataDir,
    workspace,
    before,
    after: { dataDirExists: existsSync(dataDir), entries: treeEntries(dataDir) },
    createdEntries: treeEntries(dataDir).filter((entry) => !before.entries.includes(entry)),
    calls: run.results,
    nonJsonStdout: run.nonJson,
  }
}

// ── I3: an existing store without the annotation table (legacy database) ────
{
  const dataDir = join(HERE, "..", "bbdata-immut-i3")
  rmSync(dataDir, { recursive: true, force: true })
  const dest = join(dataDir, "projects", PROBE_PID)
  mkdirSync(dest, { recursive: true })
  cpSync(PROBE_DB, join(dest, "brain.db"))
  const seed = new Database(join(dest, "brain.db"), { readonly: false, fileMustExist: true })
  seed.exec("DROP TABLE IF EXISTS brain_annotation")
  seed.close()
  const before = snapshot(dest)
  const run = await door(dataDir, PROBE_WORKSPACE, [{ tool: "bb_annotations", args: {} }])
  const after = snapshot(dest)
  let tableAfter = null
  try {
    const check = new Database(join(dest, "brain.db"), { readonly: true, fileMustExist: true })
    tableAfter = Boolean(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get())
    check.close()
  } catch (error) {
    tableAfter = `unreadable: ${String(error).slice(0, 120)}`
  }
  out.probes.I3 = {
    question: "does a read recreate a dropped annotation table (run DDL) on a legacy database?",
    dataDir,
    before,
    after,
    annotationTableRecreatedByTheRead: tableAfter,
    changedFiles: Object.keys({ ...before.files, ...after.files }).filter((name) => JSON.stringify(before.files[name]) !== JSON.stringify(after.files[name])),
    calls: run.results,
    nonJsonStdout: run.nonJson,
  }
}

const file = join(HERE, "..", "raw", "read-immutability.json")
writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({
  out: file,
  I1: { changedFiles: out.probes.I1.changedFiles, before: Object.keys(out.probes.I1.before.files), after: Object.keys(out.probes.I1.after.files) },
  I2: { createdEntries: out.probes.I2.createdEntries, call: out.probes.I2.calls[0]?.text?.slice(0, 200) },
  I3: { changedFiles: out.probes.I3.changedFiles, tableAfter: out.probes.I3.annotationTableRecreatedByTheRead, call: out.probes.I3.calls[0]?.text?.slice(0, 200) },
}, null, 2))
