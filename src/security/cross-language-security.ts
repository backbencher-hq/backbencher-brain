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

const VULN_LABELS: Record<string, string> = {
  sql_injection: "SQL injection",
  command_injection: "Command injection",
  code_injection: "Code injection",
  xss: "Cross-site scripting (XSS)",
  path_traversal: "Path traversal",
  ssrf: "Server-side request forgery (SSRF)",
  open_redirect: "Open redirect",
  weak_crypto: "Weak cryptography",
  insecure_deserialization: "Insecure deserialization",
  pii_leak: "PII leak",
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

function severityRank(s: string | null): number {
  switch (s) {
    case "critical":
      return 0
    case "high":
      return 1
    case "medium":
      return 2
    case "low":
      return 3
    default:
      return 4
  }
}

/** flow_path may be a JSON array or a legacy '|||'-delimited string. */
function parseFlowPath(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value !== "string" || !value) return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String)
  } catch {}
  if (trimmed.includes("|||")) return trimmed.split("|||").filter(Boolean)
  return [trimmed]
}

export namespace CrossLanguageSecurityAnalysis {
  export async function analyze(projectId: string): Promise<CrossLanguageSecurityFindings> {
    return analyzeSecurityAcrossLanguages(projectId)
  }

  export async function analyzeSecurityAcrossLanguages(projectId: string, _opts?: any): Promise<CrossLanguageSecurityFindings> {
    const raw = await BrainDatabase.getRawInstance(projectId)

    const rows = raw
      .prepare(
        `SELECT t.id, t.vulnerability_type, t.severity, t.source_type, t.sink_type,
                t.is_mitigated, t.flow_path, t.cross_language_boundaries,
                src.name AS src_name, src.line_start AS src_line,
                snk.name AS snk_name, snk.line_start AS snk_line,
                f.relative_path AS file, f.language AS lang
         FROM brain_taint_flow t
         LEFT JOIN brain_symbol src ON src.id = t.source_symbol_id
         LEFT JOIN brain_symbol snk ON snk.id = t.sink_symbol_id
         LEFT JOIN brain_file f ON f.id = COALESCE(src.file_id, snk.file_id)
         WHERE t.project_id = ?`,
      )
      .all(projectId) as any[]

    // Symbol-id → name map so flow_path chains read as names, not ids.
    const symbolIdToName = new Map<string, string>()
    for (const s of raw.prepare("SELECT id, name FROM brain_symbol WHERE project_id = ?").all(projectId) as any[]) {
      symbolIdToName.set(s.id, s.name)
    }

    const findings: SecurityFinding[] = []
    const suspiciousSources: SecurityFinding[] = []
    const crossLang: SecurityFinding[] = []
    const seen = new Set<string>()

    for (const r of rows) {
      const type = r.vulnerability_type ?? "unresolved"
      const severity = r.severity ?? "unknown"
      const flowPath = parseFlowPath(r.flow_path)
      const flow = flowPath.map((id) => symbolIdToName.get(id) ?? (id.includes(":") ? id.split(":").pop() : id) ?? id)
      const finding: SecurityFinding = {
        id: r.id,
        type,
        label: VULN_LABELS[type] ?? type,
        severity,
        file: r.file ?? "?",
        line: r.snk_line ?? r.src_line ?? null,
        symbol: r.snk_name ?? r.src_name ?? null,
        language: r.lang ?? null,
        sourceType: r.source_type ?? null,
        sinkType: r.sink_type ?? null,
        sinkSymbol: r.snk_name ?? null,
        flow,
        mitigated: !!r.is_mitigated,
        crossLanguage: (r.cross_language_boundaries ?? 0) > 0,
      }
      // The indexer writes one row per source×sink pair on the same symbol;
      // dedupe so each real finding appears once.
      const key = `${type}|${finding.file}|${finding.line ?? ""}|${finding.symbol ?? ""}|${finding.sinkType ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      if (type === "unresolved" || severity === "unknown") {
        suspiciousSources.push(finding)
      } else {
        findings.push(finding)
        if (finding.crossLanguage) crossLang.push(finding)
      }
    }

    findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.file.localeCompare(b.file))

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
