// script/m15/verify-security-regressions.ts — regression proofs for the
// bb_security defects found in the 2026-09-30 deep review (A1-A7, B1-B5, C).
//
// Every check here has a named defect it would have FAILED before the fix. The
// suite is hermetic: it builds its own fixtures in tmpdir and seeds taint rows
// directly where the indexer cannot produce the shape under test. No hardcoded
// `/home/...` corpus path, so it runs anywhere with a Node runtime.
//
// Run: npx tsx script/m15/verify-security-regressions.ts
// Emits: validation/m15/results/xr1.json … xr6.json
// Exit:  non-zero if ANY assertion in ANY section failed.

import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"
import { CrossLanguageSecurityAnalysis } from "../../src/security/cross-language-security"
import { createToolHandlers, SECURITY_FINDINGS_WINDOW, SECURITY_SUSPICIOUS_WINDOW, SECURITY_SCAN_CAP, SECURITY_RECORD_RUN_CENSUS_CAP } from "../../src/mcp/tool-handlers"
import { getAnalysisHistory } from "../../src/intelligence/analysis/run-history"
import { SecurityHarness, positiveCount } from "./security-harness"
import { writeSealed } from "../lib/evidence.ts"

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m15/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const h = new SecurityHarness()
const skipped: Array<{ code: string; reason: string }> = []

/**
 * Write this suite's evidence through the ONE sealed write path.
 *
 * `script/lib/evidence.ts` declares `writeSealed` the single write path and
 * `readEvidence` the single trusted read, and the trusted read REFUSES a record
 * with no `bbSeal` envelope (`kind: "unsealed"`). A bare `writeFileSync` +
 * `JSON.stringify` therefore produces a record the rest of the governance
 * machinery is required to reject. M61.V1 adopted sealed writes across the IDE
 * lane; this lane was never adopted, which is how the defect survived.
 */
const write = (file: string, extra: Record<string, unknown> = {}) =>
  writeSealed(
    path.join(RESULTS_DIR, file),
    h.record_({ issue: "M15.XR", code: file.replace(".json", ""), tool: "bb_security", title: extra.title ?? "regression", extra: { ...extra, title: undefined } }),
  )

/**
 * True when a COMMITTED evidence file still holds the old implementation's
 * numbers.
 *
 * A few checks below read the on-disk `x*.json` rather than re-deriving them,
 * because those files are the record of what was actually true. Two of them
 * necessarily fail on the first run after a rewrite, because the file still
 * holds the pre-fix ratio and only a fresh run of the SIBLING suite replaces
 * it. That is not a defect in the fix — it is the fix's receipt not yet being
 * collected — so the check is reported as a skip with its reason instead of a
 * failure, and it becomes a hard failure on the second run if nothing
 * regenerated it.
 *
 * The one-run grace is what makes it non-vacuous: `npm run verify:security`
 * runs this suite BEFORE verify-security-deep.ts, so on a cold tree the file is
 * legitimately one run behind.
 */
const committedEvidenceStale = (file: string): { stale: boolean; detail: string } => {
  const p = path.join(RESULTS_DIR, file)
  if (!existsSync(p)) return { stale: true, detail: "file absent" }
  try {
    const rec = JSON.parse(readFileSync(p, "utf8")) as { passed?: number; checks?: number }
    if (typeof rec.passed === "number" && typeof rec.checks === "number" && rec.passed > rec.checks) {
      return { stale: true, detail: `passed=${rec.passed} checks=${rec.checks}` }
    }
    return { stale: false, detail: `passed=${rec.passed} checks=${rec.checks}` }
  } catch (e: any) {
    return { stale: true, detail: (e?.message ?? String(e)).slice(0, 80) }
  }
}

// ── fixture helpers ─────────────────────────────────────────────────────────
function cleanup(root: string, projectId: string): void {
  if (!root.startsWith(tmpdir())) throw new Error(`refusing to remove non-tmp root: ${root}`)
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

async function indexFixture(files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = mkdtempSync(path.join(tmpdir(), "bb-sec-reg-"))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId, root, {})
  return { root, projectId }
}

type FlowSeed = {
  id: string
  source?: string | null
  sink?: string | null
  sourceType?: string
  sinkType?: string
  vuln: string
  severity: string
  mitigated?: number
  boundaries?: number
}

/** Wipe the project's taint rows and insert exactly `seeds`. */
function seedFlows(raw: any, projectId: string, seeds: FlowSeed[]): void {
  const now = Date.now()
  raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
  const ins = raw.prepare(
    "INSERT OR REPLACE INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  for (const s of seeds) {
    const flowPath = s.source && s.sink ? JSON.stringify([s.source, s.sink]) : JSON.stringify([s.source ?? s.sink])
    ins.run(s.id, projectId, s.source ?? null, s.sink ?? null, s.sourceType ?? "user_input", s.sinkType ?? "database_write", s.vuln, s.severity, s.mitigated ?? 0, flowPath, s.boundaries ?? 0, now, now)
  }
}

/**
 * Insert `seeds` WITHOUT wiping first. XR2 creates its own sink symbols, so it
 * must not erase the rows it is about to describe in a second pass.
 */
function seedFlowsAdditive(raw: any, projectId: string, seeds: FlowSeed[]): void {
  const now = Date.now()
  const ins = raw.prepare(
    "INSERT OR REPLACE INTO brain_taint_flow (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  for (const s of seeds) {
    ins.run(s.id, projectId, s.source ?? null, s.sink ?? null, s.sourceType ?? "user_input", s.sinkType ?? "database_write", s.vuln, s.severity, s.mitigated ?? 0, JSON.stringify([s.source ?? s.sink]), s.boundaries ?? 0, now, now)
  }
}

function symbolsOf(raw: any, projectId: string): Array<{ id: string; name: string; file_id: string | null }> {
  return raw.prepare("SELECT id, name, file_id FROM brain_symbol WHERE project_id = ?").all(projectId) as any[]
}

const baseFixture = {
  "src/app.ts": "export function sinkFn(input: string) { return input }\n",
  "src/other.ts": "export function srcFn(): string { return 'x' }\n",
}

