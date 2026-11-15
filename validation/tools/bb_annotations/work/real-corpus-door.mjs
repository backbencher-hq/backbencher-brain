// validation/tools/bb_annotations/work/real-corpus-door.mjs
//
// REAL-CORPUS leg, part 2: for each indexed repository, write and read back
// annotations through the REAL MCP stdio door (a spawned child running the
// product's startMcpServer). Absence is asked BEFORE any write; then the write
// door stores three notes; then the read matrix runs, including the
// qualified-name read-back, path canonicalization and limit truncation. The
// default call is measured over five warm runs.
//
// Run: BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/real-corpus-door.mjs
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const require = createRequire(import.meta.url)
const facts = JSON.parse(readFileSync(join(HERE, "..", "raw", "real-corpus-facts.json"), "utf8"))
const DATA_DIR = facts.dataDir
const RUNS = 5
const now = () => Number(process.hrtime.bigint()) / 1e6
const round = (n) => Math.round(n * 1000) / 1000
const stats = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
  return { p50Ms: round(at(50)), p95Ms: round(at(95)), minMs: round(sorted[0]), maxMs: round(sorted[sorted.length - 1]) }
}

async function door(workspace, calls) {
  const child = spawn("npx", ["tsx", join(HERE, "mcp-server-child.mts"), workspace], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
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
    const deadline = Date.now() + 240000
    let seen = 0
    while (pending.size > 0 && Date.now() < deadline) {
      for (let i = seen; i < frames.length; i++) {
        const frame = frames[i]
        if (frame && typeof frame.id === "number" && pending.has(frame.id)) { pending.get(frame.id)(frame); pending.delete(frame.id) }
      }
      seen = frames.length
      if (pending.size > 0) await wait(25)
    }
    if (pending.size > 0) throw new Error(`MCP door did not answer ${pending.size} request(s) within 240 s`)
  }
  const results = []
  try {
    const init = request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-annotations-real-corpus", version: "1" } })
    await drain(); await init
    send({ jsonrpc: "2.0", method: "notifications/initialized" })
    await wait(150)
    for (const item of calls) {
      const runs = []
      const times = item.runs ?? 1
      let last = null
      for (let run = 0; run < times; run++) {
        const started = now()
        const p = request("tools/call", { name: item.tool, arguments: item.args })
        await drain()
        const frame = await p
        const elapsed = now() - started
        const text = (frame?.result?.content ?? []).map((c) => c.text ?? "").join("\n")
        let parsed = null
        try { parsed = JSON.parse(text) } catch {}
        last = { isError: frame?.result?.isError === true, text, parsed, elapsedMs: round(elapsed) }
        if (times > 1) runs.push(elapsed)
        // Only the first run of a latency subject contributes an answer shape;
        // repeats exist to warm and time the call.
        if (times > 1 && run > 0) last.text = last.text.slice(0, 1200)
      }
      results.push({ id: item.id, tool: item.tool, args: item.args, ...last, runs: runs.map(round) })
    }
  } finally {
    child.kill()
    await new Promise((resolve) => child.once("exit", resolve))
    await wait(250)
  }
  return { results, nonJson, stderrTail: stderr.slice(-1500) }
}

