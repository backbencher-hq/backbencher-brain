// verify-analysis-history.ts — reusable analysis runs/finding history (M9.12).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { completeAnalysisRun, getAnalysisHistory, setFindingState, startAnalysisRun } from "../src/intelligence/analysis/run-history"

let failures = 0
function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log("  ok: " + label)
  else { failures++; console.log("  FAIL: " + label + (detail ? " " + detail : "")) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-analysis-history-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function run(value: string): string { return value }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const first = await startAnalysisRun({ projectId, kind: "security", input: { mode: "full" } })
  check("run starts as running", first.status === "running")
  const fingerprint = "stable-demo-fingerprint"
  const firstReport = await completeAnalysisRun(projectId, first.id, [{ fingerprint, rule: "demo", title: "Demo finding", severity: "high", confidence: 0.9, location: "src/app.ts:1", evidence: [{ source: "fixture" }] }])
  check("run completes transactionally", firstReport.run.status === "completed")
  check("first finding is new", firstReport.newFindings === 1)
  check("finding opens", firstReport.findings.some((f) => f.rule === "demo" && f.state === "open"))
  const finding = firstReport.findings.find((f) => f.rule === "demo")!
  check("occurrence count starts at one", finding.occurrenceCount === 1)

  const second = await startAnalysisRun({ projectId, kind: "security", input: { mode: "full" } })
  const secondReport = await completeAnalysisRun(projectId, second.id, [{ fingerprint, rule: "demo", title: "Demo finding", severity: "high", confidence: 0.9, location: "src/app.ts:1", evidence: [{ source: "fixture" }] }])
  check("repeated fingerprint deduplicates", secondReport.newFindings === 0 && secondReport.repeatedFindings === 1)
  check("occurrence history increments", secondReport.findings.find((f) => f.id === finding.id)?.occurrenceCount === 2)

  const resolvedRun = await startAnalysisRun({ projectId, kind: "security" })
  const resolvedReport = await completeAnalysisRun(projectId, resolvedRun.id, [])
  check("missing finding resolves after successful empty run", resolvedReport.resolvedFindings === 1)
  check("resolved state is preserved", resolvedReport.findings.find((f) => f.id === finding.id)?.state === "resolved")

  const reopenedRun = await startAnalysisRun({ projectId, kind: "security" })
  const reopenedReport = await completeAnalysisRun(projectId, reopenedRun.id, [{ fingerprint, rule: "demo", title: "Demo finding", severity: "high" }])
  check("resolved finding reopens when observed", reopenedReport.reopenedFindings === 1)
  const reopened = reopenedReport.findings.find((f) => f.id === finding.id)!
  const stale = await setFindingState(projectId, reopened.id, "stale")
  check("stale state persists", stale.state === "stale")
  const staleReopenRun = await startAnalysisRun({ projectId, kind: "security" })
  const staleReopenReport = await completeAnalysisRun(projectId, staleReopenRun.id, [{ fingerprint, rule: "demo", title: "Demo finding", severity: "high" }])
  check("stale finding reopens when observed", staleReopenReport.reopenedFindings === 1)
  const active = staleReopenReport.findings.find((f) => f.id === finding.id)!
  const incrementalRun = await startAnalysisRun({ projectId, kind: "security", input: { incremental: true } })
  const incrementalReport = await completeAnalysisRun(projectId, incrementalRun.id, [], { incremental: true })
  check("empty incremental run does not resolve unrelated findings", incrementalReport.resolvedFindings === 0 && incrementalReport.findings.find((f) => f.id === finding.id)?.state === "reopened")
  const suppressed = await setFindingState(projectId, active.id, "suppressed")
  check("suppression state persists", suppressed.state === "suppressed" && suppressed.suppressedAt !== null)
  const mitigated = await setFindingState(projectId, reopened.id, "mitigated")
  check("mitigated state persists", mitigated.state === "mitigated" && mitigated.mitigatedAt !== null)

  const failed = await startAnalysisRun({ projectId, kind: "patterns" })
  const failedRun = await import("../src/intelligence/analysis/run-history").then(({ failAnalysisRun }) => failAnalysisRun(projectId, failed.id, new Error("fixture failure")))
  check("failed run stores error", failedRun.status === "failed" && failedRun.error === "fixture failure")

  const history = await getAnalysisHistory(projectId)
  check("history returns runs and findings", history.runs.length >= 7 && history.findings.length === 1)
  check("history summarizes lifecycle states", history.summary.mitigated === 1)
  const raw = await BrainDatabase.getRawInstance(projectId)
  check("run table exists", !!raw.prepare("SELECT 1 FROM brain_analysis_run LIMIT 1").get())
  check("finding table exists", !!raw.prepare("SELECT 1 FROM brain_analysis_finding LIMIT 1").get())
  check("occurrence table exists", !!raw.prepare("SELECT 1 FROM brain_analysis_occurrence LIMIT 1").get())
} catch (error) {
  check("analysis-history session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
console.log(failures === 0 ? "\nANALYSIS-HISTORY: PASS" : `\nANALYSIS-HISTORY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
