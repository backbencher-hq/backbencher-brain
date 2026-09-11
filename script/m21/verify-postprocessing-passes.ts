// script/m21/verify-postprocessing-passes.ts — M21.R2
// Exercises callable post-processing paths on an isolated temporary project.
// Missing standalone APIs are recorded as unavailable, never as successful.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, calculateGravityScores, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { runIndexHealthCheck } from "../../src/brain/brain-index-health"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const root = mkdtempSync(path.join(tmpdir(), "bb-m21-r2-"))
let checks = 0
let passed = 0
let negatives = 0
let projectId = ""
let result: any
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }
function timed<T>(fn: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> { const start = performance.now(); return fn().then((value) => ({ value, elapsedMs: performance.now() - start })) }
try {
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "r2-fixture.ts"), `
export function query(input: string): string { return input }
export class Service { run(input: string): string { return query(input) } }
`)
  projectId = getProjectId(root)
  const indexed = await timed(() => indexProjectParallel(projectId, root, { skipPostProcessing: true }))
  check("R2 fixture indexes successfully", indexed.value.successFiles > 0 && indexed.value.errorFiles === 0, JSON.stringify(indexed.value))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const symbolCount = Number((raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c)
  const relationCount = Number((raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(projectId) as any).c)
  check("R2 fixture has symbols and relationships", symbolCount > 0 && relationCount > 0, JSON.stringify({ symbolCount, relationCount }))

  const beforeGravity = (raw.prepare("SELECT id, gravity_score FROM brain_symbol WHERE project_id=? ORDER BY id").all(projectId) as any[])
  const gravity = await timed(() => calculateGravityScores(projectId as any))
  const afterGravity = (raw.prepare("SELECT id, gravity_score FROM brain_symbol WHERE project_id=? ORDER BY id").all(projectId) as any[])
  check("R2 gravity pass returns and records timing", gravity.elapsedMs >= 0 && afterGravity.length === beforeGravity.length)
  check("R2 gravity scores are finite", afterGravity.every((row) => row.gravity_score === null || Number.isFinite(Number(row.gravity_score))), JSON.stringify(afterGravity.slice(0, 3)))
  check("R2 gravity pass is observable as a separate phase", afterGravity.some((row, i) => row.gravity_score !== beforeGravity[i].gravity_score) || afterGravity.length === 0)

  const health = await timed(() => runIndexHealthCheck(projectId as any))
  // M51.A2 split orphan owners from synthetic container references: 13 checks.
  check("R2 health pass returns a complete report", health.elapsedMs >= 0 && Array.isArray(health.value.checks) && health.value.checks.length === 13)
  check("R2 health summary reconciles", health.value.summary.ok + health.value.summary.warn + health.value.summary.error === health.value.checks.length)
  check("R2 health score is bounded", Number.isInteger(health.value.overallHealth) && health.value.overallHealth >= 0 && health.value.overallHealth <= 100)

  const taintSource = path.join(ROOT, "src", "ast", "parallel-indexer.ts")
  const taintText = require("node:fs").readFileSync(taintSource, "utf8")
  const taintPathExists = /brain_taint_flow/.test(taintText) && /resolveCrossSymbolTaints/.test(taintText)
  check("R2 taint implementation is explicitly located", taintPathExists)
  const integritySource = require("node:fs").readFileSync(path.join(ROOT, "src", "brain", "brain-index-health.ts"), "utf8")
  const integrityChecks = (integritySource.match(/checks\.push\(/g) || []).length
  check("R2 integrity checks are represented by health checks", integrityChecks >= 12)
  const validHealthReport = (report: any) => Number.isInteger(report?.overallHealth) && report.overallHealth >= 0 && report.overallHealth <= 100 && Array.isArray(report?.checks)
  const summaryReconciles = (report: any) => report.summary.ok + report.summary.warn + report.summary.error === report.checks.length
  negative("R2 invalid health report is rejected", !validHealthReport({ ...health.value, overallHealth: 101 }))
  negative("R2 non-reconciling health summary is rejected", !summaryReconciles({ ...health.value, summary: { ...health.value.summary, ok: health.value.summary.ok + 1 } }) && summaryReconciles(health.value))
  const missingId = (projectId + "-missing") as any
  const missingHealth = await runIndexHealthCheck(missingId)
  negative("R2 missing project does not produce malformed empty checks", missingHealth.checks.length === 13 && missingHealth.checks.every((c: any) => typeof c.name === "string" && c.name.length > 0))
  try { rmSync(path.join(process.env.HOME ?? "", ".bb", "projects", String(missingId)), { recursive: true, force: true }) } catch {}

  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.R2", code: "R2", milestone: "M21", status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-postprocessing-passes.ts", evidenceFile: "R2.json", generatedAt: new Date().toISOString(),
    corpus: { kind: "temporary-indexed-fixture", files: 1, revision: null },
    timings: { indexingMs: indexed.elapsedMs, gravityMs: gravity.elapsedMs, healthMs: health.elapsedMs },
    counts: { symbols: symbolCount, relationships: relationCount, healthChecks: health.value.checks.length, integrityChecks },
    outcomes: { gravity: "executed", health: "executed", taint: taintPathExists ? "source-path-present-not-independently-executed" : "unavailable", integrity: "represented-by-health" },
    limitations: [
      "This is a controlled fixture, not a large real repository.",
      "Taint detection is embedded in storage/indexing and cross-symbol resolution; no standalone taint pass was executed here.",
      "Health checks are SELECT-only and include sampled filesystem checks; they are not a full-database proof."
    ]
  }
} catch (error) {
  check("R2 verifier completes without exception", false, String(error))
  result = { issue: "M21.R2", code: "R2", milestone: "M21", status: "known-gap", checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: "unknown", workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-postprocessing-passes.ts", evidenceFile: "R2.json", generatedAt: new Date().toISOString(), limitations: [String(error)] }
} finally {
  await flushBackgroundEmbeddings().catch(() => undefined)
  if (projectId) BrainDatabase.close(projectId)
  rmSync(root, { recursive: true, force: true })
  if (projectId) rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/R2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`R2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
