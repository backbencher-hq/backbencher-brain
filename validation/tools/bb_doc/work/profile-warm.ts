import { Database } from "bun:sqlite"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const db = new Database(path.join(REPO, ".bb-data", "projects", pid, "brain.db"), { readonly: true })
const bench = (label: string, fn: () => any) => { fn(); fn(); const t = performance.now(); for (let i=0;i<3;i++) fn(); return { label, ms: Math.round((performance.now()-t)/3) } }
const out: any[] = []
const symRow = db.prepare("SELECT * FROM brain_symbol WHERE project_id=? AND name=? LIMIT 1").get(pid, "generateDocumentation") as any
const fileRow = db.prepare("SELECT * FROM brain_file WHERE project_id=? AND relative_path=? LIMIT 1").get(pid, "src/intelligence/documentation/doc-engine.ts") as any
const symIds = [symRow.id]
const inList = symIds.map(() => "?").join(",")
out.push(bench("count symbols (warm)", () => db.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(pid)))
out.push(bench("count rels (warm)", () => db.prepare("SELECT count(*) c FROM brain_relationship WHERE project_id=?").get(pid)))
out.push(bench("symbol by name indexed", () => db.prepare("SELECT s.*, f.relative_path, f.language file_language, f.id source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.name=? ORDER BY s.line_start LIMIT 20").all(pid, "generateDocumentation")))
out.push(bench("symbol by qualified (fallback)", () => db.prepare("SELECT s.*, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.qualified_name=? LIMIT 20").all(pid, "doc-engine.generateDocumentation")))
out.push(bench("rel source-side + joins", () => db.prepare(`SELECT r.*, ss.name AS source_name, sf.relative_path AS source_path, ts.name AS target_name, ts.qualified_name AS target_qualified, tf.relative_path AS target_file FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id=r.source_symbol_id LEFT JOIN brain_file sf ON sf.id=ss.file_id LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id LEFT JOIN brain_file tf ON tf.id=ts.file_id WHERE r.project_id=? AND r.source_symbol_id IN (${inList}) LIMIT 320`).all(pid, ...symIds)))
out.push(bench("rel target-side + joins", () => db.prepare(`SELECT r.*, ss.name AS source_name, sf.relative_path AS source_path, ts.name AS target_name, ts.qualified_name AS target_qualified, tf.relative_path AS target_file FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id=r.source_symbol_id LEFT JOIN brain_file sf ON sf.id=ss.file_id LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id LEFT JOIN brain_file tf ON tf.id=ts.file_id WHERE r.project_id=? AND r.target_symbol_id IN (${inList}) LIMIT 320`).all(pid, ...symIds)))
const files100 = db.prepare("SELECT * FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT 100").all(pid) as any[]
const fileIds = files100.map(f => f.id)
out.push(bench("project files fetch (unsorted)", () => db.prepare("SELECT * FROM brain_file WHERE project_id=? LIMIT 100").all(pid)))
out.push(bench("per-file symbol counts for 100 ids", () => db.prepare(`SELECT file_id, count(*) c FROM brain_symbol WHERE project_id=? AND file_id IN (${fileIds.map(()=>"?").join(",")}) GROUP BY file_id`).all(pid, ...fileIds)))
out.push(bench("language files group", () => db.prepare("SELECT language, count(*) files FROM brain_file WHERE project_id=? AND language IS NOT NULL GROUP BY language ORDER BY files DESC LIMIT 12").all(pid)))
out.push(bench("language symbols group", () => db.prepare("SELECT f.language, count(*) symbols FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? GROUP BY f.language ORDER BY symbols DESC LIMIT 12").all(pid)))
out.push(bench("framework files + their symbols", () => {
  const ids = (db.prepare("SELECT id FROM brain_file WHERE project_id=? AND framework_type IN ('net_http')").all(pid) as any[]).map(r => r.id)
  if (!ids.length) return []
  return db.prepare(`SELECT s.* FROM brain_symbol s WHERE s.project_id=? AND s.file_id IN (${ids.map(()=>"?").join(",")}) AND s.visibility IN ('export','public') LIMIT 100`).all(pid, ...ids)
}))
out.push(bench("route-ish symbol types (indexed)", () => db.prepare("SELECT s.* FROM brain_symbol s WHERE s.project_id=? AND s.symbol_type IN ('route','endpoint','controller') LIMIT 100").all(pid)))
out.push(bench("api_contract_path scan", () => db.prepare("SELECT s.* FROM brain_symbol s WHERE s.project_id=? AND s.api_contract_path IS NOT NULL LIMIT 100").all(pid)))
out.push(bench("complexity outliers warm", () => db.prepare("SELECT s.name, s.complexity, s.line_start, s.line_end, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.complexity >= 15 ORDER BY s.complexity DESC, s.name LIMIT 20").all(pid)))
out.push(bench("complexity outliers scoped to 100 files", () => db.prepare(`SELECT s.name, s.complexity, s.line_start, s.line_end, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.file_id IN (${fileIds.map(()=>"?").join(",")}) AND s.complexity >= 15 ORDER BY s.complexity DESC, s.name LIMIT 20`).all(pid, ...fileIds)))
out.push(bench("feature lexical LIKE", () => db.prepare(`SELECT s.* FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ? OR lower(COALESCE(s.qualified_name,'')) LIKE ?) ORDER BY s.gravity_score DESC, s.line_start LIMIT 20`).all(pid, "%doc%", "%doc%", "%doc%")))
console.log(JSON.stringify(out))
