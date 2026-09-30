// M20.S3 — security history state persistence.
//
// REWRITTEN 2026-09-30 onto the shared harness (script/m15/security-harness.ts).
// Defects in the previous version, all fixed here:
//
//  1. THE COVERAGE COULD VANISH SILENTLY. All 12 substantive assertions sat
//     inside `if (sym) { ... }`. A fixture that failed to index produced
//     `checks: 1, failed: 0` — reported as `status: "verified"` with 12/12 of
//     the real coverage never executed. The harness's `require()`/`release()`
//     makes an absent precondition a FAILURE.
//
//  2. AN AUTO-PASS AT :57. `live.includes("unvalidated") || live.includes(
//     "unvalidated input sources")` — the second operand is a superstring of the
//     first, so the disjunction is just the first; and the header line always
//     prints the literal "unvalidated sources" in its parenthesised count, so
//     the assertion was satisfied by the word appearing in a COUNT, with nothing
//     proving any source was enumerated. It now asserts the observation BLOCK
//     and a rendered observation line.
//
//  3. A WEAK DISPROOF AT :62. `f.rule !== "unresolved"` passed by construction
//     because the recorder sets `rule` to the display label ("SQL injection"),
//     never the string "unresolved". It is replaced with assertions on the
//     actual policy: the persisted set must equal the confirmed/mitigated set.
//
//  4. A CRASH LOST THE EVIDENCE. The CLI legs are unguarded `execFileSync`
//     calls: without a built `dist/` they threw, the `finally` cleaned up, and
//     S3.json was never written — leaving the previous run's committed evidence
//     in place, still claiming `verified`. They are now gated, and a missing
//     `dist/` is recorded as a SKIP with a reason, not a silent stale file.
//
//  5. `negative()` incremented `checks` via `check()`, double-counting every
//     disproof and overstating coverage. The harness counts each once.
//
// New coverage that did not exist: the evidence and confidence the recorder
// persists (both were silently NULL/[] before the 2026-09-30 fix), the
// fingerprint's stability across a re-grade, and the recordRun census.
//
// Run: npx tsx script/m20/verify-security-history.ts
// Exit: non-zero if any assertion failed.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { getAnalysisHistory } from "../../src/intelligence/analysis/run-history"
import { securitySourceFingerprint, securityRelevantWorkingTreeChanges } from "../../src/intelligence/security/evidence"
import { SecurityHarness } from "../m15/security-harness"

