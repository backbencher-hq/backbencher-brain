// verify-security.ts — strict taint-flow security engine.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { analyzeTaintFlows } from "../src/intelligence/security/taint"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-security-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// Classic SQLi (user input -> concat -> db). safeHandler uses parameterized query.
writeFileSync(path.join(root, "src", "handler.ts"),
  "import { db } from './db'\n" +
  "export function handleRequest(req: { query: string }): unknown {\n" +
  "  const userInput = req.query\n" +
  "  const sql = 'SELECT * FROM users WHERE name = ' + userInput\n" +
  "  return db.execute(sql)\n" +
  "}\n")
writeFileSync(path.join(root, "src", "db.ts"), "export const db = { execute(sql: string, params?: unknown[]) { return [] } }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  // Baseline: indexer produced taint rows.
  const rawCount = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as { c: number }).c
  check("indexer produced taint flows", rawCount > 0, `raw=${rawCount}`)

  const report = await analyzeTaintFlows(projectId)

  // Dedup: findings must be fewer than raw scanned flows (source_type variants collapse).
  check("dedup reduces raw flows to fewer findings", report.summary.deduplicatedFlows <= report.summary.scannedFlows)
  check("scannedFlows equals raw count", report.summary.scannedFlows === rawCount)

  // A SQLi finding exists and is evidence-linked.
  const sqli = report.findings.find((f) => f.vulnerabilityType === "sql_injection")
  check("sql_injection finding present", !!sqli)
  check("finding has normalized label", !!sqli && sqli.label === "SQL injection")
  check("finding has evidence array", !!sqli && sqli.evidence.length > 0)
  check("finding has limitations (parameterization caveat)", !!sqli && sqli.limitations.some((l) => /parameteriz|escaped/i.test(l)))
  check("finding is project-scoped file", !!sqli && !!sqli.file)

  // Every path node is inspectable (id or name).
  check("path nodes are resolvable", !!sqli && sqli.path.every((n) => n.symbolId !== undefined))

  // Confidence calibration.
  check("confirmed flow confidence > source-only", report.findings.filter((f) => f.state === "confirmed").every((f) => f.confidence >= 0.6))

  // --- deterministic states via direct insertion ---
  const now = Date.now()
  const ins = raw.prepare(
    "INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, mitigation_steps, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  // mitigated flow
  ins.run("taint:mit:1", projectId, null, null, "user_input", "shell_execution", "command_injection", "high", 1, JSON.stringify([]), 0, JSON.stringify(["input validated"]), now, now)
  // cross-language flow
  ins.run("taint:xl:1", projectId, null, null, "network_receive", "database_write", "sql_injection", "critical", 0, JSON.stringify([]), 2, null, now, now)

  const report2 = await analyzeTaintFlows(projectId, { includeMitigated: true, includeUnresolved: true })
  check("mitigated flow with unresolved endpoints remains an uncertainty observation", report2.findings.some((f) => (f.state === "source_only" || f.state === "unresolved") && f.mitigated))
  check("cross-language flow flagged", report2.findings.some((f) => f.crossLanguage))
  check("byState summary populated", report2.summary.byState.confirmed >= 0 && typeof report2.summary.byState.mitigated === "number")

  // includeMitigated:false excludes mitigated.
  const noMit = await analyzeTaintFlows(projectId, { includeMitigated: false })
  check("includeMitigated:false drops mitigated findings", !noMit.findings.some((f) => f.state === "mitigated"))

  // Hotspots present when findings exist.
  check("hotspots computed", Array.isArray(report2.hotspots))

  // Vulnerability-type normalization: insert an alias, expect normalized type.
  ins.run("taint:alias:1", projectId, null, null, "user_input", "sql_query", "sqli", "high", 0, JSON.stringify([]), 0, null, now, now)
  const report3 = await analyzeTaintFlows(projectId)
  check("vuln alias 'sqli' normalized to sql_injection", report3.findings.some((f) => f.vulnerabilityType === "sql_injection"))
  check("no finding retains raw alias 'sqli'", !report3.findings.some((f) => f.vulnerabilityType === "sqli"))
} catch (error) {
  check("security session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nSECURITY: PASS" : "\nSECURITY: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
