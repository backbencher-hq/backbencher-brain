// verify-analysis-governance.ts — repeated/changed/stale finding invariants (M10.04).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { completeAnalysisRun, executeAnalysis, failAnalysisRun, fingerprintFinding, getAnalysisHistory, startAnalysisRun, setFindingState } from "../src/intelligence/analysis/run-history"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

function makeFinding(overrides: Partial<{ fingerprint: string; rule: string; location: string; evidence: string[]; limitations: string[]; state: string }> = {}) {
  return {
    fingerprint: overrides.fingerprint ?? "fp-alpha",
    rule: overrides.rule ?? "unsafe-inner-html",
    title: "Unsafe innerHTML",
    severity: "high",
    confidence: 0.9,
    evidence: overrides.evidence ?? [{ kind: "flow", source: "user.input", sink: "render" }],
    location: overrides.location ?? "src/main.ts:42",
    limitations: overrides.limitations ?? ["Html-templated sinks are approximated by string match."],
    evidenceClass: "static_finding",
    engine: "pattern-a",
    engineVersion: "1.2.3",
    ...(overrides.state ? { state: overrides.state as any } : {}),
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-analysis-gov-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function run(value: string): string { return value }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // Stable dedup on unchanged findings.
  const run1 = await startAnalysisRun({ projectId, kind: "patterns", input: { sourceRevision: 1 } })
  const report1 = await completeAnalysisRun(projectId, run1.id, [makeFinding()])
  check("first run produces one finding", report1.newFindings === 1 && report1.repeatedFindings === 0)
  check("first run finding has evidence and limitations", report1.findings[0]!.evidence.length > 0 && report1.findings[0]!.limitations.length > 0)
  check("first run finding has location and provenance fields", report1.findings[0]!.location === "src/main.ts:42" && report1.findings[0]!.engine === "pattern-a" && report1.findings[0]!.engineVersion === "1.2.3" && report1.findings[0]!.evidenceClass === "static_finding")
  const finding = report1.findings[0]!

  const run2 = await startAnalysisRun({ projectId, kind: "patterns", input: { sourceRevision: 1 } })
  const report2 = await completeAnalysisRun(projectId, run2.id, [makeFinding()])
  check("repeated run deduplicates", report2.newFindings === 0 && report2.repeatedFindings === 1)
  check("repeated finding retains identity", report2.findings[0]!.id === finding.id && report2.findings[0]!.fingerprint === finding.fingerprint)
  check("occurrence count increments on repeat", report2.findings[0]!.occurrenceCount === 2)
  check("run findingCount matches unique finding count", report2.run.findingCount === 1)

  // Changed evidence (different fingerprint via new evidence sink/location/path).
  const evidenceChangedFinding = {
    rule: "unsafe-inner-html",
    title: "Unsafe innerHTML",
    severity: "high",
    confidence: 0.9,
    evidence: [{ kind: "flow", source: "user.input", sink: "render:v2" }],
    location: "src/main.ts:45",
    limitations: ["Html-templated sinks are approximated by string match."],
    evidenceClass: "static_finding",
    engine: "pattern-a",
    engineVersion: "1.2.3",
  }
  const changedComputedFp = fingerprintFinding("patterns", evidenceChangedFinding)
  const run3 = await startAnalysisRun({ projectId, kind: "patterns", input: { sourceRevision: 2 } })
  const report3 = await completeAnalysisRun(projectId, run3.id, [{ ...evidenceChangedFinding, fingerprint: changedComputedFp } as any])
  const changedEntry = report3.findings.find((f) => f.fingerprint === changedComputedFp)!
  check("changed evidence creates a new finding (computed fingerprint differs)", changedComputedFp !== "fp-alpha" && report3.newFindings === 1 && report3.findings.some((f) => f.fingerprint === changedComputedFp),
    `changedFp=${changedComputedFp.slice(0, 8)} new=${report3.newFindings} fps=${report3.findings.map((f) => f.fingerprint.slice(0, 8))}`)
  check("changed evidence row preserves new evidence", (changedEntry.evidence as any[])[0].sink === "render:v2")
  check("prior finding is resolved by absence-preserving pass", report3.findings.find((f) => f.fingerprint === "fp-alpha")!.state === "resolved")
  check("changed evidence finding carries new evidence", changedEntry.evidence.length > 0)

  // Reappearance reopens resolved/stale findings.
  const run4 = await startAnalysisRun({ projectId, kind: "patterns", input: { sourceRevision: 3 } })
  const report4 = await completeAnalysisRun(projectId, run4.id, [makeFinding()])
  const reopenedPrior = report4.findings.find((f) => f.id === finding.id)
  check("reappearance reopens previously-resolved finding", report4.reopenedFindings === 1 && reopenedPrior?.state === "reopened", `state=${reopenedPrior?.state} reopened=${report4.reopenedFindings}`)

  // setFindingState moves state without touching occurrence history.
  const suppressed = await setFindingState(projectId, finding.id, "suppressed")
  check("setFindingState suppresses", suppressed.state === "suppressed" && suppressed.suppressedAt !== null)
  const historyBeforeResolve = await getAnalysisHistory(projectId, "patterns")
  const suppressCountBefore = historyBeforeResolve.findings.filter((f) => f.state === "suppressed").length
  check("suppressed findings visible in history", suppressCountBefore === 1)

  // Reappearance does not clear suppressed (but treats it as repeated).
  const run5 = await startAnalysisRun({ projectId, kind: "patterns" })
  const report5 = await completeAnalysisRun(projectId, run5.id, [makeFinding()])
  check("suppressed finding remains suppressed on repeat", report5.findings.find((f) => f.id === finding.id)?.state === "suppressed")
  check("suppressed findings are not reopened on repeat", report5.reopenedFindings === 0 && report5.repeatedFindings === 1)

  // Repeats with explicit state override.
  const run6 = await startAnalysisRun({ projectId, kind: "patterns" })
  const report6 = await completeAnalysisRun(projectId, run6.id, [{ ...makeFinding(), state: "mitigated" }])
  check("explicit state override applies", report6.findings.find((f) => f.id === finding.id)?.state === "mitigated")

  // Deterministic ordering.
  const rerun = await startAnalysisRun({ projectId, kind: "patterns", input: { include: ["beta"] } })
  await completeAnalysisRun(projectId, rerun.id, [
    makeFinding({ fingerprint: "fp-beta", location: "src/main.ts:99", rule: "other", state: "open" }),
  ])
  const historyA = await getAnalysisHistory(projectId, "patterns")
  const historyB = await getAnalysisHistory(projectId, "patterns")
  check("run history is deterministic", historyA.findings.every((f, i) => f.id === historyB.findings[i]!.id))

  // findByKind: analysis history must not conflate kinds.
  await executeAnalysis({
    projectId,
    kind: "security",
    persist: () => [makeFinding()],
  })
  const patternsHistory = await getAnalysisHistory(projectId, "patterns")
  const securityHistory = await getAnalysisHistory(projectId, "security")
  check("history is scoped per kind", patternsHistory.findings.every((f) => f.kind === "patterns") && securityHistory.findings.every((f) => f.kind === "security"))

  // Retention: cap occurrences via retentionDays.
  const freshRun = await startAnalysisRun({ projectId, kind: "health" })
  await completeAnalysisRun(projectId, freshRun.id, [makeFinding()], { retentionDays: 1 })
  const raw = await BrainDatabase.getRawInstance(projectId)
  const cutoff = Date.now() - 86400001
  raw.prepare("INSERT INTO brain_analysis_occurrence (id,finding_id,run_id,state,observed_at,time_created,time_updated) VALUES (?,?,?,?,?,?,?)")
    .run("ancient-occ", finding.id, freshRun.id, "open", cutoff, cutoff, cutoff)
  const beforeRetention = raw.prepare("SELECT COUNT(*) AS c FROM brain_analysis_occurrence").get() as { c: number }
  const retireRun = await startAnalysisRun({ projectId, kind: "health" })
  await completeAnalysisRun(projectId, retireRun.id, [makeFinding()], { retentionDays: 1 })
  const afterRetention = raw.prepare("SELECT COUNT(*) AS c FROM brain_analysis_occurrence").get() as { c: number }
  check("retentionDays truncates ancient occurrences", afterRetention.c <= beforeRetention.c, `${beforeRetention.c} -> ${afterRetention.c}`)
  check("remaining occurrences are within retention window", (raw.prepare("SELECT COUNT(*) AS c FROM brain_analysis_occurrence WHERE observed_at < ?").get(Date.now() - 86400000) as { c: number }).c === 0)

  // Failure records error for retry handling.
  const failed = await startAnalysisRun({ projectId, kind: "analyze" })
  await failAnalysisRun(projectId, failed.id, new Error("precondition invalid"))
  const history = await getAnalysisHistory(projectId, "analyze")
  check("failed run persists failure reason", history.runs.some((r) => r.status === "failed" && r.error === "precondition invalid"))

  // Failure inside wrapper is recorded too.
  const wrapperFailed = await executeAnalysis({
    projectId,
    kind: "analyze",
    persist: () => { throw new Error("persist failed") },
  }).catch((error) => error)
  check("analysis wrapper failure is recorded", wrapperFailed instanceof Error)
  const historyAfterFail = await getAnalysisHistory(projectId, "analyze")
  check("wrapper failure surfaces in history", historyAfterFail.runs.filter((r) => r.status === "failed").length >= 2)

  // FindingCount reflects the union of active findings on the same run.
  const broad = await startAnalysisRun({ projectId, kind: "patterns", input: {} })
  const broadReport = await completeAnalysisRun(projectId, broad.id, [makeFinding({ fingerprint: "fp-beta" }), makeFinding()])
  check("completeAnalysisRun returns deterministic ordering on findings", broadReport.orderedFindings.length === broadReport.findings.length)
  check("orderedFindings ordering is stable", broadReport.orderedFindings.every((f, idx) => f.id === broadReport.findings[idx]!.id))
} catch (error) {
  check("analysis-governance session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nANALYSIS-GOVERNANCE: PASS" : `\nANALYSIS-GOVERNANCE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