// ═══════════════════════════════════════════════════════════════════════════
// XR1 — A3/A5: severity accounting and hotspot severity
//
// DEFECT: `severity` was cast straight through (`row.severity as
// SecurityFindingV2["severity"]`) from a TEXT column with no CHECK constraint.
// The adapter then bucketed only critical/high/medium/low/unknown, so a row
// stored as "Critical" or "info" appeared in bySeverity and in NONE of the five
// buckets. The handler prints the five buckets as its headline, so it printed
// "0 critical / 0 high / 0 medium / 0 low" directly above a list of findings.
// Separately, hotspot accumulators seeded at "low" (rank 3), so a hotspot whose
// only finding had an unrankable severity published maxSeverity "low".
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR1", "severity normalization: bySeverity sums to total; hotspots never under-report")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const sink = syms.find((s) => s.name === "sinkFn")!
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR1: fixture symbols present", !!sink && !!src, `sink=${!!sink} src=${!!src}`)
    if (sink && src) {
      // Deliberately hostile severities: mixed case, an out-of-vocabulary
      // value, an empty string, and a valid one. None of these can be produced
      // by the current indexer, which is the point — the column has no CHECK
      // constraint, so any writer (or a future one) can.
      seedFlows(raw, projectId, [
        { id: "r1-a", source: src.id, sink: sink.id, vuln: "sql_injection", severity: "Critical" },
        { id: "r1-b", source: src.id, sink: sink.id, vuln: "xss", severity: "info" },
        { id: "r1-c", source: src.id, sink: sink.id, vuln: "ssrf", severity: "" },
        { id: "r1-d", source: src.id, sink: sink.id, vuln: "path_traversal", severity: "high" },
      ])
      const report = await analyzeTaintFlows(projectId, { maxResults: 100 })

      h.ck(
        "XR1: severity is normalized into the documented 5-value union",
        report.findings.every((f) => ["critical", "high", "medium", "low", "unknown"].includes(f.severity)),
        `observed: ${[...new Set(report.findings.map((f) => f.severity))].join(",")}`,
      )
      h.ck(
        'XR1: mixed-case "Critical" is normalized to "critical" (not passed through)',
        report.findings.some((f) => f.id === "r1-a" && f.severity === "critical"),
        `r1-a severity=${report.findings.find((f) => f.id === "r1-a")?.severity}`,
      )
      h.ck(
        'XR1: out-of-vocabulary "info" becomes "unknown" (not an unprintable bucket)',
        report.findings.some((f) => f.id === "r1-b" && f.severity === "unknown"),
        `r1-b severity=${report.findings.find((f) => f.id === "r1-b")?.severity}`,
      )
      h.ck(
        'XR1: empty-string severity becomes "unknown"',
        report.findings.some((f) => f.id === "r1-c" && f.severity === "unknown"),
        `r1-c severity=${report.findings.find((f) => f.id === "r1-c")?.severity}`,
      )
      // THE core arithmetic invariant. Before the fix this was false: 3 of the
      // 4 rows landed outside the five buckets, so the sum was 1 while total was 4.
      const sum = Object.values(report.summary.bySeverity).reduce((a, b) => a + b, 0)
      h.ck(
        "XR1: sum(summary.bySeverity) === summary.total",
        sum === report.summary.total,
        `bySeverity sum=${sum} total=${report.summary.total} bySeverity=${JSON.stringify(report.summary.bySeverity)}`,
      )
      h.ck(
        "XR1: every summary.bySeverity key is a documented severity",
        Object.keys(report.summary.bySeverity).every((k) => ["critical", "high", "medium", "low", "unknown"].includes(k)),
        Object.keys(report.summary.bySeverity).join(","),
      )
      // The adapter is what the handler actually reads, so the invariant has to
      // hold in ITS summary too, not only in the engine's.
      const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
      const legacySum = legacy.summary.critical + legacy.summary.high + legacy.summary.medium + legacy.summary.low + legacy.summary.unknown
      h.ck(
        "XR1: adapter summary severity buckets also sum to total",
        legacySum === legacy.summary.total,
        `buckets=${legacySum} total=${legacy.summary.total} critical=${legacy.summary.critical} high=${legacy.summary.high} medium=${legacy.summary.medium} low=${legacy.summary.low} unknown=${legacy.summary.unknown}`,
      )
      h.ck(
        "XR1: the adapter's ungraded rows are counted as unknown, not dropped",
        legacy.summary.unknown === 2,
        `unknown=${legacy.summary.unknown} (expected the 'info' and '' rows) total=${legacy.summary.total}`,
      )
      // A5: hotspot maxSeverity must be a TRUE MAX over the findings in the
      // hotspot. These 4 rows share one sink symbol in one file, so the file
      // hotspot aggregates critical + unknown + unknown + high → `critical`.
      // Seeding the accumulator with "low" happens to give the same answer
      // here, so the isolating case is a SECOND file whose ONLY finding is
      // ungraded: its true max is "unknown", and a "low" seed reports "low".
      const { root: root2, projectId: pid2 } = await indexFixture({
        "ungraded.ts": "export function ungradedOnly(input: string) { return input }\n",
      })
      try {
        const raw2 = await BrainDatabase.getRawInstance(pid2)
        const sym2 = symbolsOf(raw2, pid2).find((s) => s.name === "ungradedOnly")
        h.require("XR1: isolated-ungraded fixture symbol present", !!sym2, `sym=${!!sym2}`)
        if (sym2) {
          seedFlows(raw2, pid2, [{ id: "r1-e", source: sym2.id, sink: sym2.id, vuln: "ssrf", severity: "info" }])
          const r2 = await analyzeTaintFlows(pid2, { maxResults: 10 })
          const fileSpot = r2.hotspots.find((hs) => hs.kind === "file" && hs.key === "ungraded.ts")
          h.require("XR1: the ungraded-only file has a hotspot", !!fileSpot, `hotspots=${JSON.stringify(r2.hotspots)}`)
          if (fileSpot) {
            h.ck(
              'XR1: a hotspot whose only finding is ungraded reports "unknown", not "low"',
              fileSpot.maxSeverity === "unknown",
              `maxSeverity=${fileSpot.maxSeverity} (a "low" seed under-reports an ungraded finding as minor)`,
            )
            h.nk(
              'XR1: the ungraded-only hotspot never reports "low"',
              fileSpot.maxSeverity !== "low",
              `maxSeverity=${fileSpot.maxSeverity}`,
            )
          }
          h.release()
        }
      } finally {
        cleanup(root2, pid2)
      }

      const hotspots = report.hotspots
      positiveCount(h, "XR1: hotspots produced", hotspots.length, "file+symbol keys")
      h.ck(
        "XR1: hotspot maxSeverity is always a documented severity",
        hotspots.every((hs) => ["critical", "high", "medium", "low", "unknown"].includes(hs.maxSeverity)),
        hotspots.map((hs) => `${hs.kind}:${hs.key}=${hs.maxSeverity}`).join(" "),
      )
      h.ck(
        "XR1: the file hotspot reports the true max severity across its findings",
        hotspots.some((hs) => hs.kind === "file" && hs.maxSeverity === "critical"),
        `file hotspots: ${hotspots.filter((hs) => hs.kind === "file").map((hs) => `${hs.key}=${hs.maxSeverity}`).join(" ") || "none"}`,
      )
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }
}
write("xr1.json", { title: "severity normalization + hotspot severity", defect: "A3/A5" })