const out = {
  schemaVersion: 1,
  tool: "bb_annotations",
  leg: "REAL CORPUS read-back through the real MCP stdio door (part 2 of 2)",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  environment: { node: process.version, cpus: cpus().length, loadavg: readFileSync("/proc/loadavg", "utf8").trim() },
  dataDir: DATA_DIR,
  corpusRoot: facts.corpusRoot,
  commands: {
    index: facts.command,
    door: "BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/real-corpus-door.mjs",
    doorChild: "npx tsx validation/tools/bb_annotations/work/mcp-server-child.mts <corpus>",
    env: { BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
    rules: ["isolated BB_DATA_DIR", "real MCP stdio door (spawned startMcpServer child)", "the shared store is never opened", "absence asked before any write"],
  },
  corpora: {},
}

const Database = require("better-sqlite3")

for (const [name, fact] of Object.entries(facts.corpora)) {
  const { subject, plain, workspace } = fact
  // A file where the subject name is actually declared (non-test code file), so a
  // file-scoped note is scoped to a file the index knows.
  const ro = new Database(fact.database.path, { readonly: true, fileMustExist: true })
  const declaredIn = (symbolName) => (ro.prepare(
    `SELECT f.relative_path AS relative_path FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.name = ? AND f.is_test_file = 0 AND f.language = ?
     ORDER BY f.relative_path LIMIT 1`,
  ).get(fact.projectId, symbolName, fact.codeLanguage))?.relative_path
    ?? (ro.prepare(
      `SELECT f.relative_path AS relative_path FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id = ? AND s.name = ? ORDER BY f.relative_path LIMIT 1`,
    ).get(fact.projectId, symbolName))?.relative_path
  const plainFile = declaredIn(plain.name)
  const subjectName = subject ? subject.name : plain.name
  const subjectPath = subject ? subject.relative_path : plainFile
  const qualifiedNameLeg = subject
    ? { applicable: true, subjectName, subjectQualified: subject.qualified, secondNameFormRows: fact.secondNameFormRows }
    : {
        applicable: false,
        reason: `the index publishes NO symbol whose qualified_name differs from its name in ${fact.codeLanguage} (measured secondNameFormRows=${fact.secondNameFormRows}), so there is no natural qualified-name read-back on this corpus; the leg is declared not applicable rather than fabricated`,
      }
  const writes = [
    { id: "W-name-level", tool: "bb_annotate", args: { symbol: plain.name, body: `audit note on ${plain.name} (name-level, ${name})` } },
    ...(subject ? [{ id: "W-qualified", tool: "bb_annotate", args: { symbol: subject.qualified, body: `audit note under the qualified name ${subject.qualified}` } }] : []),
    { id: "W-file-scoped", tool: "bb_annotate", args: { symbol: subjectName, path: subjectPath, body: `audit note on ${subjectName} scoped to ${subjectPath}` } },
  ]
  const absence = [
    { id: "A-project-wide-absence", tool: "bb_annotations", args: {} },
    { id: "A-symbol-absence", tool: "bb_annotations", args: { symbol: "bb-audit-name-that-does-not-exist" } },
    { id: "A-path-absence", tool: "bb_annotations", args: { path: subjectPath } },
  ]
  const reads = [
    { id: "R-symbol-plain", tool: "bb_annotations", args: { symbol: plain.name } },
    { id: "R-symbol-subject-simple", tool: "bb_annotations", args: { symbol: subjectName } },
    ...(subject ? [{ id: "R-symbol-qualified", tool: "bb_annotations", args: { symbol: subject.qualified } }] : []),
    { id: "R-path", tool: "bb_annotations", args: { path: subjectPath } },
    { id: "R-path-name-level", tool: "bb_annotations", args: { path: subjectPath, includeNameLevel: true } },
    { id: "R-path-dot-prefixed", tool: "bb_annotations", args: { path: `./${subjectPath}` } },
    { id: "R-all", tool: "bb_annotations", args: {} },
    { id: "R-limit-1", tool: "bb_annotations", args: { limit: 1 } },
    { id: "R-limit-200", tool: "bb_annotations", args: { limit: 200 } },
    { id: "R-default-latency", tool: "bb_annotations", args: {}, runs: RUNS },
    { id: "X-limit-500", tool: "bb_annotations", args: { limit: 500 } },
    { id: "X-alias-target", tool: "bb_annotations", args: { target: plain.name } },
    { id: "X-unknown-option", tool: "bb_annotations", args: { symbol: plain.name, bogus: 1 } },
  ]
  ro.close()
  const run = await door(workspace, [...absence, ...writes, ...reads])
  const byId = (id) => run.results.find((r) => r.id === id)
  const latency = byId("R-default-latency")
  const readsOut = run.results.filter((r) => r.tool === "bb_annotations").map((r) => ({
    id: r.id,
    args: r.args,
    isError: r.isError,
    text: r.text.slice(0, 900),
    count: r.parsed?.count,
    totalCountIfKnown: r.parsed?.totalCountIfKnown,
    truncated: r.parsed?.truncated,
    truncationReason: r.parsed?.truncationReason ?? null,
    declaredAbsent: r.parsed?.declaredAbsent,
    absenceNote: r.parsed?.absenceNote ?? null,
    path: r.parsed?.path,
    symbol: r.parsed?.symbol,
    rows: (r.parsed?.annotations ?? []).map((row) => ({ symbol_name: row.symbol_name, symbol_path: row.symbol_path, author_class: row.author_class, tool_identity: row.tool_identity, body: row.body.slice(0, 90) })),
  }))
  out.corpora[name] = {
    ...fact,
    subjectName,
    subjectPath,
    plainFile,
    qualifiedNameLeg,
    writes: run.results.filter((r) => r.tool === "bb_annotate").map((r) => ({ id: r.id, args: r.args, isError: r.isError, stored: r.parsed?.stored, annotation: r.parsed?.annotation, surfacing: r.parsed?.surfacing })),
    reads: readsOut,
    defaultCallLatency: latency ? { runs: latency.runs, ...stats(latency.runs), bytes: latency.text.length } : null,
    nonJsonStdout: run.nonJson,
    stderrTail: run.stderrTail,
  }
  // Write the aggregate after each corpus so a later corpus cannot lose an
  // earlier corpus's evidence.
  writeFileSync(join(HERE, "..", "REAL-CORPUS.json"), JSON.stringify(out, null, 2) + "\n")
  const qualifiedRead = byId("R-symbol-qualified")
  console.log(JSON.stringify({
    corpus: name,
    population: { files: fact.population.files, symbols: fact.population.symbols, relationships: fact.population.relationships },
    subject: subject ?? { name: subjectName, file: subjectPath },
    qualifiedNameLeg,
    absence: readsOut.filter((r) => r.id.startsWith("A-")).map((r) => ({ id: r.id, declaredAbsent: r.declaredAbsent, note: r.absenceNote })),
    reads: readsOut.filter((r) => r.id.startsWith("R-") && r.id !== "R-default-latency").map((r) => ({ id: r.id, count: r.count, total: r.totalCountIfKnown, truncated: r.truncated, path: r.path })),
    qualifiedReadRows: qualifiedRead?.parsed?.annotations?.length ?? null,
    latency: out.corpora[name].defaultCallLatency,
  }, null, 1))
}

console.log("wrote REAL-CORPUS.json")
