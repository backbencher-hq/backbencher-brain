// M20.S3 — security history state persistence.
//
// 1. Live observations (source_only/unresolved) are visible in the live
//    response but are EXCLUDED from persisted history by policy.
// 2. Persisted history contains only real findings (confirmed/mitigated);
//    no persisted row has rule="unresolved" or severity="unknown".
// 3. Repeat-run parity: re-running recordRun keeps the same finding count and
//    does not fabricate resolutions.
// 4. CLI and direct handler record the same finding set.
// 5. Persists exact evidence; no auto-pass assertions.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { getAnalysisHistory } from "../../src/intelligence/analysis/run-history"
import { securitySourceFingerprint, securityRelevantWorkingTreeChanges } from "../../src/intelligence/security/evidence"

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) { passed++; console.log(`  ok: ${label}`) }
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handle(input: string): unknown {\n  const sql = 'SELECT * FROM t WHERE name = ' + input\n  return db.query(sql)\n}\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const sym = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'handle' LIMIT 1").get(projectId) as { id: string } | undefined
  check("fixture symbol indexed", !!sym)
  if (sym) {
    // Deterministic taint matrix: 1 confirmed, 1 source_only, 1 unresolved(unknown severity).
    raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
    const now = Date.now()
    const ins = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    ins.run("s3-conf", projectId, sym.id, sym.id, "http_input", "database_write", "sql_injection", "high", 0, JSON.stringify([sym.id]), 0, now, now)
    ins.run("s3-src", projectId, sym.id, null, "http_input", "unresolved", "unknown", "unknown", 0, JSON.stringify([sym.id]), 0, now, now)
    ins.run("s3-unk", projectId, null, sym.id, "unresolved", "shell_execution", "command_injection", "unknown", 0, JSON.stringify([sym.id]), 0, now, now)

    const handler = createToolHandlers().bb_security
    const live = (await handler({ recordRun: true, limit: 10 }, { projectPath: root, projectId } as any)).content[0].text
    check("live: response reports a recorded run", live.includes("recorded run"), live.slice(0, 200))
    check("live: unvalidated sources visible in live output", live.includes("unvalidated") || live.includes("unvalidated input sources"), live.slice(0, 300))

    const history = await getAnalysisHistory(projectId, "security", 10)
    check("history: one completed run", history.runs.length === 1 && history.runs[0].status === "completed", JSON.stringify(history.runs))
    check("history: findingCount equals confirmed findings only (1), not the 3-row matrix", history.runs[0].findingCount === 1, `count=${history.runs[0].findingCount}`)
    negative("history: no persisted finding has rule 'unresolved'", history.findings.every((f) => f.rule !== "unresolved"), history.findings.map((f) => f.rule).join(","))
    negative("history: no persisted finding has severity 'unknown'", history.findings.every((f) => f.severity !== "unknown"), history.findings.map((f) => f.severity).join(","))
    check("history: persisted finding is the confirmed SQLi", history.findings.length === 1 && history.findings[0].rule.includes("SQL injection"), JSON.stringify(history.findings.map((f) => ({ rule: f.rule, severity: f.severity, state: f.state }))))

    // Repeat-run parity.
    await handler({ recordRun: true, limit: 10 }, { projectPath: root, projectId } as any)
    const history2 = await getAnalysisHistory(projectId, "security", 10)
    check("parity: second run keeps same finding count", history2.runs.length === 2 && history2.runs.every((r) => r.findingCount === 1), JSON.stringify(history2.runs.map((r) => r.findingCount)))
    check("parity: finding set unchanged after repeat (no phantom resolution)", history2.findings.length === 1 && history2.findings[0].state === "open", JSON.stringify(history2.findings.map((f) => f.state)))

    // CLI parity: CLI recordRun persists the same single finding.
    const bb = path.resolve("bin/bb")
    const cli = execFileSync("node", [bb, "tool", "bb_security", "--dir", root, "--args", JSON.stringify({ recordRun: true })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    check("CLI: recordRun works", cli.includes("recorded run"), cli.slice(0, 200))
    const cliHist = execFileSync("node", [bb, "tool", "bb_security", "--dir", root, "--args", JSON.stringify({ history: true, limit: 10 })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    const parsed = JSON.parse(cliHist.trim())
    check("CLI: history JSON has runs with findingCount 1", Array.isArray(parsed.runs) && parsed.runs.length === 3 && parsed.runs.every((r: any) => r.findingCount === 1), cliHist.slice(0, 300))
    negative("CLI: history JSON has no unknown-severity findings", parsed.findings.every((f: any) => f.severity !== "unknown"), JSON.stringify(parsed.findings))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = checks - passed
const result = {
  issue: "M20.S3", code: "S3", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-security-history.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Deterministic fixture-level history matrix; real-repository history parity is owned by M20.X2.",
    "History excludes unresolved observations by policy; the live response still surfaces them as unvalidated sources.",
  ],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/S3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? "\nSECURITY S3: PASS" : `\nSECURITY S3: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)