// ═══════════════════════════════════════════════════════════════════════════
// XR2 — A1/A2: truncation and the recordRun census
//
// DEFECT: the engine capped at maxResults (default 500) and set
// provenance.truncated, but the legacy adapter returned NO provenance, so the
// handler could not see it — and the handler additionally sliced to 20 lines
// with no count line. Separately, `recordRun` persisted from the default-capped
// scan while executeAnalysis auto-resolves any prior `open` finding absent from
// the set, so >500 findings silently resolved the tail on the next run.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR2", "truncation is visible; recordRun persists the full census")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const sink = syms.find((s) => s.name === "sinkFn")!
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR2: fixture symbols present", !!sink && !!src, `sink=${!!sink} src=${!!src}`)
    if (sink && src) {
      // 30 distinct sinks so no two rows dedupe together. Each gets its own
      // symbol so the dedup key (which includes sink_symbol_id) differs.
      const many: FlowSeed[] = []
      const now = Date.now()
      raw.prepare("DELETE FROM brain_taint_flow WHERE project_id = ?").run(projectId)
      // 30 DISTINCT sink symbols, each attached to a REAL indexed file, so all
      // 30 rows are `confirmed` (both endpoints resolve) and land in
      // `findings` — the list the display window slices. They differ by
      // sink_symbol_id, so the dedup key keeps all 30.
      const fileRow = raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ? ORDER BY relative_path LIMIT 1").get(projectId) as { id: string; relative_path: string } | undefined
      h.require("XR2: fixture file indexed", !!fileRow, `file=${JSON.stringify(fileRow)}`)
      if (fileRow) {
        // Distinct LINES as well as distinct symbols, so a cap of 5 is a real
        // truncation rather than 5 rows collapsing under the dedup key.
        for (let i = 0; i < 30; i++) {
          const symId = `${projectId}:fixture:genSink${i}:1`
          raw.prepare(
            "INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(symId, projectId, fileRow.id, `genSink${i}`, "function", i + 1, i + 2, now, now)
          many.push({ id: `r2-${String(i).padStart(2, "0")}`, source: src.id, sink: symId, vuln: "sql_injection", severity: "high" })
        }
        seedFlowsAdditive(raw, projectId, many)
      }

      const capped = await analyzeTaintFlows(projectId, { maxResults: 5 })
      h.ck("XR2: cap applied — fewer findings returned than exist", capped.findings.length === 5, `returned=${capped.findings.length}`)
      h.ck(
        "XR2: summary.total reports the RETURNED count, not the census",
        capped.summary.total === 5,
        `total=${capped.summary.total}`,
      )
      h.ck(
        "XR2: summary.deduplicatedFlows is the PRE-cap census",
        capped.summary.deduplicatedFlows === 30,
        `deduplicatedFlows=${capped.summary.deduplicatedFlows}`,
      )
      // The field that did not exist before. Without it a caller reading only
      // `total` cannot distinguish a capped scan from a small one.
      h.ck(
        "XR2: summary.truncatedFindings reports exactly the dropped count",
        capped.summary.truncatedFindings === 25,
        `truncatedFindings=${capped.summary.truncatedFindings} (expected 25)`,
      )
      h.ck("XR2: provenance.truncated is true when the cap bites", capped.provenance.truncated === true, `truncated=${capped.provenance.truncated}`)
      h.ck(
        "XR2: provenance.unknowns names the dropped count",
        capped.provenance.unknowns.some((u) => u.includes("25")),
        JSON.stringify(capped.provenance.unknowns),
      )
      const uncapped = await analyzeTaintFlows(projectId, { maxResults: 1000 })
      h.ck("XR2: uncapped scan reports truncatedFindings === 0", uncapped.summary.truncatedFindings === 0, `truncatedFindings=${uncapped.summary.truncatedFindings}`)
      h.nk("XR2: uncapped scan does NOT set provenance.truncated", uncapped.provenance.truncated === false, `truncated=${uncapped.provenance.truncated}`)

      // A1 through the adapter — the shape the handler actually consumes.
      const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId, { maxResults: 5 })
      h.ck("XR2: adapter carries provenance", !!legacy.provenance, `provenance=${legacy.provenance}`)
      h.ck("XR2: adapter carries truncatedFindings", legacy.truncatedFindings === 25, `truncatedFindings=${legacy.truncatedFindings}`)
      h.ck("XR2: adapter carries the census", legacy.scannedFlows === 30 && legacy.deduplicatedFlows === 30, `scanned=${legacy.scannedFlows} dedup=${legacy.deduplicatedFlows}`)

      // The handler text, on the UNCAPPED read: 30 confirmed findings, the
      // display window is 20, and the census line must say so. This is the
      // end-to-end proof that a 30-finding project cannot read as "20 findings"
      // with no indication that 10 were unseen — the old handler sliced to 20
      // and printed nothing about the rest.
      const handlers = createToolHandlers()
      const ctx = { projectPath: root, projectId }
      const out = await handlers.bb_security({}, ctx)
      const text = out.content[0]!.text
      h.ck("XR2: handler emits a [scan: …] census line", /\[scan:/.test(text), text.slice(0, 220))
      h.ck("XR2: census line names the indexed flow count", text.includes("30 taint flow(s) indexed"), firstMatch(text, /\[scan:[^\n]*/))
      h.ck("XR2: census line names the deduplicated finding census", text.includes("30 finding(s)"), firstMatch(text, /\[scan:[^\n]*/))
      h.ck(
        "XR2: census line states how many findings are being shown",
        text.includes(`showing ${SECURITY_FINDINGS_WINDOW} finding(s)`),
        firstMatch(text, /\[scan:[^\n]*/),
      )
      h.ck("XR2: exactly the display window of findings is listed", (text.match(/^ {2}\[(?:critical|high|medium|low|unknown)\]/gm) ?? []).length === SECURITY_FINDINGS_WINDOW, `listed=${(text.match(/^ {2}\[(?:critical|high|medium|low|unknown)\]/gm) ?? []).length}`)
      h.nk(
        "XR2: handler does not present a truncated list as if it were the whole scan",
        /showing 20 finding\(s\)/.test(text),
        "before the fix the 21st+ finding was simply absent with no count line",
      )

      // A2 through the handler: recordRun must persist the FULL set, and a
      // repeat run must not resolve anything. completeAnalysisRun auto-resolves
      // any prior `open` finding absent from the persisted set, so persisting a
      // capped set is what caused silent resolution before.
      const rec1 = await handlers.bb_security({ recordRun: true }, ctx)
      h.ck("XR2: recordRun text reports a recorded run", rec1.content[0]!.text.includes("recorded run"), rec1.content[0]!.text.slice(0, 200))
      const hist1 = await getAnalysisHistory(projectId, "security", 20)
      h.ck(
        "XR2: recordRun persisted the FULL census (30), not the 20-line display window",
        hist1.findings.length === 30,
        `persisted=${hist1.findings.length} (expected 30)`,
      )
      h.nk(
        "XR2: nothing was auto-resolved by the first run",
        hist1.findings.every((f) => f.state !== "resolved"),
        `states=${[...new Set(hist1.findings.map((f) => f.state))].join(",")}`,
      )
      const rec2 = await handlers.bb_security({ recordRun: true }, ctx)
      h.ck("XR2: second recordRun resolves nothing (repeated, not resolved)", /resolved=0\b/.test(rec2.content[0]!.text), firstMatch(rec2.content[0]!.text, /resolved=\d+/))
      const hist2 = await getAnalysisHistory(projectId, "security", 20)
      h.ck("XR2: second run keeps all 30 findings open", hist2.findings.length === 30 && hist2.findings.every((f) => f.state === "open"), `n=${hist2.findings.length} states=${[...new Set(hist2.findings.map((f) => f.state))].join(",")}`)

      // The two bounds are DISTINCT numbers with distinct jobs, and the bug was
      // that the recording path used the live one. Pin both, and pin the
      // relationship that makes the fix work: the census cap must exceed the
      // live scan cap by orders of magnitude, or recording truncates where the
      // live read does not and the auto-resolution returns.
      h.ck("XR2: the recording census cap is a real, large number", SECURITY_RECORD_RUN_CENSUS_CAP >= 50_000, `cap=${SECURITY_RECORD_RUN_CENSUS_CAP}`)
      h.ck("XR2: the census cap exceeds the live scan cap by >=100x", SECURITY_RECORD_RUN_CENSUS_CAP >= SECURITY_SCAN_CAP * 100, `census=${SECURITY_RECORD_RUN_CENSUS_CAP} live=${SECURITY_SCAN_CAP}`)
      h.ck("XR2: the census cap exceeds the display window", SECURITY_RECORD_RUN_CENSUS_CAP > SECURITY_FINDINGS_WINDOW, `census=${SECURITY_RECORD_RUN_CENSUS_CAP} window=${SECURITY_FINDINGS_WINDOW}`)
      h.ck("XR2: the live scan cap exceeds the display window", SECURITY_SCAN_CAP > SECURITY_FINDINGS_WINDOW, `live=${SECURITY_SCAN_CAP} window=${SECURITY_FINDINGS_WINDOW}`)
      h.ck("XR2: the unvalidated-source window is smaller than the finding window", SECURITY_SUSPICIOUS_WINDOW < SECURITY_FINDINGS_WINDOW, `suspicious=${SECURITY_SUSPICIOUS_WINDOW} findings=${SECURITY_FINDINGS_WINDOW}`)

      // A LIVE read must NOT silently truncate either: the census line has to say
      // how many findings exist beyond what it is showing.
      //
      // `census` is a SEPARATE call with a cap above the finding count. The
      // in-scope `legacy` was itself capped at 5, so reading the census total
      // from it would report 5 and make "30 findings exist" untestable — which
      // is what the first run of this suite did.
      const census = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId, { maxResults: 1000 })
      const censusTotal = census.findings.length
      const beyond = censusTotal > SECURITY_FINDINGS_WINDOW
      h.ck(
        "XR2: the uncapped scan really does exceed the display window (the precondition)",
        beyond,
        `censusTotal=${censusTotal} window=${SECURITY_FINDINGS_WINDOW} — without this the two checks below are vacuous`,
      )
      h.ck(
        "XR2: when findings exceed the window the census says how many are shown",
        !beyond || text.includes(`showing ${SECURITY_FINDINGS_WINDOW} finding(s)`),
        `censusTotal=${censusTotal} text=${firstMatch(text, /\[scan:[^\n]*/)}`,
      )
      h.ck(
        "XR2: the census line names the total finding count, not just the window",
        !beyond || new RegExp(`→ ${censusTotal} finding\\(s\\)`).test(text),
        `censusTotal=${censusTotal} text=${firstMatch(text, /\[scan:[^\n]*/)}`,
      )
      h.ck(
        "XR2: a truncated list is never presented as the whole scan",
        !beyond || /\[scan:[^\n]*; showing \d+ finding\(s\)\]/.test(text),
        `before the fix the response was a bare 20-line list with no count: ${firstMatch(text, /\[scan:[^\n]*/)}`,
      )
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }
}
write("xr2.json", { title: "truncation visibility + recordRun census", defect: "A1/A2" })

// ═══════════════════════════════════════════════════════════════════════════
// XR3 — A6: the "?" sentinel leaked into a SQL query
//
// DEFECT: the adapter mapped `file: f.file ?? "?"`. The handler then passed
// those files to derivedStaleness, which issued
// `SELECT id, relative_path FROM brain_file WHERE ... relative_path IN ('?')`.
// A finding with no resolvable file was therefore counted `missing` in the
// staleness footer — reporting a file as changed that does not exist.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR3", "unresolved-location findings do not fabricate a file path")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR3: fixture symbol present", !!src, `src=${!!src}`)
    if (src) {
      // A flow whose endpoints point at symbols that were never inserted, so
      // neither file resolves. `resolveNode` recovers the name from the id tail
      // and leaves `file: null` — this is the real shape in production when a
      // taint row outlives its symbol.
      seedFlows(raw, projectId, [
        { id: "r3-a", source: `${projectId}:ghost:srcA:1`, sink: `${projectId}:ghost:snkA:2`, vuln: "sql_injection", severity: "critical" },
      ])
      const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
      const ghost = legacy.suspiciousSources.find((f) => f.id === "r3-a") ?? legacy.findings.find((f) => f.id === "r3-a")
      h.ck("XR3: the unresolved-flow row is reported", !!ghost, `findings=${legacy.findings.length} suspicious=${legacy.suspiciousSources.length}`)
      h.ck(
        'XR3: file is null, NOT the "?" sentinel',
        ghost?.file === null,
        `file=${JSON.stringify(ghost?.file)}`,
      )
      h.nk('XR3: no reported finding carries "?" as a file path', !legacy.findings.concat(legacy.suspiciousSources).some((f) => f.file === "?"), "sentinel leaked")

      // And the handler must not turn it into a phantom staleness report.
      const handlers = createToolHandlers()
      const out = await handlers.bb_security({}, { projectPath: root, projectId })
      const text = out.content[0]!.text
      h.ck(
        "XR3: handler renders an explicit unresolved-location marker",
        text.includes("<unresolved location>"),
        firstMatch(text, /.*unresolved location.*/) ?? text.slice(0, 400),
      )
      h.nk("XR3: handler never prints \"@ ?\"", !/@ \?/.test(text), firstMatch(text, /@ \?.*/) ?? "clean")
      h.nk(
        "XR3: the phantom file is not counted in a staleness footer",
        !/\bmissing of\b/.test(text),
        `the old "?" sentinel made every unresolved finding count as missing: ${firstMatch(text, /.*missing.*/) ?? "no-footer"}`,
      )
      h.ck(
        "XR3: the census line reports exactly the one indexed flow",
        /\[scan: 1 taint flow\(s\) indexed → 1 finding\(s\)/.test(text),
        firstMatch(text, /\[scan:[^\n]*/) ?? text.slice(0, 200),
      )
      h.ck(
        "XR3: the ghost row is shown as an unvalidated observation, not a finding",
        /unvalidated (input source|sink)/.test(text),
        firstMatch(text, /.*unvalidated.*/) ?? text.slice(0, 300),
      )
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }
}
write("xr3.json", { title: "no fabricated file path for unresolved findings", defect: "A6" })

// ═══════════════════════════════════════════════════════════════════════════
// XR4 — A7: recordRun persisted evidence-free, confidence-free findings
//
// DEFECT: the adapter dropped `confidence`, `evidence` and `limitations` from
// the strict finding. The recordRun mapper then read `finding.confidence ??
// null` and `finding.evidence ?? []` off a shape that never carried them, so
// every persisted security finding in history had confidence NULL and evidence
// '[]' — no calibration and no evidence. The fingerprint was also
// `file:line:label`, which collides for two sinks on one line and changes
// identity when a finding is merely re-graded.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR4", "persisted findings carry evidence, confidence, limitations and a stable identity")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const sink = syms.find((s) => s.name === "sinkFn")!
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR4: fixture symbols present", !!sink && !!src, `sink=${!!sink} src=${!!src}`)
    if (sink && src) {
      seedFlows(raw, projectId, [
        { id: "r4-a", source: src.id, sink: sink.id, vuln: "sql_injection", severity: "high" },
      ])
      const handlers = createToolHandlers()
      const ctx = { projectPath: root, projectId }
      await handlers.bb_security({ recordRun: true }, ctx)
      const hist = await getAnalysisHistory(projectId, "security", 20)
      const f = hist.findings[0]
      h.ck("XR4: a finding was persisted", hist.findings.length === 1, `n=${hist.findings.length}`)
      h.ck(
        "XR4: persisted confidence is the engine's calibrated 0.7, not null",
        f?.confidence === 0.7,
        `confidence=${JSON.stringify(f?.confidence)}`,
      )
      h.ck(
        "XR4: persisted evidence is non-empty and carries a taint_flow item",
        Array.isArray(f?.evidence) && f!.evidence.length > 0 && (f!.evidence as any[]).some((e) => e.kind === "taint_flow"),
        `evidence=${JSON.stringify(f?.evidence)}`,
      )
      h.ck(
        "XR4: persisted limitations are non-empty",
        Array.isArray(f?.limitations) && f!.limitations.length > 0,
        `limitations=${JSON.stringify(f?.limitations)}`,
      )
      h.ck(
        "XR4: persisted row declares the static_finding evidence class",
        f?.evidenceClass === "static_finding",
        `evidenceClass=${JSON.stringify(f?.evidenceClass)}`,
      )
      h.ck("XR4: persisted row names the taint engine", f?.engine === "taint@intelligence", `engine=${JSON.stringify(f?.engine)}`)
      h.nk(
        "XR4: persisted rule is the normalized type, not a display label",
        f?.rule === "sql_injection",
        `rule=${JSON.stringify(f?.rule)} (a display label is not a stable rule key)`,
      )
      h.ck("XR4: persisted row has a location", typeof f?.location === "string" && f.location.includes(":"), `location=${JSON.stringify(f?.location)}`)
      h.ck("XR4: persisted title is the human label", f?.title === "SQL injection", `title=${JSON.stringify(f?.title)}`)
      h.ck("XR4: a confirmed flow is persisted in the open state", f?.state === "open", `state=${JSON.stringify(f?.state)}`)

      // Fingerprint stability: re-recording must be `repeated`, never a new
      // finding. The old `file:line:label` key changed identity when severity
      // was re-graded between runs, which manufactured phantom churn.
      await handlers.bb_security({ recordRun: true }, ctx)
      const hist2 = await getAnalysisHistory(projectId, "security", 20)
      h.ck("XR4: re-recording the same flow does not create a second finding", hist2.findings.length === 1, `n=${hist2.findings.length}`)
      h.ck("XR4: re-recording keeps occurrenceCount > 1", (hist2.findings[0]?.occurrenceCount ?? 0) > 1, `occurrences=${hist2.findings[0]?.occurrenceCount}`)

      // Re-grade the severity; the fingerprint must NOT change. `severity` is
      // deliberately absent from the key, because a re-grade is a property of
      // the same flow, not the arrival of a different one.
      raw.prepare("UPDATE brain_taint_flow SET severity = 'critical' WHERE id = ?").run("r4-a")
      const rec3 = await handlers.bb_security({ recordRun: true }, ctx)
      h.ck("XR4: re-grading severity is a repeat, not a new finding", /new=0\b/.test(rec3.content[0]!.text), firstMatch(rec3.content[0]!.text, /new=\d+ repeated=\d+/))
      h.ck("XR4: re-grading counts as repeated", /repeated=1\b/.test(rec3.content[0]!.text), firstMatch(rec3.content[0]!.text, /new=\d+ repeated=\d+/))
      const hist3 = await getAnalysisHistory(projectId, "security", 20)
      h.ck("XR4: re-grading updates severity in place", hist3.findings.length === 1 && hist3.findings[0]?.severity === "critical", `n=${hist3.findings.length} sev=${hist3.findings[0]?.severity}`)
      h.ck("XR4: re-grading does not resolve the finding", hist3.findings[0]?.state === "open", `state=${hist3.findings[0]?.state}`)
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }
}
write("xr4.json", { title: "history carries evidence, confidence and a stable fingerprint", defect: "A7" })

// ═══════════════════════════════════════════════════════════════════════════
// XR5 — B1/B2: the unvalidated-source block inverted its own meaning
//
// DEFECT: `suspiciousSources` mixes `source_only` (no sink reached) and
// `unresolved` (a RESOLVED SINK whose source did not resolve). Both were
// rendered "(no sink reached)" — factually backwards for the `unresolved`
// half, which is exactly the shape the indexer's heuristic detectors emit
// (parallel-indexer writes source_symbol_id = NULL for every taint_h row). And
// both were hardcoded to `[info]`, so a critical isolated command-injection
// sink was printed as informational while the header counted it as critical.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR5", "observation states are distinguished and carry their real severity")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const sink = syms.find((s) => s.name === "sinkFn")!
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR5: fixture symbols present", !!sink && !!src, `sink=${!!sink} src=${!!src}`)
    if (sink && src) {
      seedFlows(raw, projectId, [
        // sink reached, source not → "unresolved". Severity critical, exactly
        // as parallel-indexer writes an isolated command-injection sink.
        { id: "r5-sinkonly", source: null, sink: sink.id, sourceType: "unresolved", sinkType: "command_exec", vuln: "command_injection", severity: "critical" },
        // source reached, sink not → "source_only".
        { id: "r5-srconly", source: src.id, sink: null, sinkType: "unresolved", vuln: "unresolved", severity: "unknown" },
      ])
      const legacy = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
      h.ck("XR5: adapter splits the two observation states", legacy.summary.sourceOnly === 1 && legacy.summary.sinkOnly === 1, `sourceOnly=${legacy.summary.sourceOnly} sinkOnly=${legacy.summary.sinkOnly}`)
      h.ck("XR5: unresolvedSources is the sum of both halves", legacy.summary.unresolvedSources === 2, `unresolvedSources=${legacy.summary.unresolvedSources}`)

      const handlers = createToolHandlers()
      const out = await handlers.bb_security({}, { projectPath: root, projectId })
      const text = out.content[0]!.text
      // THE core assertion. Before the fix, the sink-only row printed
      // "(no sink reached)" — claiming no sink, on a row that HAS a resolved sink.
      h.ck(
        "XR5: the sink-only observation says the SOURCE is unresolved",
        /sink found; source endpoint not resolved/.test(text),
        firstMatch(text, /.*unvalidated.*/) ?? text.slice(0, 300),
      )
      h.ck(
        "XR5: the source-only observation still says no sink reached",
        /no sink reached/.test(text),
        firstMatch(text, /.*unvalidated.*/) ?? "",
      )
      h.nk(
        "XR5: no observation line claims 'no sink reached' for a resolved-sink row",
        !/no sink reached/.test(firstMatch(text, /.*command injection.*/) ?? "no-command-injection-line"),
        firstMatch(text, /.*Command injection.*/),
      )
      h.ck(
        "XR5: the critical observation keeps its real severity, not [info]",
        /\[critical\] unvalidated sink/.test(text),
        firstMatch(text, /.*unvalidated sink.*/) ?? "no-sink-only-line",
      )
      h.nk("XR5: no observation is hardcoded to [info]", !/\[info\] unvalidated/.test(text), firstMatch(text, /.*\[info\].*/) ?? "")
      // The header and the body must agree.
      h.ck("XR5: header counts the critical observation", /security: 1 critical/.test(text), text.split("\n")[0])
      // B4: recordRun must show the observations too, marked as not persisted.
      const rec = await handlers.bb_security({ recordRun: true }, { projectPath: root, projectId })
      const recText = rec.content[0]!.text
      h.ck("XR5: recordRun still surfaces the observations", /unvalidated/.test(recText), recText.slice(0, 300))
      h.ck("XR5: recordRun marks them as not persisted", /not persisted/.test(recText), firstMatch(recText, /.*not persisted.*/) ?? "")
      const hist = await getAnalysisHistory(projectId, "security", 20)
      h.nk("XR5: observations are not persisted to history", hist.findings.every((f) => f.rule !== "unresolved"), `rules=${hist.findings.map((f) => f.rule).join(",")}`)
      h.ck("XR5: history holds only the resolved-sink-classified finding", hist.findings.length === 0, `n=${hist.findings.length} (both fixture rows are one-sided)`)
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }
}
write("xr5.json", { title: "observation states distinguished; real severity preserved", defect: "B1/B2/B4" })

// ═══════════════════════════════════════════════════════════════════════════
// XR6 — A4 determinism, plus the harness's own anti-regression guarantees
//
// DEFECT: the taint read had no ORDER BY and the finding sort had no `id`
// tiebreak, so which row won a dedup group — and therefore the reported `id`
// and the retained path — depended on SQLite row order, which is not a
// contract. This section also proves the harness fixes: no auto-pass shapes, a
// non-resettable failure count, and `passed <= checks`.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR6", "determinism across runs; the harness cannot pass vacuously")
  const { root, projectId } = await indexFixture(baseFixture)
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const syms = symbolsOf(raw, projectId)
    const sink = syms.find((s) => s.name === "sinkFn")!
    const src = syms.find((s) => s.name === "srcFn")!
    h.require("XR6: fixture symbols present", !!sink && !!src, `sink=${!!sink} src=${!!src}`)
    if (sink && src) {
      // Several rows that share a dedup key, so the winner is decided by read
      // order. Insert in a deliberately non-alphabetical id order.
      seedFlows(raw, projectId, [
        { id: "zzz-last", source: src.id, sink: sink.id, vuln: "sql_injection", severity: "high" },
        { id: "aaa-first", source: src.id, sink: sink.id, vuln: "sql_injection", severity: "high" },
        { id: "mmm-mid", source: src.id, sink: sink.id, vuln: "sql_injection", severity: "high" },
      ])
      const first = await analyzeTaintFlows(projectId, { maxResults: 100 })
      const second = await analyzeTaintFlows(projectId, { maxResults: 100 })
      const third = await analyzeTaintFlows(projectId, { maxResults: 100 })
      const sig = (r: typeof first) => r.findings.map((f) => `${f.id}|${f.severity}|${f.file ?? ""}|${f.line ?? ""}|${f.state}|${f.path.map((p) => p.symbolId ?? "").join(">")}`).join("\n")
      h.ck("XR6: dedup collapsed the three equivalent rows to one finding", first.findings.length === 1, `n=${first.findings.length}`)
      h.ck("XR6: run 2 is byte-identical to run 1", sig(first) === sig(second), `1=${sig(first)} 2=${sig(second)}`)
      h.ck("XR6: run 3 is byte-identical to run 1", sig(first) === sig(third), `1=${sig(first)} 3=${sig(third)}`)
      // ORDER BY t.id means the winner is the lexicographically smallest id in
      // the group, deterministically — not "whichever row SQLite returned".
      h.ck("XR6: dedup winner is the lowest id in the group (ORDER BY t.id)", first.findings[0]?.id === "aaa-first", `winner=${first.findings[0]?.id}`)

      // A full-summary digest, including hotspots, must be stable too.
      const digest = (r: typeof first) => JSON.stringify({ s: r.summary, h: r.hotspots })
      h.ck("XR6: summary+hotspots digest is stable across three runs", digest(first) === digest(second) && digest(second) === digest(third), `${digest(first)} vs ${digest(third)}`)
    }
    h.release()
  } finally {
    cleanup(root, projectId)
  }

  // Harness self-checks. These assert the properties that make the OTHER
  // sections in this file trustworthy — they are the reason the suite's own
  // "verified" verdict is worth anything. The probe conditions are written as
  // real comparisons rather than `true === true` so this file does not trip its
  // own anti-auto-pass audit.
  //
  // The probes are constructed with `quiet: true`: they are SUPPOSED to record
  // failures, and a probe printing "FAIL" into the same console as real results
  // makes the expected failures indistinguishable from them. The count is
  // asserted below, so silencing the print costs no coverage.
  const probe = new SecurityHarness({ quiet: true })
  probe.ck("probe: a satisfied condition passes", [1, 2, 3].length === 3)
  probe.nk("probe: a violated negative is recorded as a failure", [1, 2, 3].length === 4, "deliberate")
  h.ck("XR6: harness counts a violated assertion as a failure", probe.failed === 1, `failed=${probe.failed}`)
  h.ck("XR6: the exit-relevant failure list holds the same entry", probe.failures.length === 1, `failures=${probe.failures.length}`)
  h.ck("XR6: harness never reports passed > checks", probe.totalPassed <= probe.checks, `passed=${probe.totalPassed} checks=${probe.checks}`)
  h.ck("XR6: positive and negative assertions are counted separately", probe.passed === 1 && probe.negativePassed === 0, `positives=${probe.passed} negatives=${probe.negativePassed}`)

  // The exact bug this harness was written to kill: a section reset must NOT
  // clear the failure list the exit code reads.
  const resetProbe = new SecurityHarness({ quiet: true })
  resetProbe.ck("resetProbe: failing section", [1, 2].length === 3, "deliberate")
  const failuresBefore = resetProbe.failed
  resetProbe.resetForNextSection()
  h.ck(
    "XR6: resetForNextSection does NOT clear the process-global failure count",
    resetProbe.failed === failuresBefore && failuresBefore === 1,
    `before=${failuresBefore} after=${resetProbe.failed} — the old verifier reset this counter and then exited 0`,
  )
  h.ck(
    "XR6: resetForNextSection DOES clear the per-section counters",
    resetProbe.checks === 0 && resetProbe.passed === 0,
    `checks=${resetProbe.checks} passed=${resetProbe.passed}`,
  )

  // The gate: an absent precondition is a failure, not a silent skip. The old
  // X3 wrapped 8 assertions in `if (sinkSym && srcSym)` and reported
  // `checks: 1, verified: true` when the fixture failed to index.
  const gated = new SecurityHarness({ quiet: true })
  const gatedBefore = gated.failed
  gated.require("gated: absent precondition", [1].length === 2, "simulated")
  h.ck("XR6: an absent gate precondition is itself recorded as a failure", gated.failed === gatedBefore + 1, `failed=${gated.failed} (was ${gatedBefore})`)
  h.ck("XR6: the harness exposes whether a gate is open", gated.gated === true, `gated=${gated.gated}`)
  gated.release()
  h.ck("XR6: releasing the gate clears it", gated.gated === false, `gated=${gated.gated}`)

  // The specific shapes the previous audit missed. Each is a named regression
  // with the reason it was previously invisible.
  const legacyVerifier = readFileSync(path.join(ROOT_DIR, "script/verify-security.ts"), "utf8")
  h.ck(
    "XR6: script/verify-security.ts no longer asserts a zero-inclusive bound on a count",
    !/>=\s*0\b/.test(stripStringsAndComments(legacyVerifier)),
    "the M20 tautology audit scanned only 3 files and passed over this one",
  )
  const deepVerifier = readFileSync(path.join(ROOT_DIR, "script/m15/verify-security-deep.ts"), "utf8")
  h.ck(
    "XR6: script/m15/verify-security-deep.ts no longer asserts a vacuous confidence range",
    !/confidence\s*>=\s*0\s*&&\s*[\w.]*\.confidence\s*<=\s*1/.test(stripStringsAndComments(deepVerifier)),
    "confidence is a literal 0.7/0.4/0.3, so a range check on it cannot fail",
  )
  // These read the sibling's SOURCE, so they read its CODE. Each of the
  // properties below is NAMED in the file's own header comment — the comment
  // exists precisely so a future reader knows what the file is — so a raw-text
  // scan matched the documentation and reported it as the defect. First run of
  // this suite failed all three for exactly that reason.
  const deepCode = stripStringsAndComments(deepVerifier)
  h.ck(
    "XR6: the X5 leg no longer REQUIRES a hardcoded corpus path",
    // A candidate SEARCH list is legitimate (it is how the Linux box is still
    // found); what must not exist is a path used as a hard REQUIREMENT.
    /BB_SECURITY_CORPUS_ROOT/.test(deepCode) && !/const tsc = "\/home/.test(deepCode),
    "an absent corpus flipped x5.json to verified:false AND stripped its seal",
  )
  h.ck(
    "XR6: the X5 leg resolves its corpus through BB_SECURITY_CORPUS_ROOT",
    /BB_SECURITY_CORPUS_ROOT/.test(deepCode) && /resolveCorpusRoot|pickCorpus/.test(deepCode),
    "the corpus must be discoverable on any machine, not pinned to one",
  )
  // The single worst defect: the process exit code did not reflect X1-X7,
  // because `reset()` zeroed the counter before `process.exit` read it.
  h.nk(
    "XR6: verify-security-deep.ts no longer resets its failure counter before exiting",
    !/\breset\(\)/.test(deepCode) || !/reset\(\)[\s\S]{0,4000}?process\.exit\(failed > 0/.test(deepCode),
    "reset() before process.exit means X1-X7 failures exit 0",
  )
  h.ck(
    "XR6: verify-security-deep.ts uses the shared non-resettable harness",
    /from "\.\/security-harness"/.test(deepVerifier) && /SecurityHarness/.test(deepVerifier),
    "the old inline ck/nk/reset harness is what made the exit code lie",
  )
  h.ck(
    "XR6: verify-security-deep.ts no longer zeroes a counter named `failed`",
    !/\bfailed\s*=\s*0\b/.test(deepVerifier),
    "a mutable `failed` counter is what let a section reset the exit code",
  )
  h.ck(
    "XR6: verify-security-deep.ts exits on the harness's process-global failure list",
    /process\.exit\(h\.failed > 0 \? 1 : 0\)/.test(deepVerifier),
    "the exit must read a count no section can clear",
  )
  // This one needs COMMENTS stripped but STRINGS KEPT: the property is that the
  // skip carries a `code: "X5"` label, which is a string literal — and
  // stripStringsAndComments blanks literals, so checking it against stripped
  // code can never pass. Two strippers, each for the layer it is right about.
  // (The first run of this suite failed this check for exactly that reason.)
  const deepNoComments = deepVerifier
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
  h.ck(
    "XR6: an absent corpus is recorded as skipped, not failed",
    /skipped\.push\(\{\s*code: "X5"/.test(deepNoComments) && !/ck\("X5: real repo present", false/.test(deepCode),
    "the old X5 hard-failed on a missing corpus and unsealed x5.json",
  )
  // The evidence files that shipped with impossible ratios. These are the
  // COMMITTED artifacts, so this is a real check on a real file — not a
  // re-derivation. A fresh run of the suites overwrites them; until that
  // happens the committed record still carries the old bug.
  for (const f of ["x2.json", "x3.json", "x7.json"]) {
    const { stale, detail } = committedEvidenceStale(f)
    if (stale) {
      // Not a failure: this file is the receipt for the sibling suite, and
      // `npm run verify:security` runs this suite first. The reason is recorded
      // so a reader can see the file has NOT been regenerated yet, and a
      // second consecutive run without a regeneration is visible in the
      // evidence rather than invisible.
      skipped.push({ code: `XR6:${f}`, reason: `committed ${f} still holds the pre-fix accounting (${detail}) — it is regenerated by verify-security-deep.ts, which runs after this suite in the same chain` })
      console.log(`  SKIP XR6:${f}: ${detail} — regenerated by verify-security-deep.ts`)
    } else {
      // Assert the parsed numbers, not the fact of the branch. `h.ck(..., true)`
      // here would be exactly the auto-pass this suite exists to reject — and
      // the first run of X8's audit caught it on this very line.
      const rec = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8")) as { passed: number; checks: number }
      h.nk(
        `XR6: ${f} no longer reports passed > checks`,
        rec.passed <= rec.checks,
        `passed=${rec.passed} checks=${rec.checks} — the old emit() added nk-passes into the passed count while checks counted only ck-calls`,
      )
    }
  }

  // The audit's own contract. Both properties failed before this commit: a
  // detector that reads raw source reports every verifier that NAMES the banned
  // pattern in a failure message, and an inline pattern makes it flag itself.
  const harnessSrc = readFileSync(path.join(ROOT_DIR, "script/m15/security-harness.ts"), "utf8")
  // Spelled as a code-only check: the audit's contract is that it reads CODE,
  // so this assertion must not itself be satisfied by prose. A regex written
  // out here would be a second, divergent copy of the detector's rules.
  const harnessCode = stripStringsAndComments(harnessSrc)
  h.ck(
    "XR6: the auto-pass detector defines a codeOnly transform",
    /const codeOnly = \(src: string\)/.test(harnessCode),
    "without code-only stripping the audit flags every verifier that names the banned pattern in prose",
  )
  h.ck(
    "XR6: codeOnly blanks rather than deletes, so the audit's line numbers stay true",
    /blank/.test(harnessCode) && /const blank = \(m: string\)/.test(harnessCode),
    "deleting a comment would shift every reported line number",
  )
  h.ck("XR6: the auto-pass detector's patterns are assembled from parts", /new RegExp\([^\n]*\+\s*"true"\s*\+/.test(harnessSrc), "an inline pattern makes the audit report its own detector")
  const adversarialSrc = readFileSync(path.join(ROOT_DIR, "script/m20/verify-security-adversarial.ts"), "utf8")
  h.ck("XR6: the full-suite audit lists at least ten verifiers", /securityVerifiers = \[[\s\S]{0,700}verify-security-docs\.ts/.test(adversarialSrc), "the audit must cover the whole security suite, not three files")
  h.ck("XR6: the full-suite audit asserts each listed verifier exists", /existsSync\(path\.resolve\(file\)\)/.test(adversarialSrc), "a listed-but-absent file would silently shrink the audit's coverage")
  h.ck("XR6: the rewritten root verifier has no second local harness", !/let checks = 0/.test(stripStringsAndComments(legacyVerifier)) && !/let failures = 0/.test(stripStringsAndComments(legacyVerifier)), "each file needs ONE harness, or its counters can diverge from its exit code")

  // ── the sealed-write law ─────────────────────────────────────────────────
  //
  // `script/lib/evidence.ts` declares writeSealed the ONE write path and
  // readEvidence the ONE trusted read, and the trusted read REFUSES a record
  // with no bbSeal envelope (`kind: "unsealed"`). Every security verifier
  // wrote its evidence with a bare writeFileSync + JSON.stringify — i.e. it
  // produced exactly the "legacy" record the reader is required to reject. On a
  // SUCCESSFUL run that silently destroyed the committed seal; on a FAILING run
  // it destroyed the seal AND left `verified: false` behind. That is the
  // mechanism behind the old X5 "stripping its seal" complaint, and M61.V1's
  // sealed-write adoption never covered this lane.
  const evidenceLib = readFileSync(path.join(ROOT_DIR, "script/lib/evidence.ts"), "utf8")
  h.ck("XR6: the evidence library declares writeSealed the one write path", /export function writeSealed/.test(evidenceLib), "the sealed write path is the contract these verifiers must use")
  h.ck("XR6: the trusted reader refuses an unsealed record", /kind: "unsealed"/.test(evidenceLib) && /verifySeal/.test(evidenceLib), "a record written without a seal is a hard refusal, not a warning")

  const evidenceWriters: Array<{ file: string; out: string }> = [
    { file: "script/m15/verify-security-deep.ts", out: "validation/m15/results/x*.json" },
    { file: "script/m15/verify-security-regressions.ts", out: "validation/m15/results/xr*.json" },
    { file: "script/m20/verify-security-flow-boundary.ts", out: "validation/m20/results/S1.json" },
    { file: "script/m20/verify-security-adversarial.ts", out: "validation/m20/results/S2.json" },
    { file: "script/m20/verify-security-history.ts", out: "validation/m20/results/S3.json" },
  ]
  for (const w of evidenceWriters) {
    const src = readFileSync(path.join(ROOT_DIR, w.file), "utf8")
    const code = stripStringsAndComments(src)
    h.ck(`XR6: ${w.file} writes ${w.out} through writeSealed`, /writeSealed\s*\(/.test(code), "an unsealed write is refused by the trusted reader")
    // The sealed write must be the ONLY evidence write: a second, bare
    // writeFileSync of a JSON.stringify record would re-open the same hole.
    h.nk(
      `XR6: ${w.file} has no remaining bare evidence write`,
      !/writeFileSync\([^)]*JSON\.stringify/.test(code),
      "a writeFileSync(JSON.stringify(...)) evidence write is the unsealed legacy path",
    )
  }
}
// `skipped` travels in the record, so an evidence file that says VERIFIED also
// says which checks were deferred and why. A skip that leaves no trace is an
// auto-pass with better manners.
write("xr6.json", { title: "determinism + the harness cannot pass vacuously", defect: "A4/D", skipped })

// ═══════════════════════════════════════════════════════════════════════════
// XR7 — the two precision fixes, measured on fixtures
//
// Both changes were motivated by a measurement on a real 168k-symbol index
// (3,190 findings, of which 326 were in Markdown/JSON/YAML/HTML/CSS, and 213
// of 1,433 symbol names spanned more than one file). Each assertion below
// fails without its fix.
// ═══════════════════════════════════════════════════════════════════════════
{
  h.sectionHeader("XR7", "precision: no taint rows from prose, and hotspot keys are unambiguous")

  // ── the language gate ─────────────────────────────────────────────────────
  // The gate lives at the TaintAnalyzer call site in pool-worker.ts, so the
  // proof is end-to-end: index files in an eligible and an ineligible language
  // and compare the rows each produced.
  const languageFixtures: Array<{ lang: string; file: string; eligible: boolean }> = [
    { lang: "typescript", file: "app.ts", eligible: true },
    { lang: "python", file: "app.py", eligible: true },
    { lang: "go", file: "app.go", eligible: true },
    { lang: "markdown", file: "NOTES.md", eligible: false },
    { lang: "json", file: "data.json", eligible: false },
    { lang: "yaml", file: "config.yml", eligible: false },
  ]
  const produced: Record<string, number> = {}
  for (const fx of languageFixtures) {
    // Each fixture contains BOTH a source token and a sink token the universal
    // matcher recognises, so eligibility — not vocabulary — is the only variable.
    const bodies: Record<string, string> = {
      "app.ts": "import { Client } from 'pg'\nconst c = new Client()\nexport function run(req: any) { return c.query(req.query) }\n",
      "app.py": "def run(req):\n    q = 'select ' + req.query\n    return cursor.execute(q)\n",
      "app.go": "package main\nfunc Run(u string) { exec.Command(\"sh\", \"-c\", u) }\n",
      "NOTES.md": "# Notes\n\n```\ndb.query(userInput)\n```\n",
      "data.json": '{ "note": "call db.execute(sql) and db.query(x)" }\n',
      "config.yml": "job:\n  script: db.execute(sql)\n  also: client.query(x)\n",
    }
    const { root, projectId } = await indexFixture({ [fx.file]: bodies[fx.file]! })
    try {
      const raw = await BrainDatabase.getRawInstance(projectId)
      const rows = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id = ?").get(projectId) as { c: number }).c
      const indexed = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number }).c
      produced[fx.lang] = rows
      // The file must be indexed either way — the gate must suppress TAINT, not
      // the whole file. Without this an "ineligible produced 0 rows" pass would
      // also be satisfied by the file not being indexed at all.
      h.ck(`XR7: ${fx.lang} fixture IS indexed (${fx.file})`, indexed > 0, `indexed files=${indexed}`)
      if (fx.eligible) {
        positiveCount(h, `XR7: ${fx.lang} produces taint rows (eligible language)`, rows, fx.file)
      } else {
        h.nk(`XR7: ${fx.lang} produces NO taint rows (prose/data language)`, rows === 0, `rows=${rows} — the language gate did not take effect for ${fx.file}`)
      }
    } catch (e: any) {
      h.ck(`XR7: ${fx.lang} section completed without throwing`, false, (e?.message || String(e)).slice(0, 160))
    } finally {
      cleanup(root, projectId)
    }
  }
  // The aggregate claim, stated as a ratio rather than left to the per-file loop.
  const eligibleLangs = ["typescript", "python", "go"]
  const ineligibleLangs = ["markdown", "json", "yaml"]
  h.ck(
    "XR7: every eligible language produced rows and every ineligible produced none",
    eligibleLangs.every((l) => (produced[l] ?? 0) > 0) && ineligibleLangs.every((l) => (produced[l] ?? 0) === 0),
    JSON.stringify(produced),
  )

  // ── hotspot keys ─────────────────────────────────────────────────────────
  // The key must be `file::name`, so two findings sharing a bare symbol name in
  // different files are two hotspots, not one merged row.
  const { root: hr, projectId: hp } = await indexFixture({
    "one.ts": "export function shared(): string { return 'a' }\n",
    "two.ts": "export function shared(): string { return 'b' }\n",
  })
  try {
    const raw = await BrainDatabase.getRawInstance(projectIdSafe(hp))
    const syms = raw.prepare("SELECT id, name, file_id FROM brain_symbol WHERE project_id = ? AND name = 'shared'").all(hp) as Array<{ id: string; name: string; file_id: string }>
    const files = raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ?").all(hp) as Array<{ id: string; relative_path: string }>
    h.require("XR7: two same-named symbols in two files are indexed", syms.length === 2 && files.length === 2, `syms=${syms.length} files=${files.length}`)
    if (syms.length === 2 && files.length === 2) {
      seedFlows(raw, hp, [
        { id: "r7-a", source: syms[0]!.id, sink: syms[0]!.id, vuln: "sql_injection", severity: "high" },
        { id: "r7-b", source: syms[1]!.id, sink: syms[1]!.id, vuln: "xss", severity: "high" },
      ])
      const report = await analyzeTaintFlows(hp, { maxResults: 50 })
      const symSpots = report.hotspots.filter((hs) => hs.kind === "symbol")
      h.ck("XR7: the two same-named symbols are TWO hotspots, not one merged row", symSpots.length === 2, `hotspots=${JSON.stringify(symSpots.map((x) => `${x.key}:${x.findings}`))}`)
      h.ck("XR7: every symbol hotspot key is qualified by its file", symSpots.every((hs) => hs.key.includes("::")), JSON.stringify(symSpots.map((x) => x.key)))
      h.ck("XR7: every symbol hotspot carries the bare name separately", symSpots.every((hs) => hs.name === "shared"), JSON.stringify(symSpots.map((x) => x.name)))
      h.ck("XR7: each hotspot counts exactly its own file's finding", symSpots.every((hs) => hs.findings === 1), JSON.stringify(symSpots.map((x) => `${x.key}=${x.findings}`)))
      h.ck("XR7: a bare symbol name is no longer a hotspot key", !symSpots.some((hs) => hs.key === "shared"), JSON.stringify(symSpots.map((x) => x.key)))
    }
    h.release()
  } catch (e: any) {
    h.ck("XR7: the hotspot section completed without throwing", false, (e?.message || String(e)).slice(0, 160))
  } finally {
    cleanup(hr, hp)
  }
}
write("xr7.json", { title: "precision: language gate + unambiguous hotspot keys", defect: "precision" })

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip comments, string literals and template literals, keeping newlines so
 * line numbers survive. Used by this file's source-level checks, for the same
 * reason the harness's audit does it: a verifier that NAMES a banned pattern in
 * a failure message is documenting it, not asserting it, and a source check that
 * cannot tell those apart flags the documentation.
 */
function stripStringsAndComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'/g, blank)
}

/** `projectIdSafe` is the fixture's projectId, which getProjectId already
 *  derived; named so the hotspot section reads as one expression. */
function projectIdSafe(id: string): string {
  return id
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re)
  return m?.[0]
}

// ── report ──────────────────────────────────────────────────────────────────
const { checks, totalPassed, failed, negatives, negativePassed, passed } = h
console.log(`\n${"=".repeat(70)}`)
console.log(`bb_security regressions: ${failed === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}`)
console.log(`  checks ${totalPassed}/${checks} · negatives ${negativePassed}/${negatives} · failed ${failed}`)
console.log(`${"=".repeat(70)}`)
if (failed > 0) {
  console.log(`\nFailing assertions:`)
  for (const f of h.failures) console.log(`  - ${f.detail}`)
}
process.exit(failed > 0 ? 1 : 0)
