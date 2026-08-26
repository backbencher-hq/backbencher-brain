// M20.S1 — security flow evidence and heuristic boundary.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, writeFileSync as persist } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"
import { securityRelevantWorkingTreeChanges, securitySourceFingerprint } from "../../src/intelligence/security/evidence"

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s1-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handle(input: string) { return input }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const symbol = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'handle' LIMIT 1").get(projectId) as { id: string } | undefined
  check("fixture symbol indexed", !!symbol)
  if (symbol) {
    const now = Date.now()
    const insert = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    insert.run("s1-confirmed", projectId, symbol.id, symbol.id, "http_input", "database_write", "sql_injection", "high", 0, JSON.stringify([symbol.id]), 0, now, now)
    insert.run("s1-source-only", projectId, symbol.id, null, "http_input", "unresolved", "unknown", "unknown", 0, JSON.stringify([symbol.id]), 0, now, now)
    insert.run("s1-mitigated-partial", projectId, null, symbol.id, "unresolved", "database_write", "sql_injection", "high", 1, JSON.stringify([symbol.id]), 0, now, now)

    const report = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: true, includeMitigated: true })
    const confirmed = report.findings.find((f) => f.id === "s1-confirmed")
    const sourceOnly = report.findings.find((f) => f.id === "s1-source-only")
    const partialMitigated = report.findings.find((f) => f.id === "s1-mitigated-partial")
    check("confirmed flow resolves both endpoints", confirmed?.state === "confirmed" && !!confirmed.source.file && !!confirmed.sink.file, JSON.stringify(confirmed))
    check("confirmed flow has taint evidence", !!confirmed && confirmed.evidence.some((e) => e.kind === "taint_flow"))
    check("source-only row remains an uncertainty observation", sourceOnly?.state === "source_only", JSON.stringify(sourceOnly))
    negative("partial endpoint row is not classified as confirmed", partialMitigated?.state !== "confirmed", JSON.stringify(partialMitigated))
    negative("partial mitigated row records endpoint uncertainty", partialMitigated?.state === "unresolved" || partialMitigated?.state === "source_only", JSON.stringify(partialMitigated))
    check("uncertain rows carry limitations", [sourceOnly, partialMitigated].filter(Boolean).every((f) => f!.limitations.length > 0))
    const filtered = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: false, includeMitigated: true })
    negative("includeUnresolved=false excludes source-only and unresolved rows", !filtered.findings.some((f) => f.id === "s1-source-only" || f.id === "s1-mitigated-partial"), filtered.findings.map((f) => `${f.id}:${f.state}`).join(","))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = checks - passed
const result = {
  issue: "M20.S1", code: "S1", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-security-flow-boundary.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: ["Fixture-level endpoint-state and evidence coverage; static taint remains heuristic and is not a runtime exploit proof.", "Real-repository security coverage is owned by M20.X2."]
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
persist(path.resolve("validation/m20/results/S1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? "\nSECURITY S1: PASS" : `\nSECURITY S1: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)
