// Read-only profile of the SQL bb_doc runs on the T2 reference index.
import { Database } from "bun:sqlite"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const dbPath = path.join(REPO, ".bb-data", "projects", pid, "brain.db")
const db = new Database(dbPath, { readonly: true })
const time = (label: string, fn: () => any) => { const t = performance.now(); const r = fn(); console.log(label, Math.round(performance.now() - t), "ms", JSON.stringify(r).slice(0, 120)); return r }
const indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('brain_relationship','brain_symbol','brain_file','brain_import')").all() as any[]
for (const i of indexes) console.log("INDEX", i.name, "ON", i.tbl_name, "|", String(i.sql ?? "").slice(0, 160))
console.log("embed-ish tables:", JSON.stringify((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%embed%';").all())))
console.log("vector tables:", JSON.stringify((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%vector%' OR name LIKE '%semantic%');").all())))
time("file count", () => db.prepare("SELECT count(*) c FROM brain_file WHERE project_id=?").get(pid))
time("symbol count", () => db.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(pid))
time("rel count", () => db.prepare("SELECT count(*) c FROM brain_relationship WHERE project_id=?").get(pid))
time("exact symbol lookup", () => db.prepare("SELECT s.*, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT 20").all(pid, "generateDocumentation", "generateDocumentation"))
const symIds = (db.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name='generateDocumentation' LIMIT 20").all(pid) as any[]).map(r => r.id)
const inList = symIds.map(() => "?").join(",")
time("OLD relationship fetch (ORDER BY line_number)", () => db.prepare(`SELECT r.*, ss.name AS source_name, ts.name AS target_name FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id=r.source_symbol_id LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id WHERE r.project_id=? AND (r.source_symbol_id IN (${inList}) OR r.target_symbol_id IN (${inList})) ORDER BY r.line_number LIMIT ?`).all(pid, ...symIds, ...symIds, 320))
time("NEW source-side fetch", () => db.prepare(`SELECT r.* FROM brain_relationship r WHERE r.project_id=? AND r.source_symbol_id IN (${inList}) LIMIT ?`).all(pid, ...symIds, 320))
time("NEW target-side fetch", () => db.prepare(`SELECT r.* FROM brain_relationship r WHERE r.project_id=? AND r.target_symbol_id IN (${inList}) LIMIT ?`).all(pid, ...symIds, 320))
time("localPathIndex", () => db.prepare("SELECT relative_path FROM brain_file WHERE project_id=?").all(pid))
time("snapshot hashes", () => db.prepare("SELECT file_hash FROM brain_file WHERE project_id=? ORDER BY relative_path").all(pid))
time("project files ordered (OLD)", () => db.prepare(`SELECT f.* FROM brain_file f WHERE f.project_id=? ORDER BY (f.is_config_file = 1), (relative_path LIKE '.%'), (relative_path LIKE '%.md'), (SELECT count(*) FROM brain_symbol s WHERE s.file_id = f.id) DESC, f.relative_path LIMIT 100`).all(pid))
time("language group by", () => db.prepare(`SELECT f.language, count(DISTINCT f.id) AS files, count(s.id) AS symbols FROM brain_file f LEFT JOIN brain_symbol s ON s.file_id = f.id WHERE f.project_id=? AND f.language IS NOT NULL GROUP BY f.language ORDER BY symbols DESC, files DESC LIMIT 12`).all(pid))
time("complexity outliers", () => db.prepare("SELECT s.name, s.complexity, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.complexity >= 15 ORDER BY s.complexity DESC, s.name LIMIT 20").all(pid))
time("entry points", () => db.prepare(`SELECT s.name, s.symbol_type, s.line_start, s.line_end, s.visibility, s.api_contract_path, s.gravity_score, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.visibility IN ('export','public') AND s.line_start > 0 ORDER BY s.gravity_score DESC, s.name LIMIT 20`).all(pid))
time("feature lexical LIKE", () => db.prepare(`SELECT s.* FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ? OR lower(COALESCE(s.qualified_name,'')) LIKE ?) ORDER BY s.gravity_score DESC, s.line_start LIMIT 20`).all(pid, "%documentation generation%", "%documentation generation%", "%documentation generation%"))
time("symbols for files (project mode, 100 files)", () => db.prepare(`SELECT s.* FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.file_id IN (${Array.from({length:100}).fill("?").join(",")}) ORDER BY f.relative_path, s.line_start LIMIT 40`).all(pid, ...(db.prepare("SELECT id FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT 100").all(pid) as any[]).map(r => r.id)))
