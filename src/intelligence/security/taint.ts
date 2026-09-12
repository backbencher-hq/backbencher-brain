import { BrainDatabase } from "../../brain/database"
import type { FlowNode, SecurityFindingV2, SecurityHotspot, SecurityOptions, SecurityReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "taint@intelligence"

// Normalize vulnerability-type aliases the indexer heuristics may emit.
const VULN_ALIASES: Record<string, string> = {
  sqli: "sql_injection",
  sql: "sql_injection",
  "sql-injection": "sql_injection",
  cmd_injection: "command_injection",
  cmdi: "command_injection",
  rce: "code_injection",
  xss_reflected: "xss",
  xss_stored: "xss",
  path_traversal: "path_traversal",
  lfi: "path_traversal",
  pii: "pii_leak",
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

function normalizeType(t: string | null): string {
  const key = (t ?? "unknown").toLowerCase()
  return VULN_ALIASES[key] ?? key
}

function severityRank(s: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s] ?? 4
}

function parseFlowPath(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value !== "string" || !value) return []
  const trimmed = value.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String)
  } catch {}
  if (trimmed.includes("|||")) return trimmed.split("|||").filter(Boolean)
  return trimmed ? [trimmed] : []
}

type TaintRow = {
  id: string
  vulnerability_type: string | null
  severity: string | null
  source_type: string | null
  sink_type: string | null
  is_mitigated: number
  flow_path: string | null
  cross_language_boundaries: number
  source_symbol_id: string | null
  sink_symbol_id: string | null
  src_name: string | null
  src_line: number | null
  src_file: string | null
  src_lang: string | null
  snk_name: string | null
  snk_line: number | null
  snk_file: string | null
  snk_lang: string | null
}

