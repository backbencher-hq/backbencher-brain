// M20.S1 — security flow evidence and the endpoint-resolution boundary.
//
// REWRITTEN 2026-09-30 onto the shared harness (script/m15/security-harness.ts).
// Two structural defects in the previous version are fixed here:
//
//  1. THE COVERAGE COULD VANISH SILENTLY. All 7 substantive assertions lived
//     inside `if (symbol) { ... }`, guarded only by the 1 assertion above it. A
//     fixture that failed to index therefore produced `checks: 1, failed: 0` —
//     reported as `status: "verified"` with 7/7 of the real coverage never
//     executed. The harness's `require()`/`release()` makes an absent
//     precondition a FAILURE, so that outcome can no longer pass.
//
//  2. `negative()` called `check()`, which incremented `checks` — so a
//     "negative case" was double-counted as a check and the evidence file
//     reported a ratio that overstated the coverage. The harness counts every
//     assertion once and keeps positives and negatives in separate buckets.
//
// The 8 hardcoded `$HOME/...` paths in sibling verifiers are not
// used here: this suite is hermetic.
//
// Run: npx tsx script/m20/verify-security-flow-boundary.ts
// Exit: non-zero if any assertion failed.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"
import { securitySourceFingerprint, securityRelevantWorkingTreeChanges } from "../../src/intelligence/security/evidence"
import { writeSealed } from "../lib/evidence.ts"
import { SecurityHarness } from "../m15/security-harness"

