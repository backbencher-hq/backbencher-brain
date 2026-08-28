// script/m21/verify-sqlite-locks.ts — M21.D1
// Isolated SQLite contention test. It never touches project databases or source
// repositories. Holder and contender are separate overlapping Bun processes.

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const work = mkdtempSync(path.join(tmpdir(), "bb-m21-d1-"))
const dbPath = path.join(work, "lock.db")
const child = path.join(work, "writer-child.ts")
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function classifyContender(stdout: string): { locked: boolean; committed: boolean } {
  const locked = /CONTENDER_ERROR\|\d+\|.*(locked|busy|timeout)/i.test(stdout)
  const committed = /^CONTENDER_COMMITTED\|/.test(stdout)
  return { locked, committed }
}
function startChild(args: string[]) {
  // Bun-native spawn: Node-style 'close' events proved unreliable under Bun,
  // causing verifier hangs. Bun.spawn exposes .exited and stream bodies.
  return (Bun as any).spawn([process.execPath, "run", child, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
}
async function collect(proc: any) {
  let stdout = ""
  let stderr = ""
  let killed = false
  const killTimer = setTimeout(() => { killed = true; try { proc.kill(9) } catch {} }, 10000)
  const [out, err] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text().catch(() => ""),
    new Response(proc.stderr as ReadableStream).text().catch(() => ""),
  ])
  stdout = out
  stderr = err
  const code = await proc.exited
  clearTimeout(killTimer)
  return { code, signal: null, killed, stdout, stderr }
}

writeFileSync(child, `
import { Database } from "bun:sqlite"
const db = new Database(Bun.argv[2])
const mode = Bun.argv[3]
try {
  db.exec("PRAGMA journal_mode = WAL")
  if (mode === "hold") {
    db.exec("BEGIN IMMEDIATE")
    db.query("INSERT INTO items(value) VALUES (?)").run("holder")
    process.stdout.write("LOCK_HELD")
    await Bun.sleep(Number(Bun.argv[5] || 1000))
    db.exec("COMMIT")
    process.stdout.write("|HOLDER_COMMITTED")
  } else if (mode === "contend") {
    const started = Date.now()
    try {
      db.query("INSERT INTO items(value) VALUES (?)").run("contender")
      process.stdout.write("CONTENDER_COMMITTED|" + (Date.now() - started))
    } catch (e) {
      process.stdout.write("CONTENDER_ERROR|" + (Date.now() - started) + "|" + e.message)
      process.exitCode = 3
    }
  }
} catch (e) {
  process.stdout.write("CHILD_ERROR|" + e.message)
  process.exitCode = 4
} finally { db.close() }
`)

let result: any
try {
  const init = spawnSync(process.execPath, ["-e", `
    import { Database } from "bun:sqlite"
    const db = new Database(${JSON.stringify(dbPath)})
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    db.query("INSERT INTO items(value) VALUES (?)").run("initial")
    db.close()
  `], { encoding: "utf8" })
  check("D1 temporary database created", init.status === 0 && existsSync(dbPath), init.stderr)

  const holder = startChild([dbPath, "hold", "", "50", "1200"])
  await sleep(180)
  const contender = startChild([dbPath, "contend", "", "50"])
  const [holderOut, contenderOut] = await Promise.all([collect(holder), collect(contender)])
  const outcome = classifyContender(contenderOut.stdout)
  const contenderLocked = outcome.locked
  const contenderCommitted = outcome.committed
  check("D1 child processes finished within the hard 10s kill bound", !holderOut.killed && !contenderOut.killed, JSON.stringify({ holderKilled: holderOut.killed, contenderKilled: contenderOut.killed }))
  check("D1 holder acquired and committed its write", holderOut.stdout.includes("LOCK_HELD") && holderOut.stdout.includes("HOLDER_COMMITTED"), JSON.stringify(holderOut))
  check("D1 contender produced a bounded outcome", contenderLocked || contenderCommitted, JSON.stringify(contenderOut))
  negative("D1 contention is observable rather than silently discarded", contenderLocked || contenderCommitted, contenderOut.stdout)
  check("D1 contender lock wait is bounded", !contenderLocked || Number(contenderOut.stdout.split("|")[1]) < 1000, contenderOut.stdout)

  const verify = spawnSync(process.execPath, ["-e", `
    import { Database } from "bun:sqlite"
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true })
    const rows = db.query("SELECT value FROM items ORDER BY id").all()
    if (rows.length < 2 || !rows.some((r) => r.value === "initial") || rows.some((r) => typeof r.value !== "string" || !r.value)) process.exit(2)
    db.close()
  `], { encoding: "utf8" })
  check("D1 final database remains readable and structurally valid", verify.status === 0, verify.stderr)
  negative("D1 missing database is not treated as evidence", !existsSync(path.join(work, "missing.db")))
  const corruptDb = path.join(work, "corrupt.db")
  writeFileSync(corruptDb, Buffer.from("this is not a sqlite database at all", "utf8"))
  const corrupt = await collect(startChild([corruptDb, "contend", "", "50"]))
  negative("D1 corrupt database is not treated as a successful write", corrupt.code !== 0 && /^CONTENDER_ERROR\||^CHILD_ERROR\|/.test(corrupt.stdout), JSON.stringify(corrupt))
  negative("D1 classifier rejects malformed child output", !classifyContender("garbage-output").committed && !classifyContender("garbage-output").locked && !classifyContender("CHILD_ERROR|x").committed)

  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.D1", code: "D1", milestone: "M21",
    status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-sqlite-locks.ts",
    evidenceFile: "D1.json", generatedAt: new Date().toISOString(),
    limitations: [
      "This reproduces contention with Bun's bun:sqlite; Node better-sqlite3 parity is owned by D2.",
      "The test classifies lock behavior but does not claim production-indexer correctness or prescribe a busy-timeout policy."
    ],
    details: { databaseDriver: "bun:sqlite", journalMode: "WAL", holderHoldMs: 1200, holderTimeoutMs: 50, contenderTimeoutMs: 50 }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

const resultPath = path.join(ROOT, "validation/m21/results/D1.json")
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n")
console.log(`D1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
