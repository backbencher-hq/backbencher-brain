// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_security: it validates the two doors
// (live read and recorded run), calls the strict taint engine, and renders the
// findings answer with its census, unvalidated observations and staleness.
// WHICH TOOL IT SERVES — bb_security (mutability read, requiresIndex true,
//   modes: findings; plannedModes flow, summary, hotspots).
// WHY IT IS SHAPED THIS WAY — the engine resolves index rows; this file makes
//   every claim in the answer true and bounded:
//     * a read must not write, so every read opens the index read-only, and an
//       unindexed project is refused HERE — the MCP server and the CLI have their
//       own gates, but the library door calls this function directly and the
//       read-write open used to create an empty index and print a false "clean";
//     * a capped scan must say so: the census line and the CAPPED note are
//       derived from the engine's own pre-cap count, never from what fitted on
//       screen (the sentence must not be reserved for recordRun);
//     * an observation is not a finding: one-sided flows render in their own
//       block with their real severity and are never persisted to history;
//     * history is a page, not a database dump: its findings are capped at
//       SECURITY_HISTORY_FINDINGS_CAP with findingsTotal/findingsTruncated
//       declared, and `limit` bounds runs only;
//     * staleness is reported with MANUAL remediation: this tool has no
//       `refresh` option and never reindexes, so the answer names only controls
//       it accepts;
//     * recordRun is the one write: it scans the way a read does and persists a
//       census-sized snapshot so a cap cannot auto-resolve an unexamined finding.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_security.md, docs/BB_SECURITY.md,
//   validation/tools/bb_security/**; gates: script/m13/verify-security-*.ts,
//   script/m15/verify-security-deep.ts, script/m20/verify-security-*.ts,
//   script/verify-security.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_security/descriptor.ts,
//   src/intelligence/security/taint.ts, src/security/cross-language-security.ts,
//   script/tool-docs/curation/bb_security.ts, the security gate scripts.
// CONTRACTS IT MUST NOT BREAK — read-only reads, declared census and cap,
//   declared absence (zero findings still states the census), observations never
//   persisted, history bound declared with its total, freshness flags, and the
//   no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import {
  textResult,
  SECURITY_FINDINGS_WINDOW,
  SECURITY_SUSPICIOUS_WINDOW,
  SECURITY_SCAN_CAP,
  SECURITY_RECORD_RUN_CENSUS_CAP,
} from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { CrossLanguageSecurityAnalysis } from "../../../security/cross-language-security"
import { executeAnalysis } from "../../../intelligence/analysis/run-history"
import { resolveRowsFreshnessDetailed, type FreshnessSummary } from "../../../brain/freshness"
import type { AnalysisFindingInput } from "../../../intelligence/contracts"
import { formatSecurityTierDeclaration, securityEntryFor } from "../../../intelligence/security/rebuild/registry"
import { readSecurityFlows } from "../../../intelligence/security/rebuild/store"

/** History is a page: at most this many persisted findings are rendered. */
const SECURITY_HISTORY_FINDINGS_CAP = 200

/**
 * Manual staleness for this tool's text answer.
 *
 * The shared `derivedStaleness` footer quotes the registered remediation, which
 * names automatic refresh (`BB_NO_AUTO_REFRESH=1`, `refresh=false`). This tool
 * accepts neither and never reindexes a file to make an answer fresh (measured:
 * the answer is byte-identical with automatic refresh allowed and disabled), so
 * quoting that text described a different tool. The detection is the registered
 * resolver; only the remediation sentence is this tool's own.
 */
const MANUAL_REFRESH_REMEDIATION =
  "manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)"