// Strict taint-flow security engine. brain_taint_flow is the primary evidence
// source; every flow is resolved to symbols/files, deduplicated by
// flow-equivalence, and classified by state (confirmed / mitigated /
// unresolved / source_only) with calibrated confidence.
export async function analyzeTaintFlows(projectId: string, options: SecurityOptions = {}): Promise<SecurityReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const minConfidence = options.minConfidence ?? 0
  const includeMitigated = options.includeMitigated ?? true
  const includeUnresolved = options.includeUnresolved ?? true
  const maxResults = options.maxResults ?? 500

  const rows = raw.prepare(
    "SELECT t.id, t.vulnerability_type, t.severity, t.source_type, t.sink_type, " +
      "t.is_mitigated, t.flow_path, t.cross_language_boundaries, " +
      "t.source_symbol_id, t.sink_symbol_id, " +
      "src.name AS src_name, src.line_start AS src_line, srcf.relative_path AS src_file, srcf.language AS src_lang, " +
      "snk.name AS snk_name, snk.line_start AS snk_line, snkf.relative_path AS snk_file, snkf.language AS snk_lang " +
      "FROM brain_taint_flow t " +
      "LEFT JOIN brain_symbol src ON src.id = t.source_symbol_id " +
      "LEFT JOIN brain_file srcf ON srcf.id = src.file_id " +
      "LEFT JOIN brain_symbol snk ON snk.id = t.sink_symbol_id " +
      "LEFT JOIN brain_file snkf ON snkf.id = snk.file_id " +
      "WHERE t.project_id = ?",
  ).all(projectId) as TaintRow[]

  // M50.A2 residual: resolution used to load EVERY symbol row of the project
  // into a Map (168,629 rows / 508ms of a ~568ms engine call on this repo's
  // own index) to answer lookups for the few thousand ids the taint rows
  // actually reference (2,692 here). Flow paths are parsed once, the distinct
  // ids are collected, and only those are fetched — chunked for SQLite's
  // parameter limit. Output is unchanged by construction (same rows, same
  // keys); proven by script/m50/probe-security-phases.ts on the real index.
  const pathCache: string[][] = new Array(rows.length)
  const neededIds = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.source_symbol_id) neededIds.add(r.source_symbol_id)
    if (r.sink_symbol_id) neededIds.add(r.sink_symbol_id)
    const path = parseFlowPath(r.flow_path)
    pathCache[i] = path
    for (const id of path) neededIds.add(id)
  }

  // symbol id -> {name,file,line} for flow-path resolution
  const symById = new Map<string, { name: string; file: string; line: number }>()
  const ids = [...neededIds]
  const CHUNK = 500
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const stmt =
      "SELECT s.id, s.name, s.line_start AS line, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (" +
      chunk.map(() => "?").join(",") +
      ")"
    for (const s of raw.prepare(stmt).all(projectId, ...chunk) as Array<{ id: string; name: string; line: number; file: string }>) {
      symById.set(s.id, { name: s.name, file: s.file, line: s.line })
    }
  }

  const resolveNode = (symbolId: string | null): FlowNode => {
    if (!symbolId) return { symbolId: null, name: null, file: null, line: null }
    const meta = symById.get(symbolId)
    if (meta) return { symbolId, name: meta.name, file: meta.file, line: meta.line }
    // Unresolved id: recover name from the id tail (proj:file:name:line).
    const parts = symbolId.split(":")
    return { symbolId, name: parts.length >= 3 ? parts[parts.length - 2]! : symbolId, file: null, line: null }
  }

  const findingByKey = new Map<string, SecurityFindingV2>()
  let scannedFlows = 0

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    scannedFlows++
    const vulnerabilityType = normalizeType(row.vulnerability_type)
    const severity = (row.severity as SecurityFindingV2["severity"]) ?? "unknown"
    const source = resolveNode(row.source_symbol_id)
    const sink = resolveNode(row.sink_symbol_id)
    const path = (pathCache[rowIndex] ?? []).map(resolveNode)

    const mitigated = !!row.is_mitigated
    // A flow is only "confirmed" when BOTH endpoints resolve to indexed
    // symbols. The indexer emits partial rows ("isolated sources"/"isolated
    // sinks") that must never be promoted to findings:
    //   - no sink endpoint reachable  -> source_only (source-only observation)
    //   - sink reachable, source not  -> unresolved  (one endpoint unresolved)
    const sourceResolved = !!row.source_symbol_id && !!source.file
    const sinkResolved = !!row.sink_symbol_id && !!sink.file
    const state: SecurityFindingV2["state"] = !sinkResolved
      ? "source_only"
      : !sourceResolved
        ? "unresolved"
        : mitigated
          ? "mitigated"
          : "confirmed"

    if (!includeMitigated && state === "mitigated") continue
    if (!includeUnresolved && (state === "unresolved" || state === "source_only")) continue

    // Calibrated confidence by evidence quality.
    const confidence = state === "confirmed" ? 0.7 : state === "mitigated" ? 0.3 : 0.4
    if (confidence < minConfidence) continue

    const file = sink.file ?? source.file
    const line = sink.line ?? source.line
    const symbol = sink.name ?? source.name
    const language = row.snk_lang ?? row.src_lang ?? null

    // Dedup by flow-equivalence: same vuln at the same sink location collapses
    // the multiple source_type / intermediate-variable rows the indexer emits.
    const key = `${vulnerabilityType}|${row.sink_symbol_id ?? ""}|${row.sink_type ?? ""}|${file ?? ""}:${line ?? ""}|${state}`
    const existing = findingByKey.get(key)
    if (existing) {
      // Keep the richer path if a later row has more nodes.
      if (path.length > existing.path.length) existing.path = path
      continue
    }

    findingByKey.set(key, {
      id: row.id,
      vulnerabilityType,
      label: VULN_LABELS[vulnerabilityType] ?? vulnerabilityType,
      severity,
      confidence,
      state,
      file,
      line,
      symbol,
      language,
      sourceType: row.source_type ?? null,
      sinkType: row.sink_type ?? null,
      source,
      sink,
      path,
      crossLanguage: (row.cross_language_boundaries ?? 0) > 0,
      mitigated,
      evidence: [
        { kind: "taint_flow", description: `${row.source_type ?? "source"} -> ${row.sink_type ?? "sink"} taint flow (${state})` },
      ],
      limitations: [
        "Flows are indexer heuristics; parameterized/escaped sinks may still be reported.",
        state === "source_only" ? "Source-only observation: no confirmed sink flow." : "",
        state === "unresolved" ? "One endpoint could not be resolved to an indexed symbol." : "",
        state === "mitigated" && (!sourceResolved || !sinkResolved) ? "Mitigation flag is not trusted until both endpoints resolve." : "",
      ].filter(Boolean),
    })
  }

  let findings = Array.from(findingByKey.values())
  findings.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.confidence - a.confidence || (a.file ?? "").localeCompare(b.file ?? ""),
  )
  const deduplicatedFlows = findings.length
  findings = findings.slice(0, maxResults)

  // Summary
  const bySeverity: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byState: SecurityReport["summary"]["byState"] = { confirmed: 0, mitigated: 0, unresolved: 0, source_only: 0 }
  let crossLanguage = 0
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
    byType[f.vulnerabilityType] = (byType[f.vulnerabilityType] ?? 0) + 1
    byState[f.state]++
    if (f.crossLanguage) crossLanguage++
  }

  // Hotspots: files/symbols with the most findings.
  const fileCounts = new Map<string, { n: number; sev: string }>()
  const symCounts = new Map<string, { n: number; sev: string }>()
  const worse = (a: string, b: string) => (severityRank(a) <= severityRank(b) ? a : b)
  for (const f of findings) {
    if (f.file) {
      const cur = fileCounts.get(f.file) ?? { n: 0, sev: "low" }
      fileCounts.set(f.file, { n: cur.n + 1, sev: worse(cur.sev, f.severity) })
    }
    if (f.symbol) {
      const cur = symCounts.get(f.symbol) ?? { n: 0, sev: "low" }
      symCounts.set(f.symbol, { n: cur.n + 1, sev: worse(cur.sev, f.severity) })
    }
  }
  const hotspots: SecurityHotspot[] = [
    ...Array.from(fileCounts.entries()).map(([key, v]) => ({ key, kind: "file" as const, findings: v.n, maxSeverity: v.sev as SecurityHotspot["maxSeverity"] })),
    ...Array.from(symCounts.entries()).map(([key, v]) => ({ key, kind: "symbol" as const, findings: v.n, maxSeverity: v.sev as SecurityHotspot["maxSeverity"] })),
  ]
    .sort((a, b) => b.findings - a.findings || severityRank(a.maxSeverity) - severityRank(b.maxSeverity))
    .slice(0, 20)

  return {
    findings,
    summary: { total: findings.length, bySeverity, byType, byState, crossLanguage, scannedFlows, deduplicatedFlows },
    hotspots,
    provenance: makeProvenance({ evidenceClass: "static_finding", engine: ENGINE, engineVersion: "m10.02", projectId, source: "brain_taint_flow", limitations: ["Static taint flows can contain false positives and false negatives and are not runtime exploit proofs."], truncated: deduplicatedFlows > maxResults }),
  }
}
