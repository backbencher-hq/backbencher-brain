// Phase split of the T2 default live scan: where the 5-8 s actually goes.
import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
process.env.BB_DATA_DIR = path.join(ROOT, ".bb-data")
process.env.BB_NO_AUTO_REFRESH = "1"
const projectId = getProjectId(ROOT)

function parseFlowPath(value: unknown): string[] {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch { return [] }
}

async function main() {
  const t0 = performance.now()
  const analysis = await import("../../../../src/intelligence/security/taint.ts")
  const tEngineImport = performance.now() - t0
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const tOpen = performance.now() - t0

  const SQL = "SELECT t.id, t.vulnerability_type, t.severity, t.source_type, t.sink_type, t.is_mitigated, t.flow_path, t.cross_language_boundaries, t.source_symbol_id, t.sink_symbol_id, src.name AS src_name, src.line_start AS src_line, srcf.relative_path AS src_file, srcf.language AS src_lang, snk.name AS snk_name, snk.line_start AS snk_line, snkf.relative_path AS snk_file, snkf.language AS snk_lang FROM brain_taint_flow t LEFT JOIN brain_symbol src ON src.id = t.source_symbol_id LEFT JOIN brain_file srcf ON srcf.id = src.file_id LEFT JOIN brain_symbol snk ON snk.id = t.sink_symbol_id LEFT JOIN brain_file snkf ON snkf.id = snk.file_id WHERE t.project_id = ? ORDER BY t.id"
  let t = performance.now()
  const rows = raw.prepare(SQL).all(projectId) as any[]
  const tSql = performance.now() - t

  t = performance.now()
  let ids = 0, parsed = 0, pathNodes = 0
  const needed = new Set<string>()
  for (const r of rows) {
    if (r.source_symbol_id) needed.add(r.source_symbol_id)
    if (r.sink_symbol_id) needed.add(r.sink_symbol_id)
    const p = parseFlowPath(r.flow_path)
    parsed++
    pathNodes += p.length
    for (const id of p) needed.add(id)
  }
  const tPaths = performance.now() - t
  ids = needed.size

  t = performance.now()
  const symById = new Map<string, any>()
  const arr = Array.from(needed)
  for (let i = 0; i < arr.length; i += 500) {
    const chunk = arr.slice(i, i + 500)
    const q = raw.prepare(`SELECT s.id, s.name, s.line_start, f.relative_path FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (${chunk.map(() => "?").join(",")})`)
    for (const row of q.all(...chunk) as any[]) symById.set(row.id, { name: row.name, file: row.relative_path, line: row.line_start })
  }
  const tResolve = performance.now() - t

  // classification + dedup only (no path/evidence objects), mirroring the key
  t = performance.now()
  const NORMALIZED = new Set(["critical", "high", "medium", "low", "unknown"])
  const sevOf = (v: any) => (NORMALIZED.has(String(v)) ? String(v) : "unknown")
  const byKey = new Map<string, any>()
  let sourceOnly = 0, unresolved = 0, mitigated = 0, confirmed = 0
  for (const r of rows) {
    const src = r.source_symbol_id ? symById.get(r.source_symbol_id) ?? (r.src_name ? { name: r.src_name, file: r.src_file, line: r.src_line } : null) : null
    const snk = r.sink_symbol_id ? symById.get(r.sink_symbol_id) ?? (r.snk_name ? { name: r.snk_name, file: r.snk_file, line: r.snk_line } : null) : null
    const sourceResolved = !!src, sinkResolved = !!snk
    const isMit = Number(r.is_mitigated) === 1
    const state = !sinkResolved ? "source_only" : !sourceResolved ? "unresolved" : isMit ? "mitigated" : "confirmed"
    if (state === "source_only") sourceOnly++
    else if (state === "unresolved") unresolved++
    else if (state === "mitigated") mitigated++
    else confirmed++
    const file = snk?.file ?? src?.file ?? null
    const line = snk?.line ?? src?.line ?? null
    const key = `${r.vulnerability_type}|${r.sink_symbol_id ?? ""}|${r.sink_type ?? ""}|${file ?? ""}:${line ?? ""}|${state}`
    if (!byKey.has(key)) byKey.set(key, { severity: sevOf(r.severity), state, id: r.id })
  }
  const dedup = byKey.size
  const tClassify = performance.now() - t

  t = performance.now()
  const findings = Array.from(byKey.values())
  findings.sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id))
  const tSort = performance.now() - t

  console.log(JSON.stringify({
    runtime: `${process.release?.name} ${process.version}`,
    rows: rows.length,
    tEngineImportMs: Math.round(tEngineImport),
    tOpenMs: Math.round(tOpen),
    tSqlMs: Math.round(tSql),
    tPathsMs: Math.round(tPaths),
    parsedFlowPaths: parsed,
    pathNodes,
    neededSymbolIds: ids,
    tResolveMs: Math.round(tResolve),
    tClassifyMs: Math.round(tClassify),
    states: { confirmed, mitigated, sourceOnly, unresolved },
    dedupFindings: dedup,
    tSortMs: Math.round(tSort),
  }, null, 2))
}
await main()
