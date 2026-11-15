// Compare relationship-fetch formulations for the bounded node set on the
// reference index, each in a fresh process so the cold cost is visible.
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
process.env.BB_DATA_DIR = path.join(ROOT, ".bb-data")
process.env.BB_NO_AUTO_REFRESH = "1"
const variant = process.argv[2] ?? "double-in"
const chunkArg = Number(process.argv[3] ?? 50)
const { BrainDatabase } = await import("../../../../src/brain/database")
const { getProjectId } = await import("../../../../src/util/project-id")
const projectId = getProjectId(ROOT)
const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
const symbols: any[] = raw.prepare("SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY s.gravity_score DESC, s.line_start, s.id LIMIT ?").all(projectId, Number(process.argv[4] ?? 400))
const ids: string[] = symbols.map((s) => s.id)
const columns = "id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number"
const t0 = performance.now()
let rows: any[] = []
const ph = (values: unknown[]) => values.map(() => "?").join(",")
if (variant === "double-in") {
  rows = raw.prepare(`SELECT ${columns} FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${ph(ids)}) AND target_symbol_id IN (${ph(ids)})`).all(projectId, ...ids, ...ids)
} else if (variant === "source-only") {
  const wanted = new Set(ids)
  const part = raw.prepare(`SELECT ${columns} FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${ph(ids)})`).all(projectId, ...ids)
  for (const row of part) if (wanted.has(String(row.target_id))) rows.push(row)
} else if (variant === "chunk-source") {
  const wanted = new Set(ids)
  const CHUNK = chunkArg
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const part = raw.prepare(`SELECT ${columns} FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${ph(chunk)})`).all(projectId, ...chunk)
    for (const row of part) if (wanted.has(String(row.target_id))) rows.push(row)
  }
} else if (variant === "chunk-source-target") {
  const CHUNK = chunkArg
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    rows.push(...raw.prepare(`SELECT ${columns} FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${ph(chunk)}) AND target_symbol_id IN (${ph(ids)})`).all(projectId, ...chunk, ...ids))
  }
} else if (variant === "total-source-rows") {
  const row = raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${ph(ids)})`).get(projectId, ...ids) as any
  console.log(JSON.stringify({ variant, sourceRows: row.c, ms: Math.round(performance.now() - t0) }))
  process.exit(0)
}
console.log(JSON.stringify({ variant, chunk: chunkArg, ms: Math.round(performance.now() - t0), rows: rows.length }))
