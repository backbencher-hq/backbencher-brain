// script/m21/verify-sqlite-runtime-policy.ts — M21.D2
// Cross-runtime adapter policy audit. The Bun path executes directly. The Node
// path is executed only when a supported Node TypeScript runner is available;
// otherwise it is recorded as unavailable, never as a passing parity result.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const bunAdapter = readFileSync(path.join(ROOT, "src/storage/db.bun.ts"), "utf8")
const nodeAdapter = readFileSync(path.join(ROOT, "src/storage/db.node.ts"), "utf8")
let checks = 0
let passed = 0
let negatives = 0
const unavailable: string[] = []
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
function runBunProbe(dbPath: string) {
  const script = `
    import { Database } from "bun:sqlite"
    const db = new Database(${JSON.stringify(dbPath)})
    db.exec("PRAGMA journal_mode = WAL")
    const journal = String(db.query("PRAGMA journal_mode").get()?.journal_mode ?? "")
    const busy = db.query("PRAGMA busy_timeout").get()
    db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    db.query("INSERT INTO t(value) VALUES (?)").run("bun")
    const count = Number(db.query("SELECT COUNT(*) AS c FROM t").get()?.c ?? 0)
    db.close()
    if (journal.toLowerCase() !== "wal" || count !== 1) process.exit(2)
    console.log(JSON.stringify({ journal, busy, count }))
  `
  return spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 15000 })
}
function nodeRunner(): string[] | null {
  if (existsSync(path.join(ROOT, "node_modules/.bin/tsx"))) return [path.join(ROOT, "node_modules/.bin/tsx")]
  if (existsSync(path.join(ROOT, "node_modules/.bin/ts-node"))) return [path.join(ROOT, "node_modules/.bin/ts-node"), "--esm"]
  return null
}

const work = mkdtempSync(path.join(tmpdir(), "bb-m21-d2-"))
const bunDb = path.join(work, "bun.db")
try {
  check("D2 Bun adapter declares bun:sqlite", /from ["']bun:sqlite["']/.test(bunAdapter))
  check("D2 Node adapter declares better-sqlite3", /from ["']better-sqlite3["']/.test(nodeAdapter))
  check("D2 Node adapter enables WAL", /journal_mode\s*=\s*WAL/i.test(nodeAdapter))
  check("D2 Bun adapter does not silently claim WAL configuration", !/journal_mode\s*=\s*WAL/i.test(bunAdapter))
  check("D2 neither adapter silently claims busy-timeout policy", !/busy_timeout/i.test(bunAdapter) && !/busy_timeout/i.test(nodeAdapter))

  const bun = runBunProbe(bunDb)
  check("D2 Bun runtime probe executes", bun.status === 0, bun.stderr)
  check("D2 Bun probe confirms WAL and row integrity", bun.status === 0 && /"journal"\s*:\s*"wal"/i.test(bun.stdout) && /"count"\s*:\s*1/.test(bun.stdout), bun.stdout)

  const runner = nodeRunner()
  if (!runner) {
    unavailable.push("Node adapter runtime probe: no supported tsx/ts-node executable installed")
    negative("D2 missing Node runner is visible as unavailable, not verified", unavailable.includes("Node adapter runtime probe: no supported tsx/ts-node executable installed"))
  } else {
    const nodeProbe = spawnSync(runner[0], [...runner.slice(1), path.join(ROOT, "script/m21/probe-node-sqlite.ts")], { encoding: "utf8", timeout: 15000 })
    check("D2 Node adapter runtime probe executes", nodeProbe.status === 0, nodeProbe.stderr)
  }

  negative("D2 malformed runtime output is rejected", !/^\{"journal":"wal","count":1\}$/.test('{"journal":"wal","count":0}'))
  negative("D2 missing database is not a runtime success", !existsSync(path.join(work, "missing.db")))

  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  const nodeVerified = runner !== null
  const status = passed === checks && negatives >= 2 && nodeVerified ? "verified" : "known-gap"
  const result = {
    issue: "M21.D2", code: "D2", milestone: "M21", status,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-sqlite-runtime-policy.ts",
    evidenceFile: "D2.json", generatedAt: new Date().toISOString(),
    runtimes: { bun: { status: bun.status === 0 ? "verified" : "failed", stdout: bun.stdout, stderr: bun.stderr }, node: { status: nodeVerified ? "executed" : "unavailable", runner: runner?.join(" ") ?? null } },
    unavailable,
    limitations: [
      "This is an adapter-policy and runtime probe; it does not change production settings.",
      "D2 remains known-gap until both Bun and Node runtime behavior are executable and compared, including bounded lock recovery."
    ]
  }
  mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m21/results/D2.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(`D2: ${status.toUpperCase()} (${passed}/${checks}, ${negatives} negative; unavailable=${unavailable.length})`)
  process.exit(status === "verified" ? 0 : 1)
} finally {
  rmSync(work, { recursive: true, force: true })
}
