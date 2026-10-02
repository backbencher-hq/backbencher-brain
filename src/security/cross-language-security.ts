// Real security scanner over the taint-flow index.
// Reads brain_taint_flow (written by TaintAnalyzer + parallel-indexer
// heuristics) and resolves every flow to file/line/symbol so bb_security
// reports actual vulnerabilities instead of a stub.

import { BrainDatabase } from "../brain/database"

export interface SecurityFinding {
  id: string
  type: string
  label: string
  severity: string
  /**
   * `null` when neither flow endpoint resolved to an indexed file. This was
   * `f.file ?? "?"`, and the `"?"` was then handed to the freshness resolver
   * (tool-handlers.ts `derivedStaleness`), which issued
   * `WHERE relative_path IN ('?')` — a query for a file that cannot exist, so
   * every such finding was counted as `missing` and inflated the staleness
   * footer with findings that were never stale. Callers render the fallback.
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
   * `limitations` array. The legacy mapping dropped all three, so the
   * `recordRun` path read `finding.confidence ?? null` and
   * `finding.evidence ?? []` off a shape that never carried them — every
   * persisted security finding in history had `confidence = NULL` and
   * `evidence = '[]'`, i.e. no evidence and no calibration at all.
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
   * `unresolvedSources` because the handler previously printed the SAME
   * "(no sink reached)" text for both, which is factually inverted for the
   * `unresolved` half — those rows DO have a resolved sink and are missing a
   * source.
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
    // Delegate to the strict taint engine (M9.09). It is the primary evidence
    // source (brain_taint_flow), resolves every node, deduplicates by
    // flow-equivalence, and classifies state with calibrated confidence. This
    // adapter maps the strict report back to the legacy shape the MCP handler
    // consumes; the richer typed report is available via analyzeSecurity().
    //
    // The parameter was `_opts` and the body ignored it outright, so every
    // caller got the engine's defaults — including `maxResults: 500`, which the
    // `recordRun` path then persisted from. The option is now forwarded, which
    // is what lets that path ask for a census-sized scan instead of
    // auto-resolving everything past the default cap.
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