const h = new SecurityHarness()
const root = mkdtempSync(path.join(tmpdir(), "bb-m20-s1-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handle(input: string) { return input }\n")
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const symbol = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'handle' LIMIT 1").get(projectId) as { id: string } | undefined

  // THE GATE. Absent, this is a failure — not a silent reduction to one check.
  h.require("the fixture symbol is indexed", !!symbol, "no symbol named 'handle' in the index; the coverage below would be empty")
  if (symbol) {
    const now = Date.now()
    const insert = raw.prepare("INSERT INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    // Both endpoints resolve, unmitigated → the only shape that may be `confirmed`.
    insert.run("s1-confirmed", projectId, symbol.id, symbol.id, "http_input", "database_write", "sql_injection", "high", 0, JSON.stringify([symbol.id]), 0, now, now)
    // Source resolves, no sink → source_only.
    insert.run("s1-source-only", projectId, symbol.id, null, "http_input", "unresolved", "unresolved", "unknown", 0, JSON.stringify([symbol.id]), 0, now, now)
    // Sink resolves, source does NOT, and is_mitigated = 1 — the boundary case:
    // endpoint resolution must win over the flag.
    insert.run("s1-mitigated-partial", projectId, null, symbol.id, "unresolved", "database_write", "sql_injection", "high", 1, JSON.stringify([symbol.id]), 0, now, now)

    const report = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: true, includeMitigated: true })
    const confirmed = report.findings.find((f) => f.id === "s1-confirmed")
    const sourceOnly = report.findings.find((f) => f.id === "s1-source-only")
    const partialMitigated = report.findings.find((f) => f.id === "s1-mitigated-partial")

    h.ck("the three injected rows are all reported", [confirmed, sourceOnly, partialMitigated].filter(Boolean).length === 3, `confirmed=${!!confirmed} sourceOnly=${!!sourceOnly} partial=${!!partialMitigated}`)

    h.ck("a fully-resolved flow is state=confirmed", confirmed?.state === "confirmed", `state=${confirmed?.state}`)
    h.ck("a confirmed flow resolves BOTH endpoints to files", !!confirmed?.source.file && !!confirmed?.sink.file, `src=${confirmed?.source.file} sink=${confirmed?.sink.file}`)
    h.ck("a confirmed flow carries taint evidence", (confirmed?.evidence ?? []).some((e) => e.kind === "taint_flow"), JSON.stringify(confirmed?.evidence))
    h.ck("a confirmed flow carries the heuristic limitation", (confirmed?.limitations ?? []).length > 0, JSON.stringify(confirmed?.limitations))
    h.ck("a confirmed flow has the calibrated confidence", confirmed?.confidence === 0.7, `confidence=${confirmed?.confidence}`)

    h.ck("a source-only row is state=source_only", sourceOnly?.state === "source_only", `state=${sourceOnly?.state}`)
    h.ck("a source-only row names no-sink in its limitations", (sourceOnly?.limitations ?? []).some((l) => /no confirmed sink/i.test(l)), JSON.stringify(sourceOnly?.limitations))
    h.nk("a source-only row is not promoted to a finding", sourceOnly?.state !== "confirmed", `state=${sourceOnly?.state}`)

    // The boundary the whole state machine exists for.
    h.nk("a PARTIAL flow is never classified confirmed, whatever the flag", partialMitigated?.state !== "confirmed", `state=${partialMitigated?.state}`)
    h.nk("a partial mitigated flow is not classified mitigated", partialMitigated?.state !== "mitigated", `state=${partialMitigated?.state} — endpoint resolution must take precedence over is_mitigated`)
    h.ck("a partial mitigated flow is classified unresolved", partialMitigated?.state === "unresolved", `state=${partialMitigated?.state}`)
    h.ck("a partial flow records its endpoint uncertainty", (partialMitigated?.limitations ?? []).some((l) => /endpoint/i.test(l)), JSON.stringify(partialMitigated?.limitations))
    h.ck("a partial flow has the observation confidence", partialMitigated?.confidence === 0.4, `confidence=${partialMitigated?.confidence}`)

    // The accounting the handler's headline depends on.
    h.ck("byState sums to total", Object.values(report.summary.byState).reduce((a, b) => a + b, 0) === report.summary.total, `byState=${JSON.stringify(report.summary.byState)} total=${report.summary.total}`)
    h.ck("byState matches the matrix exactly", report.summary.byState.confirmed === 1 && report.summary.byState.unresolved === 1 && report.summary.byState.source_only === 1 && report.summary.byState.mitigated === 0, `byState=${JSON.stringify(report.summary.byState)}`)
    h.ck("bySeverity sums to total", Object.values(report.summary.bySeverity).reduce((a, b) => a + b, 0) === report.summary.total, `bySeverity=${JSON.stringify(report.summary.bySeverity)} total=${report.summary.total}`)

    // Both filters are real.
    const filtered = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: false, includeMitigated: true })
    h.nk(
      "includeUnresolved:false excludes source-only and unresolved rows",
      !filtered.findings.some((f) => f.id === "s1-source-only" || f.id === "s1-mitigated-partial"),
      `ids=${filtered.findings.map((f) => f.id).join(",")}`,
    )
    h.ck("includeUnresolved:false KEEPS the confirmed flow", filtered.findings.some((f) => f.id === "s1-confirmed"), `ids=${filtered.findings.map((f) => f.id).join(",")}`)
    h.ck("byState reflects the filter", filtered.summary.byState.source_only === 0 && filtered.summary.byState.unresolved === 0, `byState=${JSON.stringify(filtered.summary.byState)}`)

    // Mutation proof: flipping the flag on the RESOLVED row must change the
    // verdict, or the two states are indistinguishable and the flag is decorative.
    raw.prepare("UPDATE brain_taint_flow SET is_mitigated = 1 WHERE id = 's1-confirmed'").run()
    const mutated = await analyzeTaintFlows(projectId, { maxResults: 100, includeUnresolved: true, includeMitigated: true })
    const mutatedRow = mutated.findings.find((f) => f.id === "s1-confirmed")
    h.ck("mutation: flipping is_mitigated on a RESOLVED flow changes confirmed to mitigated", mutatedRow?.state === "mitigated", `state=${mutatedRow?.state}`)
    h.ck("mutation: the confidence follows the state", mutatedRow?.confidence === 0.3, `confidence=${mutatedRow?.confidence}`)
    raw.prepare("UPDATE brain_taint_flow SET is_mitigated = 0 WHERE id = 's1-confirmed'").run()
  }
  h.release()
} catch (e: any) {
  h.ck("the section completed without throwing", false, (e?.message || String(e)).slice(0, 300))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

const failed = h.failed
const result = {
  issue: "M20.S1", code: "S1", milestone: "M20",
  status: failed === 0 && securityRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks: h.checks, passed: h.totalPassed, failed, negativeCases: h.negatives, negativePassed: h.negativePassed,
  // `git rev-parse` via execFileSync, not `Bun.spawnSync` (this suite runs under
  // tsx/node as well as bun) and not `require` (this file is ESM).
  currentCommit: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }
    catch { return "unknown" }
  })(),
  sourceFingerprint: securitySourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: securityRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "npx tsx script/m20/verify-security-flow-boundary.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Fixture-level endpoint-state and evidence coverage; static taint remains heuristic and is not a runtime exploit proof.",
    "Real-repository security coverage is owned by M20.X2.",
  ],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeSealed(path.resolve("validation/m20/results/S1.json"), result)
console.log(failed === 0 ? `\nSECURITY S1: PASS (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives)` : `\nSECURITY S1: ${failed} FAILURES`)
if (failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(failed > 0 ? 1 : 0)
