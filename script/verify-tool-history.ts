// script/verify-tool-history.ts — bb_security classification + bb_patterns
// recordRun persistence invariants.
//
// Guards two real honesty defects found by exercising the tools live:
//   A. bb_security persisted source-only observations ("unresolved",
//      severity "unknown") as findings in run history even though the live
//      summary counts them separately as unvalidated sources.
//   B. bb_patterns recordRun persisted only the DISPLAY slice (first `limit`
//      items) as "the run", so history under-reported and the auto-resolve
//      pass wrongly resolved real findings past the slice.
//
// Invariants enforced here:
//   - taint state classification: source-only -> source_only,
//     sink-only -> unresolved, both resolved -> confirmed.
//   - legacy adapter: findings contain ONLY confirmed/mitigated.
//   - persisted security history contains no rule="unresolved" / severity
//     "unknown" entries, and equals the live findings count.
//   - bb_patterns recordRun persists the FULL analyzed set (not slice(0,limit)).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { analyzeTaintFlows } from "../src/intelligence/security/taint"
import { CrossLanguageSecurityAnalysis } from "../src/security/cross-language-security"
import { executeAnalysis, getAnalysisHistory } from "../src/intelligence/analysis/run-history"
import { getProjectId } from "../src/cli/index"

let failures = 0
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!cond) failures++
}

const bb = path.resolve("bin/bb")

// ── A. Security: real isolated source + deterministic state matrix ──────────
const project = mkdtempSync(path.join(tmpdir(), "bb-tool-history-"))
const srcDir = path.join(project, "src")
mkdirSync(srcDir, { recursive: true })
writeFileSync(
  path.join(srcDir, "app.ts"),
  `// isolated SOURCE (process.env) with no sink anywhere
const token = process.env.API_TOKEN || "default"
export function main() {
  console.log("token length", token.length)
}
`,
)
writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "tool-history" }))
const projectId = `toolhist:${project}`

