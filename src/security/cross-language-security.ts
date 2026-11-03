// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the adapter from the strict taint report to the legacy
// finding shape the bb_security handler consumes, plus the severity/state
// summaries the tool's headline prints.
// WHICH TOOL IT SERVES — bb_security (mutability read, requiresIndex true,
//   modes: findings; plannedModes flow, summary, hotspots).
// WHY IT IS SHAPED THIS WAY — the strict engine classifies four evidence states;
//   this adapter is the boundary where that classification becomes an answer:
//   confirmed and mitigated flows are findings, source-only and unresolved flows
//   are unvalidated observations, and the summary counts are computed over BOTH
//   lists in one pass so the five severity buckets always reconcile with
//   `total`. Confidence, evidence and limitations are carried through, because
//   the recorded-run path persists exactly these fields.
// WHERE ITS EVIDENCE LIVES — docs/BB_SECURITY.md, docs/tools/bb_security.md,
//   validation/tools/bb_security/**; gates: script/m13/verify-security-handler.ts,
//   script/m20/verify-security-*.ts, script/verify-security.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/security/taint.ts,
//   src/mcp/tools/bb_security/handler.ts, docs/BB_SECURITY.md.
// CONTRACTS IT MUST NOT BREAK — observations never promoted to findings, the
//   findings/observations split, summary reconciliation, and provenance pass-through.
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../brain/database"

export interface SecurityFinding {
  id: string
  type: string
  label: string
  severity: string
  /**
   * `null` when neither flow endpoint resolved to an indexed file. A sentinel
   * such as `"?"` must never reach the freshness resolver: it would query a file
   * that cannot exist, count the finding as `missing`, and inflate the staleness
   * footer with findings that are not stale. Callers render the fallback.
   */
  file: string | null
  line: number | null
  symbol: string | null
  language: string | null
  sourceType: string | null
  sinkType: string | null
  sinkSymbol: string | null
  /** Resolved source location, distinct from the sink the finding anchors on. */
  sourceFile: string | null
  sourceLine: number | null
  sourceSymbol: string | null
  flow: string[] // resolved symbol-name chain
  mitigated: boolean
  crossLanguage: boolean
  /**
   * `taint.ts` calibrates confidence by flow state (0.7 confirmed / 0.4
   * observation / 0.3 mitigated) and builds a per-finding `evidence` and
   * `limitations` array. This adapter carries all three, because the `recordRun`
   * path persists exactly these fields: a mapping that drops them would persist
   * history with `confidence = NULL` and `evidence = '[]'`, i.e. no evidence and
   * no calibration at all.
   */
  state: string
  confidence: number
  evidence: Array<{ kind: string; description: string }>
  limitations: string[]
}

export interface SecuritySummary {
  /**
   * Every finding the scan classified, observations included. The severity
   * counts below are also over BOTH lists, so the five buckets plus
   * `total` must reconcile — `taint.ts` now normalizes severity into exactly
   * these five names, which makes `total === critical + high + medium + low +
   * unknown` an invariant the handler can print without lying.
   */
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unknown: number
  /** confirmed + mitigated (both endpoints resolved to indexed symbols). */
  resolved: number
  /** source_only + unresolved — one endpoint did not resolve. */
  unresolvedSources: number
  /**
   * source_only only: a taint source with no reachable sink. Split out from
   * `unresolvedSources` because the same "(no sink reached)" text is factually
   * inverted for the `unresolved` half — those rows DO have a resolved sink and
   * are missing a source.
   */
  sourceOnly: number
  /** unresolved only: a resolved sink whose source did not resolve. */
  sinkOnly: number
  mitigated: number
  crossLanguage: number
  byType: Record<string, number>
  byFile: Record<string, number>
}

export interface CrossLanguageSecurityFindings {
  findings: SecurityFinding[]
  cross_language_vulnerabilities: SecurityFinding[]
  suspiciousSources: SecurityFinding[]
  summary: SecuritySummary
  /**
   * The engine's own evidence envelope. This adapter used to return findings
   * with no provenance at all, which made the `truncated` flag unreachable for
   * the MCP handler — the single reason a capped scan was indistinguishable
   * from a complete one at the tool surface.
   */
  provenance: import("../intelligence/evidence").EvidenceProvenance
  /** Pre-cap census and the count dropped by the cap (0 = complete). */
  scannedFlows: number
  deduplicatedFlows: number
  truncatedFindings: number
}

