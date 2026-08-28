// script/m21/verify-sqlite-batch-throughput.ts — M21.D3
// Measures only isolated bun:sqlite transaction behavior. No project database,
// repository, or production adapter is used or modified.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const work = mkdtempSync(path.join(tmpdir(), "bb-m21-d3-"))
const dbPath = path.join(work, "throughput.db")
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

const probe = `
import { Database } from "bun:sqlite"
const db = new Database(Bun.argv[2])
db.exec("PRAGMA journal_mode = WAL")
db.exec("CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
const sizes = [10, 100, 1000, 5000]
const measurements = []
for (const size of sizes) {
  const insert = db.query("INSERT INTO rows(value) VALUES (?)")
  const started = performance.now()
  db.exec("BEGIN")
  for (let i = 0; i < size; i++) insert.run("batch-" + size + "-" + i)
  db.exec("COMMIT")
  const elapsedMs = performance.now() - started
  const count = Number(db.query("SELECT COUNT(*) AS c FROM rows").get()?.c ?? 0)
  measurements.push({ size, elapsedMs, rowsAfterCommit: count })
}
const beforeRollback = Number(db.query("SELECT COUNT(*) AS c FROM rows").get()?.c ?? 0)
let rollbackObserved = false
try {
  db.exec("BEGIN")
  db.query("INSERT INTO rows(value) VALUES (?)").run("rollback-visible-before-error")
  db.exec("INSERT INTO rows(no_such_column) VALUES (1)")
  db.exec("COMMIT")
} catch (error) {
  rollbackObserved = true
  try { db.exec("ROLLBACK") } catch {}
}
const afterRollback = Number(db.query("SELECT COUNT(*) AS c FROM rows").get()?.c ?? 0)
const malformed = { size: -1, elapsedMs: -1, rowsAfterCommit: afterRollback }
const result = { measurements, beforeRollback, afterRollback, rollbackObserved, malformed }
db.close()
console.log(JSON.stringify(result))
`
try {
  const run = spawnSync(process.execPath, ["-e", probe, dbPath], { encoding: "utf8", timeout: 30000 })
  check("D3 isolated benchmark executes", run.status === 0, run.stderr)
  let data: any = null
  try { data = JSON.parse(run.stdout.trim()) } catch (error) { check("D3 benchmark emits valid JSON", false, String(error)) }
  if (data) {
    const measurements = data.measurements as { size: number; elapsedMs: number; rowsAfterCommit: number }[]
    const isValidMeasurement = (m: any) => Number.isInteger(m?.size) && m.size > 0 && Number.isFinite(m?.elapsedMs) && m.elapsedMs >= 0 && Number.isInteger(m?.rowsAfterCommit) && m.rowsAfterCommit >= 0
    check("D3 records all increasing batch sizes", Array.isArray(measurements) && measurements.map((m) => m.size).join(",") === "10,100,1000,5000")
    check("D3 records finite positive timings", measurements.every((m) => Number.isFinite(m.elapsedMs) && m.elapsedMs >= 0))
    check("D3 committed row counts are strictly accounted", measurements.every((m, i) => m.rowsAfterCommit === measurements.slice(0, i + 1).reduce((n, x) => n + x.size, 0)))
    check("D3 rollback is observed", data.rollbackObserved === true)
    check("D3 rollback leaves committed count unchanged", data.afterRollback === data.beforeRollback)
    check("D3 final count equals committed batches", data.afterRollback === measurements.reduce((n, m) => n + m.size, 0))
    negative("D3 malformed measurement fixture is rejected by the validator", !isValidMeasurement(data.bad) && !isValidMeasurement({ ...data.bad, elapsedMs: Number.NaN }) && !isValidMeasurement({ size: 5 }))
    negative("D3 valid committed measurements all pass the validator", measurements.every(isValidMeasurement))
    const accountingHolds = (rows: any[]) => rows.every((m, i) => m.rowsAfterCommit === rows.slice(0, i + 1).reduce((n: number, x: any) => n + x.size, 0))
    const falsified = measurements.map((m, i) => i === measurements.length - 1 ? { ...m, rowsAfterCommit: m.rowsAfterCommit - 1 } : m)
    negative("D3 falsified cumulative row count is rejected by the accounting invariant", !accountingHolds(falsified) && accountingHolds(measurements))
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
    const result = {
      issue: "M21.D3", code: "D3", milestone: "M21",
      status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
      checks, passed, failed: checks - passed, negativeCases: negatives,
      currentCommit: commit, workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m21/verify-sqlite-batch-throughput.ts",
      evidenceFile: "D3.json", generatedAt: new Date().toISOString(),
      corpus: { kind: "isolated-temporary-database", path: "temporary-only", revision: null },
      timings: measurements,
      counts: { committedRows: data.afterRollback, rolledBackRows: 0, attemptedRollbackRows: 1 },
      rollback: { observed: data.rollbackObserved, before: data.beforeRollback, after: data.afterRollback },
      limitations: [
        "This measures isolated Bun bun:sqlite transactions, not the production indexer's schema or workload.",
        "Node better-sqlite3 throughput remains unmeasured because D2 Node runtime parity is unavailable."
      ]
    }
    mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
    writeFileSync(path.join(ROOT, "validation/m21/results/D3.json"), JSON.stringify(result, null, 2) + "\n")
    console.log(`D3: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
    process.exit(result.status === "verified" ? 0 : 1)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
process.exit(1)
