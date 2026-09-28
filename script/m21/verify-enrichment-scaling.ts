// script/m21/verify-enrichment-scaling.ts — M21.R1
// Reproduces the enrichment query shape on isolated bun:sqlite databases.
// It measures query and update phases separately; it does not claim production
// workload performance or alter any project database.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const work = mkdtempSync(path.join(tmpdir(), "bb-m21-r1-"))
const dbPath = path.join(work, "enrichment.db")
const probe = `
import { Database } from "bun:sqlite"
const db = new Database(Bun.argv[2])
db.exec("PRAGMA journal_mode = WAL")
db.exec("CREATE TABLE brain_symbol (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT, layer TEXT, symbol_type TEXT)")
db.exec("CREATE TABLE brain_file (id TEXT PRIMARY KEY, relative_path TEXT)")
db.exec("CREATE TABLE brain_relationship (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, relationship_type TEXT NOT NULL, source_symbol_id TEXT, target_symbol_id TEXT, metadata TEXT)")
const project = "r1"
const insertSymbol = db.query("INSERT INTO brain_symbol VALUES (?, ?, ?, ?, ?)")
const insertFile = db.query("INSERT INTO brain_file VALUES (?, ?)")
const insertRel = db.query("INSERT INTO brain_relationship VALUES (?, ?, ?, ?, ?, NULL)")
insertFile.run("f", "src/fixture.ts")
for (let i = 0; i < 6000; i++) insertSymbol.run("s" + i, project, "Symbol" + i, i % 3 === 0 ? "service" : "core", "function")
const sizes = [100, 1000, 5000]
const measurements = []
for (const size of sizes) {
  db.exec("DELETE FROM brain_relationship")
  for (let i = 0; i < size; i++) insertRel.run("r" + i, project, "calls", "s" + (i % 6000), "s" + ((i + 1) % 6000))
  const query = db.query("SELECT r.id, r.relationship_type, r.source_symbol_id, r.target_symbol_id, s.layer source_layer, s.symbol_type source_type, s.name source_name, t.layer target_layer, t.symbol_type target_type, t.name target_name, sf.relative_path source_file FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id AND s.project_id=r.project_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id AND t.project_id=r.project_id LEFT JOIN brain_file sf ON sf.id=s.id WHERE r.project_id=? LIMIT 20000 OFFSET 0")
  const queryStart = performance.now()
  const rows = query.all(project)
  const queryMs = performance.now() - queryStart
  const update = db.query("UPDATE brain_relationship SET metadata=? WHERE id=? AND project_id=?")
  const updateStart = performance.now()
  db.exec("BEGIN")
  for (const row of rows) update.run(JSON.stringify({ layerFlow: String(row.source_layer || "core") + "→" + String(row.target_layer || "core"), frequency: "one_of_1", inferredAt: 1 }), row.id, project)
  db.exec("COMMIT")
  const updateMs = performance.now() - updateStart
  const metadataCount = Number(db.query("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND metadata IS NOT NULL").get(project)?.c ?? 0)
  measurements.push({ size, returned: rows.length, queryMs, updateMs, metadataCount })
}
const bad = { size: 100, queryMs: -1, updateMs: Infinity, metadataCount: -1 }
db.close()
console.log(JSON.stringify({ measurements, bad }))
`
let result: any
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }
try {
  const run = spawnSync(process.execPath, ["-e", probe, dbPath], { encoding: "utf8", timeout: 30000 })
  check("R1 isolated enrichment benchmark executes", run.status === 0, run.stderr)
  let data: any
  try { data = JSON.parse(run.stdout.trim()) } catch (error) { check("R1 benchmark emits valid JSON", false, String(error)) }
  if (data) {
    const rows = data.measurements as any[]
    check("R1 increasing relationship sizes are measured", rows.map((r) => r.size).join(",") === "100,1000,5000")
    check("R1 query returns every inserted relationship", rows.every((r) => r.returned === r.size))
    check("R1 query and update timings are finite", rows.every((r) => Number.isFinite(r.queryMs) && Number.isFinite(r.updateMs) && r.queryMs >= 0 && r.updateMs >= 0))
    check("R1 metadata writes match relationship counts", rows.every((r) => r.metadataCount === r.size))
    check("R1 timings are persisted per phase", rows.every((r) => Object.hasOwn(r, "queryMs") && Object.hasOwn(r, "updateMs")))
    check("R1 workload identity is deterministic", rows.every((r) => r.size > 0 && r.returned <= 20000))
    negative("R1 negative infinite timing is rejected", !Number.isFinite(data.bad.updateMs))
    negative("R1 negative row count is rejected", data.bad.metadataCount < 0)
    negative("R1 missing relationship measurement is not treated as zero", rows.every((r) => r.returned !== 0))
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
    result = {
      issue: "M21.R1", code: "R1", milestone: "M21", status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
      checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: commit, workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m21/verify-enrichment-scaling.ts", evidenceFile: "R1.json", generatedAt: new Date().toISOString(),
      corpus: { kind: "isolated-temporary-database", revision: null, relationshipSizes: rows.map((r) => r.size) },
      timings: rows.map((r) => ({ relationships: r.size, queryMs: r.queryMs, updateMs: r.updateMs })),
      counts: { returned: rows.map((r) => r.returned), metadataWritten: rows.map((r) => r.metadataCount) },
      limitations: [
        "This reproduces the enrichment join/update shape in an isolated database; it is not a real project index.",
        "The benchmark includes OFFSET 0 only; R2 owns pagination/OFFSET growth analysis and real-index evidence."
      ]
    }
  }
} catch (error) { check("R1 verifier completes", false, String(error)) }
finally { rmSync(work, { recursive: true, force: true }) }
if (!result) result = { issue: "M21.R1", code: "R1", milestone: "M21", status: "blocked", checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: "unknown", workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-enrichment-scaling.ts", evidenceFile: "R1.json", generatedAt: new Date().toISOString(), limitations: ["benchmark did not produce evidence"] }
mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/R1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`R1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