const SINK_LABELS: Record<string, string> = {
  shell_execution: "shell execution",
  command_exec: "command execution",
  database_write: "database write",
  sql_query: "SQL query",
  code_execution: "code execution",
  http_response: "HTTP response",
  network_request: "network request",
  file_system: "file-system access",
  deserialization: "deserialization",
  cryptography: "cryptography",
  innerHTML: "innerHTML sink",
  eval: "eval() sink",
  log_output: "log output",
}

export namespace CrossLanguageSecurityAnalysis {
  export async function analyze(projectId: string): Promise<CrossLanguageSecurityFindings> {
    return analyzeSecurityAcrossLanguages(projectId)
  }

  /** Typed, mode-based security report (findings / flow / summary / hotspots). */
  export async function analyzeSecurity(projectId: string, options?: import("../intelligence/contracts").SecurityOptions) {
    const { analyzeTaintFlows } = await import("../intelligence/security/taint")
    return analyzeTaintFlows(projectId, options)
  }

  export async function analyzeSecurityAcrossLanguages(projectId: string, options?: import("../intelligence/contracts").SecurityOptions): Promise<CrossLanguageSecurityFindings> {
    // Delegate to the strict taint engine: brain_taint_flow is the evidence
    // source; the engine resolves every node, deduplicates by flow-equivalence,
    // and classifies state with calibrated confidence. This adapter maps the
    // strict report back to the finding shape the handler consumes; the richer
    // typed report is available via analyzeSecurity().
    //
    // The scan bound is forwarded, not dropped: the recorded-run path asks for a
    // census-sized scan so a display cap can never auto-resolve an unexamined
    // finding, while an ordinary read keeps the engine default.
    const { analyzeTaintFlows } = await import("../intelligence/security/taint")
    const report = await analyzeTaintFlows(projectId, options)

    const toLegacy = (f: (typeof report.findings)[number]): SecurityFinding => ({
      id: f.id,
      type: f.vulnerabilityType,
      label: f.label,
      severity: f.severity,
      file: f.file,
      line: f.line,
      symbol: f.symbol,
      language: f.language,
      sourceType: f.sourceType,
      sinkType: f.sinkType,
      sinkSymbol: f.sink.name,
      sourceFile: f.source.file,
      sourceLine: f.source.line,
      sourceSymbol: f.source.name,
      flow: f.path.map((n) => n.name ?? n.symbolId ?? "?"),
      mitigated: f.mitigated,
      crossLanguage: f.crossLanguage,
      state: f.state,
      confidence: f.confidence,
      evidence: f.evidence,
      limitations: f.limitations,
    })

    // Confirmed + mitigated flows are "findings"; source-only/unresolved are
    // suspicious sources (kept separate, as before).
    const findings: SecurityFinding[] = []
    const suspiciousSources: SecurityFinding[] = []
    const crossLang: SecurityFinding[] = []
    for (const f of report.findings) {
      const legacy = toLegacy(f)
      if (f.state === "source_only" || f.state === "unresolved") {
        suspiciousSources.push(legacy)
      } else {
        findings.push(legacy)
        if (f.crossLanguage) crossLang.push(legacy)
      }
    }

    const byType: Record<string, number> = {}
    const byFile: Record<string, number> = {}
    for (const f of findings) {
      byType[f.type] = (byType[f.type] ?? 0) + 1
      if (f.file) byFile[f.file] = (byFile[f.file] ?? 0) + 1
    }
    // One pass over both lists, one accumulator. The old form built a fresh
    // `[...findings, ...suspiciousSources]` array inside `severityCount` and
    // called it five times — five full copies of the finding set per scan, and
    // a bucket list that had to be kept in sync with the type union by hand.
    const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
    const all = [...findings, ...suspiciousSources]
    for (const f of all) {
      if (f.severity in severityCounts) severityCounts[f.severity]++
      else severityCounts.unknown++
    }

    const summary: SecuritySummary = {
      total: all.length,
      critical: severityCounts.critical,
      high: severityCounts.high,
      medium: severityCounts.medium,
      low: severityCounts.low,
      unknown: severityCounts.unknown,
      resolved: findings.length,
      unresolvedSources: suspiciousSources.length,
      sourceOnly: suspiciousSources.filter((f) => f.state === "source_only").length,
      sinkOnly: suspiciousSources.filter((f) => f.state === "unresolved").length,
      mitigated: all.filter((f) => f.mitigated).length,
      crossLanguage: crossLang.length,
      byType,
      byFile,
    }

    return {
      findings,
      cross_language_vulnerabilities: crossLang,
      suspiciousSources,
      summary,
      provenance: report.provenance,
      scannedFlows: report.summary.scannedFlows,
      deduplicatedFlows: report.summary.deduplicatedFlows,
      truncatedFindings: report.summary.truncatedFindings,
    }
  }
}

export { SINK_LABELS }
