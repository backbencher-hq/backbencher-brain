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
  file: string
  line: number | null
  symbol: string | null
  language: string | null
  sourceType: string | null
  sinkType: string | null
  sinkSymbol: string | null
  flow: string[] // resolved symbol-name chain
  mitigated: boolean
  crossLanguage: boolean
}

export interface SecuritySummary {
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unknown: number
  resolved: number
  unresolvedSources: number
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

  export async function analyzeSecurityAcrossLanguages(projectId: string, _opts?: any): Promise<CrossLanguageSecurityFindings> {
    // Delegate to the strict taint engine (M9.09). It is the primary evidence
    // source (brain_taint_flow), resolves every node, deduplicates by
    // flow-equivalence, and classifies state with calibrated confidence. This
    // adapter maps the strict report back to the legacy shape the MCP handler
    // consumes; the richer typed report is available via analyzeSecurity().
    const { analyzeTaintFlows } = await import("../intelligence/security/taint")
    const report = await analyzeTaintFlows(projectId)

    const toLegacy = (f: (typeof report.findings)[number]): SecurityFinding => ({
      id: f.id,
      type: f.vulnerabilityType,
      label: f.label,
      severity: f.severity,
      file: f.file ?? "?",
      line: f.line,
      symbol: f.symbol,
      language: f.language,
      sourceType: f.sourceType,
      sinkType: f.sinkType,
      sinkSymbol: f.sink.name,
      flow: f.path.map((n) => n.name ?? n.symbolId ?? "?"),
      mitigated: f.mitigated,
      crossLanguage: f.crossLanguage,
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
      byFile[f.file] = (byFile[f.file] ?? 0) + 1
    }
    const severityCount = (sev: string) => [...findings, ...suspiciousSources].filter((f) => f.severity === sev).length

    const summary: SecuritySummary = {
      total: findings.length + suspiciousSources.length,
      critical: severityCount("critical"),
      high: severityCount("high"),
      medium: severityCount("medium"),
      low: severityCount("low"),
      unknown: severityCount("unknown"),
      resolved: findings.length,
      unresolvedSources: suspiciousSources.length,
      mitigated: [...findings, ...suspiciousSources].filter((f) => f.mitigated).length,
      crossLanguage: crossLang.length,
      byType,
      byFile,
    }

    return { findings, cross_language_vulnerabilities: crossLang, suspiciousSources, summary }
  }
}

export { SINK_LABELS }