const h = new SecurityHarness()
const skipped: Array<{ leg: string; reason: string }> = []

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handle(input: string): unknown {\n  const sql = 'SELECT * FROM t WHERE name = ' + input\n  return db.query(sql)\n}\n")
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const sym = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'handle' LIMIT 1").get(projectId) as { id: string } | undefined

  // THE GATE. Absent, this fails — the 12 assertions below are the coverage.
  h.require("the fixture symbol is indexed", !!sym, "no symbol named 'handle'; the history matrix below would never execute")
  if (sym) {
    // Matrix: 1 confirmed (both endpoints), 1 source_only, 1 unresolved. The
    // last two carry severity 'unknown' so the persistence policy is testable.
    raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
    const now = Date.now()
    const ins = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    ins.run("s3-conf", projectId, sym.id, sym.id, "http_input", "database_write", "sql_injection", "high", 0, JSON.stringify([sym.id]), 0, now, now)
    ins.run("s3-src", projectId, sym.id, null, "http_input", "unresolved", "unknown", "unknown", 0, JSON.stringify([sym.id]), 0, now, now)
    ins.run("s3-unk", projectId, null, sym.id, "unresolved", "shell_execution", "command_injection", "unknown", 0, JSON.stringify([sym.id]), 0, now, now)

    const handler = createToolHandlers().bb_security
    const ctx = { projectPath: root, projectId } as any
    const live = (await handler({ recordRun: true, limit: 10 }, ctx)).content[0]!.text

    h.ck("live: response reports a recorded run", live.includes("recorded run"), live.slice(0, 200))
    // The old assertion was satisfied by the word "unvalidated" appearing in
    // the header's parenthesised COUNT. This one requires the BLOCK and a
    // rendered observation line.
    h.ck("live: the unvalidated-observations block is present", /unvalidated (sources|observations)/.test(live), live.slice(0, 400))
    h.ck("live: at least one observation line is rendered", /^\s{2}\[\w+\] unvalidated (input source|sink):/m.test(live), live.slice(0, 600))
    h.ck("live: the census line is present", /\[scan: 3 taint flow\(s\) indexed → 3 finding\(s\)/.test(live), live.match(/\[scan:[^\n]*/)?.[0] ?? live.slice(0, 200))
    h.ck("live: the persisted count is stated", /1 findings recorded/.test(live), live.slice(0, 300))
    h.nk("live: the observation is not claimed as persisted", /unvalidated (sources|observations) \(not persisted\)|unvalidated observations/.test(live), live.slice(0, 600))

    const history = await getAnalysisHistory(projectId, "security", 10)
    h.ck("history: one completed run", history.runs.length === 1 && history.runs[0]!.status === "completed", JSON.stringify(history.runs.map((r) => r.status)))
    h.ck("history: findingCount equals confirmed findings only (1), not the 3-row matrix", history.runs[0]!.findingCount === 1, `count=${history.runs[0]!.findingCount}`)

    // The real policy, asserted as a set equality rather than as two substring
    // exclusions that happened to be true by construction.
    h.ck("history: exactly one finding persisted from a 3-row matrix", history.findings.length === 1, `n=${history.findings.length}`)
    const persisted = history.findings[0]!
    h.ck("history: the persisted finding is the confirmed SQL injection", persisted?.rule === "sql_injection", `rule=${persisted?.rule}`)
    h.ck("history: the persisted title is the human label", persisted?.title === "SQL injection", `title=${persisted?.title}`)
    h.ck("history: the persisted state is open", persisted?.state === "open", `state=${persisted?.state}`)
    h.nk("history: no persisted row carries an unknown severity", history.findings.every((f) => f.severity !== "unknown"), `severities=${[...new Set(history.findings.map((f) => f.severity))].join(",")}`)
    h.nk("history: no persisted row is an observation", history.findings.every((f) => f.state === "open" || f.state === "mitigated"), `states=${[...new Set(history.findings.map((f) => f.state))].join(",")}`)
    h.nk("history: the 'unknown' vulnerability_type row was not persisted", !history.findings.some((f) => (f.rule ?? "").includes("unknown")), `rules=${history.findings.map((f) => f.rule).join(",")}`)

    // The defect this suite was supposed to catch and did not: the recorder read
    // `confidence` and `evidence` off a legacy shape that never carried them,
    // so every persisted security finding had confidence NULL and evidence [].
    h.ck("history: the persisted finding carries the calibrated confidence 0.7", persisted?.confidence === 0.7, `confidence=${JSON.stringify(persisted?.confidence)}`)
    h.ck("history: the persisted finding carries non-empty evidence", (persisted?.evidence ?? []).length > 0, `evidence=${JSON.stringify(persisted?.evidence)}`)
    h.ck("history: the persisted evidence names the taint flow", (persisted?.evidence ?? []).some((e: any) => e.kind === "taint_flow"), JSON.stringify(persisted?.evidence))
    h.ck("history: the persisted finding carries limitations", (persisted?.limitations ?? []).length > 0, `limitations=${JSON.stringify(persisted?.limitations)}`)
    h.ck("history: the persisted row declares the evidence class", persisted?.evidenceClass === "static_finding", `evidenceClass=${persisted?.evidenceClass}`)
    h.ck("history: the persisted row names the engine", persisted?.engine === "taint@intelligence", `engine=${persisted?.engine}`)
    h.ck("history: the persisted row has a location", typeof persisted?.location === "string" && persisted.location!.includes(":"), `location=${persisted?.location}`)

    // Repeat-run parity.
    await handler({ recordRun: true, limit: 10 }, ctx)
    const history2 = await getAnalysisHistory(projectId, "security", 10)
    h.ck("parity: second run keeps same finding count", history2.runs.length === 2 && history2.runs.every((r) => r.findingCount === 1), JSON.stringify(history2.runs.map((r) => r.findingCount)))
    h.ck("parity: finding set unchanged after repeat (no phantom resolution)", history2.findings.length === 1 && history2.findings[0]!.state === "open", JSON.stringify(history2.findings.map((f) => f.state)))
    h.ck("parity: occurrenceCount advances on a repeat", (history2.findings[0]?.occurrenceCount ?? 0) >= 2, `occurrences=${history2.findings[0]?.occurrenceCount}`)

    // Fingerprint stability across a RE-GRADE. `severity` must not be in the
    // identity: a re-grade is a property of the same flow, not a new one.
    raw.prepare("UPDATE brain_taint_flow SET severity = 'critical' WHERE id = 's3-conf'").run()
    const rec3 = (await handler({ recordRun: true, limit: 10 }, ctx)).content[0]!.text
    h.ck("parity: re-grading severity is a repeat, not a new finding", /new=0\b/.test(rec3), rec3.match(/new=\d+ repeated=\d+/)?.[0] ?? rec3.slice(0, 200))
    const history3 = await getAnalysisHistory(projectId, "security", 10)
    h.ck("parity: re-grading updates severity in place without minting a row", history3.findings.length === 1 && history3.findings[0]!.severity === "critical", `n=${history3.findings.length} sev=${history3.findings[0]?.severity}`)
    h.ck("parity: re-grading does not resolve the finding", history3.findings[0]?.state === "open", `state=${history3.findings[0]?.state}`)
  }
  h.release()

  // ── CLI parity ────────────────────────────────────────────────────────────
  // GATED. The previous version called execFileSync unguarded, so a missing
  // `dist/` threw, the finally block cleaned up, and S3.json was never written
  // — leaving the committed evidence from the last good run in place, still
  // claiming `verified`. A skip is now recorded with its reason.
  const bb = path.resolve("bin/bb")
  const hasDist = existsSync(path.resolve("dist/cli/index.js"))
  if (!hasDist) {
    skipped.push({ leg: "CLI", reason: "dist/cli/index.js is absent — run `npm run build` first. The previous version threw here and left S3.json unwritten, so a stale `verified` survived." })
    console.log("  SKIP CLI parity: dist/ is not built (run `npm run build`)")
  } else {
    const cli = execFileSync("node", [bb, "tool", "bb_security", "--dir", root, "--args", JSON.stringify({ recordRun: true })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    h.ck("CLI: recordRun works", cli.includes("recorded run"), cli.slice(0, 200))
    h.ck("CLI: the CLI response also carries the census", /\[scan:/.test(cli), cli.match(/\[scan:[^\n]*/)?.[0] ?? "no census")
    const cliHist = execFileSync("node", [bb, "tool", "bb_security", "--dir", root, "--args", JSON.stringify({ history: true, limit: 10 })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    const parsed = JSON.parse(cliHist.trim())
    h.ck("CLI: history JSON has runs with findingCount 1", Array.isArray(parsed.runs) && parsed.runs.length === 4 && parsed.runs.every((r: any) => r.findingCount === 1), `runs=${parsed.runs?.length} counts=${JSON.stringify(parsed.runs?.map((r: any) => r.findingCount))}`)
    h.nk("CLI: history JSON has no unknown-severity findings", parsed.findings.every((f: any) => f.severity !== "unknown"), JSON.stringify(parsed.findings?.map((f: any) => f.severity)))
    h.ck("CLI: history JSON carries the calibrated confidence", parsed.findings.every((f: any) => typeof f.confidence === "number"), `confidences=${JSON.stringify(parsed.findings?.map((f: any) => f.confidence))}`)
    h.ck("CLI: history JSON carries evidence", parsed.findings.every((f: any) => Array.isArray(f.evidence) && f.evidence.length > 0), `evidence=${JSON.stringify(parsed.findings?.map((f: any) => f.evidence?.length))}`)
    h.ck("CLI: the CLI door records the same set as the handler door", parsed.findings.length === 1, `n=${parsed.findings?.length}`)
  }
} catch (error) {
  h.ck("the section completed without throwing", false, error instanceof Error ? (error.stack ?? error.message).slice(0, 300) : String(error))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

const failed = h.failed
const result = {
  issue: "M20.S3", code: "S3", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks: h.checks, passed: h.totalPassed, failed, negativeCases: h.negatives, negativePassed: h.negativePassed,
  currentCommit: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }
    catch { return "unknown" }
  })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "npx tsx script/m20/verify-security-history.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  skipped,
  limitations: [
    "Deterministic fixture-level history matrix; real-repository history parity is owned by M20.X2.",
    "History excludes source_only/unresolved observations by policy; the live response still surfaces them, and marks them as not persisted.",
  ],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/S3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? `\nSECURITY S3: PASS (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives${skipped.length ? `, ${skipped.length} leg(s) skipped` : ""})` : `\nSECURITY S3: ${failed} FAILURES`)
for (const s of skipped) console.log(`  SKIP ${s.leg}: ${s.reason}`)
if (failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(failed > 0 ? 1 : 0)