try {
  console.log("── A. bb_security classification + history cleanliness ──")
  await indexProjectParallel(projectId, project, {})

  const raw = await BrainDatabase.getRawInstance(projectId)
  const rows = raw.prepare("SELECT vulnerability_type, severity, source_symbol_id, sink_symbol_id FROM brain_taint_flow WHERE project_id=?").all(projectId) as any[]
  check("indexer emitted isolated-source rows (sink NULL, vuln=unresolved, sev=unknown)",
    rows.length > 0 && rows.every((r) => !r.sink_symbol_id && r.vulnerability_type === "unresolved" && r.severity === "unknown"),
    `${rows.length} rows`)

  const report = await analyzeTaintFlows(projectId, { maxResults: 100 })
  check("source-only rows classify as source_only (NOT confirmed)",
    report.findings.length > 0 && report.findings.every((f) => f.state === "source_only"),
    report.findings.map((f) => f.state).join(","))

  const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
  check("legacy adapter: findings empty (source-only rows not promoted)",
    legacy.findings.length === 0, `findings=${legacy.findings.length}`)
  check("source-only rows counted as unvalidated sources (not findings)",
    legacy.suspiciousSources.length === report.findings.length, `${legacy.suspiciousSources.length}`)
  check("summary split honest: 0 resolved flows, N unvalidated sources",
    legacy.summary.resolved === 0 && legacy.summary.unresolvedSources === legacy.suspiciousSources.length,
    `resolved=${legacy.summary.resolved} unresolvedSources=${legacy.summary.unresolvedSources}`)

  // Full recordRun -> history round-trip through the shared analysis wrapper.
  const recorded = await executeAnalysis({
    projectId,
    kind: "security",
    input: { recordRun: true },
    persist: () => legacy.findings.map((finding: any): any => ({
      fingerprint: finding.fingerprint ?? `${finding.file}:${finding.line ?? "?"}:${finding.label ?? finding.type}`,
      rule: finding.label ?? finding.type ?? "security",
      title: finding.label ?? finding.type ?? "security finding",
      severity: finding.severity ?? "medium",
      confidence: finding.confidence ?? null,
      evidence: finding.evidence ?? [],
      location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
      state: finding.mitigated ? "mitigated" : undefined,
    })),
  })
  check("recordRun persists 0 findings for a source-only project",
    recorded.report.newFindings === 0, `new=${recorded.report.newFindings}`)

  const history = await getAnalysisHistory(projectId, "security")
  check("history finding count equals live findings count (both 0)",
    history.findings.length === recorded.report.newFindings, `history=${history.findings.length}`)
  check("no unresolved/unknown entries persisted",
    history.findings.every((f) => f.severity !== "unknown" && f.rule !== "unresolved"),
    `historyFindings=${history.findings.length}`)

  // ── Deterministic state machine via direct row injection ─────────────────
  console.log("── A2. state machine for all partial/full row shapes ──")
  raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
  const symId = (raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? LIMIT 1").get(projectId) as any).id
  const inject = raw.prepare(`INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  inject.run("m-src-only", projectId, symId, null, "user_input", "unresolved", "unresolved", "unknown", 0, null, 0, Date.now(), Date.now())
  inject.run("m-snk-only", projectId, null, symId, "unresolved", "sql_query", "sql_injection", "critical", 0, null, 0, Date.now(), Date.now())
  inject.run("m-full", projectId, symId, symId, "user_input", "sql_query", "sql_injection", "critical", 0, null, 0, Date.now(), Date.now())
  inject.run("m-mit", projectId, symId, symId, "user_input", "sql_query", "sql_injection", "critical", 1, null, 0, Date.now(), Date.now())
  const stateOf = new Map((await analyzeTaintFlows(projectId, { maxResults: 100 })).findings.map((f) => [f.id, f.state]))
  check("source-only row -> source_only", stateOf.get("m-src-only") === "source_only", stateOf.get("m-src-only") ?? "missing")
  check("sink-only row -> unresolved (one endpoint unresolved)", stateOf.get("m-snk-only") === "unresolved", stateOf.get("m-snk-only") ?? "missing")
  check("full flow -> confirmed", stateOf.get("m-full") === "confirmed", stateOf.get("m-full") ?? "missing")
  check("mitigated flow -> mitigated", stateOf.get("m-mit") === "mitigated", stateOf.get("m-mit") ?? "missing")

  // ── B. bb_patterns recordRun persistence invariant ─────────────────────────
  console.log("── B. bb_patterns recordRun persists the full analyzed set ──")
  const pd = mkdtempSync(path.join(tmpdir(), "bb-tool-history-patterns-"))
  const psrc = path.join(pd, "src")
  mkdirSync(psrc, { recursive: true })
  let orphans = ""
  for (let i = 0; i < 30; i++) orphans += `function orphan_${i}() { return ${i} }\n`
  writeFileSync(path.join(psrc, "orphans.ts"), orphans)
  writeFileSync(path.join(pd, "package.json"), JSON.stringify({ name: "patterns" }))
  const pidP = getProjectId(pd) // same id derivation as the CLI
  await indexProjectParallel(pidP, pd, {})

  const pOut = execFileSync("node", [bb, "tool", "bb_patterns", "--dir", pd, "--args", JSON.stringify({ recordRun: true, limit: 20 })], { encoding: "utf8", stdio: "pipe" })
  const m = pOut.match(/patterns \((\d+) found, (\d+) recorded\)/)
  check("bb_patterns output reports explicit found + recorded counts", !!m, pOut.split("\n")[0]?.slice(0, 140) ?? "no match")
  const foundN = m ? Number(m[1]) : 0
  const recordedN = m ? Number(m[2]) : 0
  check("recorded count exceeds the display limit (20)", recordedN > 20, `recorded=${recordedN}`)
  check("recorded count equals the full analyzed set (found)", recordedN === foundN, `recorded=${recordedN} found=${foundN}`)

  const praw = await BrainDatabase.getRawInstance(pidP)
  const persistedCount = (praw.prepare("SELECT COUNT(*) c FROM brain_analysis_finding WHERE project_id=? AND kind='patterns'").get(pidP) as any).c
  check("DB persisted findings match the reported recorded count", persistedCount === recordedN, `db=${persistedCount} reported=${recordedN}`)
} finally {
  rmSync(project, { recursive: true, force: true })
}

console.log(failures === 0 ? "\nTOOL HISTORY VERIFY: ALL PASS" : `\nTOOL HISTORY VERIFY: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)