function securityStaleness(
  raw: any,
  projectId: string,
  relPaths: Array<string | null | undefined>,
): { isStale: (rel: string | null | undefined) => boolean; footer: string; summary: FreshnessSummary } {
  const rels = [...new Set(relPaths.filter((p): p is string => !!p))]
  const relToId = new Map<string, string>()
  if (rels.length) {
    const rows = raw
      .prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${rels.map(() => "?").join(",")})`)
      .all(projectId, ...rels) as Array<{ id: string; relative_path: string }>
    for (const row of rows) relToId.set(row.relative_path, row.id)
  }
  const rows = rels.map((p) => ({ fileId: relToId.get(p) ?? null }))
  const detail = rows.length ? resolveRowsFreshnessDetailed(raw, projectId, rows) : null
  const statuses = detail?.statuses ?? new Map<string, string>()
  let fresh = 0
  let stale = 0
  let missing = 0
  for (const row of rows) {
    const status = statuses.get(row.fileId ?? "")
    if (status === "fresh") fresh++
    else if (status === "stale") stale++
    else missing++
  }
  const summary: FreshnessSummary = {
    fresh,
    stale,
    missing,
    staleRatio: rows.length ? (stale + missing) / rows.length : 0,
    freshnessMode: "complete",
  }
  return {
    isStale: (rel) => rel != null && statuses.get(relToId.get(rel) ?? "") === "stale",
    footer: stale + missing > 0 ? `${stale} stale, ${missing} missing of ${rows.length} referenced file(s) — ${MANUAL_REFRESH_REMEDIATION}` : "",
    summary,
  }
}

/** The six finding states, in the order the history page renders them. */
const HISTORY_STATES = ["open", "resolved", "suppressed", "reopened", "mitigated", "stale"] as const
const HISTORY_STATE_ORDER: Record<string, number> = { open: 0, reopened: 1, mitigated: 2, stale: 3, suppressed: 4, resolved: 5 }

function parseHistoryJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Read the persisted security history without opening a writeable handle.
 *
 * The shared `getAnalysisHistory` opens the database read-write and runs
 * `ensureHistorySchema`, because it also serves the recording path. A read must
 * not write (that is the tool's declared boundary), so the history answer reads
 * the same tables through the read-only connection the handler already holds and
 * maps them with the shared record shape. The m13 handler verifier compares this
 * page with `getAnalysisHistory` on the same project, so the mapping cannot
 * silently drift from the recorder's schema.
 */
function readSecurityHistory(raw: any, projectId: string, limit: number) {
  const runs = (raw
    .prepare("SELECT * FROM brain_analysis_run WHERE project_id = ? AND kind = 'security' ORDER BY started_at DESC LIMIT ?")
    .all(projectId, limit) as any[]).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    engineVersion: row.engine_version,
    inputHash: row.input_hash,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    findingCount: row.finding_count,
    error: row.error ?? null,
  }))
  let rows: any[] = []
  try {
    rows = raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id = ? AND kind = 'security'").all(projectId) as any[]
  } catch {
    // A pre-history index has no analysis tables at all; an empty history is the
    // honest answer, and the read-only connection must not create them.
    rows = []
  }
  const findings = rows
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      fingerprint: row.fingerprint,
      rule: row.rule,
      title: row.title,
      severity: row.severity,
      state: typeof row.state === "string" && (HISTORY_STATES as readonly string[]).includes(row.state) ? row.state : "open",
      confidence: row.confidence ?? null,
      evidence: parseHistoryJson(row.evidence),
      location: row.location ?? null,
      limitations: parseHistoryJson(row.limitations).filter((item): item is string => typeof item === "string"),
      evidenceClass: row.evidence_class ?? null,
      engine: row.engine ?? null,
      engineVersion: row.engine_version ?? null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      resolvedAt: row.resolved_at ?? null,
      suppressedAt: row.suppressed_at ?? null,
      mitigatedAt: row.mitigated_at ?? null,
      occurrenceCount: row.occurrence_count,
    }))
    .sort((a, b) => HISTORY_STATE_ORDER[a.state] - HISTORY_STATE_ORDER[b.state] || b.lastSeenAt - a.lastSeenAt || a.fingerprint.localeCompare(b.fingerprint))
  const summary = Object.fromEntries(HISTORY_STATES.map((state) => [state, findings.filter((finding) => finding.state === state).length]))
  return { runs, findings, summary }
}

function observedPaths(findings: any[], suspicious: any[]): Array<string | null | undefined> {
  return [...findings, ...suspicious].map((finding) => (typeof finding?.file === "string" ? finding.file : null))
}

/**
 * Per-project language declaration. The matrix and any agent must be able to
 * tell "this project was not scanned" from "no leads were found": an
 * unsupported language (JSON, YAML, SQL, Vue, ...) has no executable source
 * model, so a clean-looking zero would be a lie. The tier registry is the source
 * of truth; this function only reads the project's file languages.
 */
function projectLanguageDeclaration(raw: any, projectId: string): string {
  let languages: string[] = []
  try {
    const rows = raw.prepare("SELECT DISTINCT language FROM brain_file WHERE project_id = ?").all(projectId) as Array<{ language: string | null }>
    languages = [...new Set(rows.map((r) => (r.language ?? "").trim().toLowerCase()).filter(Boolean))]
  } catch {
    return ""
  }
  const unsupported: Array<{ language: string; reason: string }> = []
  let leads = 0
  for (const language of languages.sort()) {
    const entry = securityEntryFor(language)
    if (entry.tier === "unsupported") unsupported.push({ language, reason: entry.reason })
    else if (entry.tier === "leads") leads++
  }
  const parts: string[] = []
  if (unsupported.length > 0) {
    parts.push(
      `not scanned by bb_security (no executable source model): ${unsupported.map((u) => u.language).join(", ")} — ${unsupported[0]!.reason}`,
    )
  }
  if (leads > 0) parts.push(`leads tier: ${leads} language(s) present; lexical output only`)
  if (languages.length === 0) parts.push("no indexed files — nothing was scanned by bb_security")
  return parts.length > 0 ? `\n${parts.join("\n")}` : ""
}

export const handler: ToolHandler = async (args, { projectId }) => {
  // ── Argument contract this handler owns (the schema alone cannot) ────────
  // `limit` is a live lead page size AND the history run limit; `offset` pages
  // live leads only (the history page has its own bounded shape).
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error("bb_security: limit must be a positive integer (live lead page size, or history run limit)")
  }
  if (args.offset !== undefined) {
    if (!Number.isInteger(args.offset) || args.offset < 0) {
      throw new Error("bb_security: offset must be a non-negative integer (live lead pagination only)")
    }
    if (args.history === true) {
      throw new Error("bb_security: offset does not apply to the history page — omit offset when history: true")
    }
  }
  if (args.history === true && args.recordRun === true) {
    throw new Error(
      "bb_security: history and recordRun are different answers — pass at most one (history reads the persisted runs; recordRun scans and persists a new one)",
    )
  }

  // ── Read-only preflight: refuse an unindexed project at EVERY door ───────
  // `readonly: true` validates the index and throws with the actionable message.
  // The MCP server and the CLI have equivalent gates; the library door calls
  // this function directly, and a read-write open there would silently CREATE an
  // empty index and print a clean report for code that was never scanned.
  let raw: any
  try {
    raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  } catch (error: any) {
    throw new Error(`bb_security: ${error?.message ?? String(error)}`)
  }

  // ── History page ─────────────────────────────────────────────────────────
  if (args.history === true) {
    const limit = Number(args.limit ?? 20)
    const history = readSecurityHistory(raw, projectId, limit)
    const findings = history.findings.slice(0, SECURITY_HISTORY_FINDINGS_CAP)
    const findingsTotal = history.findings.length
    const truncated = Math.max(0, findingsTotal - findings.length)
    return textResult(
      JSON.stringify(
        {
          runs: history.runs,
          findings,
          findingsTotal,
          findingsShown: findings.length,
          findingsTruncated: truncated,
          ...(truncated > 0
            ? { truncationReason: `history findings are capped at ${SECURITY_HISTORY_FINDINGS_CAP}; findingsTotal is the complete persisted count` }
            : {}),
          summary: history.summary,
          census: { runsTotal: history.runs.length, runLimit: limit, findingsTotal, findingsShown: findings.length, findingsBeyondCap: truncated },
        },
        null,
        2,
      ),
    )
  }

  // ── Phase-1 live read: the spec-engine store (default path) ──────────────
  // The M72 engine writes `brain_security_flow`; the old token co-occurrence
  // engine is retired and only readable under BB_SECURITY_LEGACY=1 for one
  // release. This path never reads the legacy table, so a pre-M72 row cannot be
  // re-presented as a lead.
  const legacyRead = process.env.BB_SECURITY_LEGACY === "1"
  if (args.recordRun !== true && !legacyRead) {
    const limit = Math.max(1, Math.min(200, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 50))
    const offset = Math.max(0, Number.isFinite(Number(args.offset)) ? Math.floor(Number(args.offset)) : 0)
    const page = readSecurityFlows(raw, projectId, { limit, offset, tier: "leads" })
    const banner = "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING\n"
    const tierNote = formatSecurityTierDeclaration() + projectLanguageDeclaration(raw, projectId)
    const gradeLabel = (severity: string): string =>
      severity === "critical" ? "exec" : severity === "high" ? "high" : severity === "medium" ? "medium" : severity === "low" ? "low" : "unknown"
    const leadLabel = (type: string): string => String(type ?? "unknown").replace(/_/g, " ")

    if (!page.initialized) {
      return textResult(banner + tierNote + `\nsecurity leads: engine not initialized — ${page.message ?? "run bb index --post"}`)
    }

    const derived = securityStaleness(raw, projectId, page.rows.map((row) => row.file))
    const lines = page.rows.map((row) => {
      const evidence: any = row.evidence ?? {}
      const sourceLine = row.sourceLine ?? evidence?.store?.sourceLine ?? evidence?.source?.line ?? null
      const sinkLine = row.sinkLine ?? evidence?.store?.sinkLine ?? evidence?.sink?.line ?? null
      const reach = Array.isArray(evidence?.reachPath) && evidence.reachPath.length > 0 ? ` [reach: ${evidence.reachPath.join(" -> ")}]` : ""
      const where = row.file ? `${row.file}:${sinkLine ?? "?"}` : "<unknown file>"
      return (
        `  [${gradeLabel(row.severity)}] lead: ${leadLabel(String(row.vulnerabilityType))} @ ${where}` +
        ` <- source:${sourceLine ?? "?"}; rule=${row.ruleId}; symbol=${row.symbolName ?? "?"}${reach}` +
        `${row.file && derived.isStale(row.file) ? " [stale]" : ""}`
      )
    })
    const head =
      `security leads: ${page.total} stored lead(s)` +
      (page.total === 0 ? " (none stored for this project — declared empty, not a clean result)" : "")
    const countLine =
      `\n[leads: showing ${page.rows.length} of ${page.total}; offset ${offset}; page size ${page.limit}; tier=leads` +
      `${page.truncated ? "; more available — pass offset to page" : ""}]`
    const footer = derived.footer ? `\n\n${derived.footer}` : ""
    return textResult(
      banner +
        tierNote +
        "\n" +
        head +
        "\n" +
        (lines.length > 0 ? lines.join("\n") : "  no stored leads on this page") +
        countLine +
        footer,
    )
  }

  // ── M72 recordRun: persist the spec-engine leads ─────────────────────────
  // recordRun is the one write. It persists the M72 store's census (not a
  // display window) so completeAnalysisRun cannot auto-resolve a lead it never
  // looked at. The fingerprint is the stored lead id, which is line-number-free:
  // moving a function does not create a new history finding.
  if (args.recordRun === true && !legacyRead) {
    const banner = "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING\n"
    const tierNote = formatSecurityTierDeclaration() + projectLanguageDeclaration(raw, projectId)
    const page = readSecurityFlows(raw, projectId, { limit: 50_000, offset: 0, tier: "leads" })
    if (!page.initialized) {
      return textResult(banner + tierNote + `\nrecordRun: engine not initialized — ${page.message ?? "run bb index --post"}`)
    }
    const gradeLabel = (severity: string): string =>
      severity === "critical" ? "exec" : severity === "high" ? "high" : severity === "medium" ? "medium" : severity === "low" ? "low" : "unknown"
    const leadLabel = (type: string): string => String(type ?? "unknown").replace(/_/g, " ")
    const rows = page.rows
    const recorded = await executeAnalysis({
      projectId,
      kind: "security",
      input: { options: args },
      persist: () =>
        rows.map(
          (row): AnalysisFindingInput => ({
            fingerprint: `m72:${row.id}`,
            rule: row.ruleId,
            title: `lead: ${leadLabel(String(row.vulnerabilityType))}`,
            severity: row.severity,
            confidence: null,
            evidence: [
              {
                kind: "security_lead",
                description: `${row.ruleId} ${row.vulnerabilityType} ${row.file ?? "?"}:${row.sinkLine ?? "?"}`,
              },
            ],
            limitations: ["Lexical lead: not a dataflow proof; validate manually."],
            evidenceClass: "static_finding",
            engine: "m72-security-spec",
            location: row.file ? `${row.file}:${row.sinkLine ?? "?"}` : null,
            state: undefined,
          }),
        ),
    })
    const preview = rows.slice(0, SECURITY_FINDINGS_WINDOW).map((row) => {
      const where = row.file ? `${row.file}:${row.sinkLine ?? "?"}` : "<unknown file>"
      return `  [${gradeLabel(row.severity)}] lead: ${leadLabel(String(row.vulnerabilityType))} @ ${where} <- source:${row.sourceLine ?? "?"}; rule=${row.ruleId}`
    })
    return textResult(
      banner +
        tierNote +
        `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` +
        `\n${rows.length} leads recorded` +
        (preview.length > 0 ? "\n" + preview.join("\n") : "\n  no stored leads to record") +
        `\n[recordRun: ${rows.length} lead(s) persisted; preview shows ${Math.min(rows.length, SECURITY_FINDINGS_WINDOW)}]`,
    )
  }

  // ── Legacy live scan (BB_SECURITY_LEGACY=1), optionally the recorded run ─
  const recordRun = args.recordRun === true
  const scanCap = recordRun ? SECURITY_RECORD_RUN_CENSUS_CAP : SECURITY_SCAN_CAP
  const result: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId, { maxResults: scanCap })
  const findings: any[] = result?.findings ?? []
  const suspicious: any[] = result?.suspiciousSources ?? []
  const summary = result?.summary
  const derived = securityStaleness(raw, projectId, observedPaths(findings, suspicious))

  // Phase 0: honesty banner and tier declaration — this tool is a lead generator, not a vulnerability scanner
  const banner = "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING\n"
  const tierNote = formatSecurityTierDeclaration() + projectLanguageDeclaration(raw, projectId)

  // Stored grades are lexical classes, not risk. The lead answer must not print
  // the word "critical" over a co-occurrence pair; it maps the class to an
  // execution-grade label and keeps the real state in the evidence.
  const gradeLabel = (severity: string): string =>
    severity === "critical" ? "exec" : severity === "high" ? "high" : severity === "medium" ? "medium" : severity === "low" ? "low" : "unknown"

  // The engine's own census versus what is on screen. The short
  // "(N beyond the cap)" is not enough on its own: the ordinary read — the
  // answer an agent actually calls — must also carry the explicit CAPPED
  // sentence, not reserve it for the recordRun branch.
  const capNote =
    result?.truncatedFindings > 0
      ? ` — CAPPED at ${scanCap.toLocaleString("en-US")}; ${result.deduplicatedFlows} lead(s) exist and ${result.truncatedFindings} were not examined`
      : ""
  const countLine =
    `\n[scan: ${result?.scannedFlows ?? 0} taint flow(s) indexed → ${result?.deduplicatedFlows ?? 0} lead(s)` +
    `${result?.truncatedFindings ? ` (${result.truncatedFindings} beyond the cap)` : ""};` +
    ` showing ${Math.min(findings.length, SECURITY_FINDINGS_WINDOW)} lead(s)` +
    `${suspicious.length ? ` and ${Math.min(suspicious.length, SECURITY_SUSPICIOUS_WINDOW)} of ${suspicious.length} unvalidated observation(s)` : ""}]` +
    capNote
  const head = summary
    ? `security leads: ${summary.resolved} resolved pair(s) / ${summary.unresolvedSources} unvalidated; lexical grades (not risk): ${summary.critical} exec / ${summary.high} high / ${summary.medium} medium / ${summary.low} low${summary.unknown ? ` / ${summary.unknown} unknown` : ""} / ${summary.mitigated} mitigated`
    : `security leads (${findings.length})`
  const where = (finding: any) => (finding.file ? `${finding.file}:${finding.line ?? "?"}` : "<unresolved location>")
  const lines = findings.slice(0, SECURITY_FINDINGS_WINDOW).map(
    (finding: any) =>
      `  [${gradeLabel(finding.severity)}] lead: ${finding.label ?? finding.type} token pair${finding.symbol ? ` (${finding.symbol})` : ""} @ ${where(finding)}` +
      `${finding.sourceType ? ` <- ${finding.sourceType}` : ""}${finding.sinkType ? ` -> ${finding.sinkType}` : ""}` +
      `${finding.mitigated ? " [mitigated]" : ""}${finding.file && derived.isStale(finding.file) ? " [stale]" : ""}`,
  )
  const sourceLines = suspicious.slice(0, SECURITY_SUSPICIOUS_WINDOW).map((source: any) => {
    const isSourceOnly = source.state === "source_only"
    return (
      `  [${gradeLabel(source.severity)}] unvalidated ${isSourceOnly ? "input source" : "sink"}: ${source.label ?? source.type}` +
      `${source.symbol ? ` ${source.symbol}` : ""} @ ${where(source)}` +
      ` (${isSourceOnly ? "no sink reached" : "sink found; source endpoint not resolved to an indexed symbol"})` +
      `${source.file && derived.isStale(source.file) ? " [stale]" : ""}`
    )
  })
  const footer = derived.footer ? `\n\n${derived.footer}` : ""

  if (!recordRun) {
    return textResult(
      banner + tierNote + "\n" +
      head +
        "\n" +
        (lines.length ? lines.join("\n") : "  no leads with both endpoints resolved") +
        countLine +
        (sourceLines.length ? `\n\nunvalidated observations (leads, not confirmed exploitable paths):\n${sourceLines.join("\n")}` : "") +
        footer,
    )
  }

  // ── recordRun: persist a census-sized snapshot of the analysed set ───────
  const recorded = await executeAnalysis({
    projectId,
    kind: "security",
    input: { options: args },
    persist: () =>
      findings.map(
        (finding: any): AnalysisFindingInput => ({
          // Identity survives a re-grade (severity is not part of it) and must
          // distinguish the two flow states: a confirmed flow and a mitigated
          // flow at the same sink are two findings in the report, so they cannot
          // share one persisted row: completeAnalysisRun de-duplicates by
          // fingerprint, so a key without the state drops the second one while
          // the response counts both.
          fingerprint: `taint:${finding.type}:${finding.sinkType ?? "?"}:${finding.state ?? "confirmed"}:${finding.file ?? "?"}:${finding.line ?? "?"}`,
          rule: finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          confidence: typeof finding.confidence === "number" ? finding.confidence : null,
          evidence: finding.evidence ?? [],
          limitations: finding.limitations ?? [],
          evidenceClass: "static_finding",
          engine: "taint@intelligence",
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        }),
      ),
  })
  return textResult(
    banner + tierNote + "\n" +
    head +
      `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` +
      "\n" +
      `${findings.length} leads recorded` +
      capNote +
      (lines.length ? "\n" + lines.join("\n") : "") +
      countLine +
      (sourceLines.length ? `\n\nunvalidated observations (not persisted — leads, not confirmed exploitable paths):\n${sourceLines.join("\n")}` : "") +
      footer,
  )
}

/** Exported for the gates: the history page's declared finding bound. */
export const historyFindingCap = SECURITY_HISTORY_FINDINGS_CAP
