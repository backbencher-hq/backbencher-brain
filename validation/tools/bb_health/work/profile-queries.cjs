// Read-only per-query profiler over an existing brain.db (Phase A audit).
// Usage: node validation/tools/bb_health/work/profile-queries.cjs <dbPath> <projectId>
const Database = require("/home/ishaq2321/mcp/backbencher-brain/node_modules/better-sqlite3")
const dbPath = process.argv[2]
const projectId = process.argv[3]
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const time = (label, sql, ...params) => {
  const t0 = process.hrtime.bigint()
  let row, err = null
  try { row = db.prepare(sql).get(...params) } catch (e) { err = e.message }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`${label.padEnd(34)} ${ms.toFixed(1).padStart(10)}ms ${err ? `ERROR ${err}` : JSON.stringify(row).slice(0, 120)}`)
}
const plan = (label, sql, ...params) => {
  console.log(`\nPLAN ${label}`)
  for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)) console.log(`  ${r.detail}`)
}
const count = (table) => {
  const t0 = process.hrtime.bigint()
  const c = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE project_id=?`).get(projectId).c
  console.log(`${("COUNT " + table).padEnd(34)} ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1).padStart(10)}ms ${c}`)
}
console.log("db:", dbPath, "projectId:", projectId)
console.log("file bytes:", require("fs").statSync(dbPath).size.toLocaleString("en-US"))
for (const t of ["brain_file", "brain_symbol", "brain_relationship", "brain_import", "brain_semantic_embedding"]) count(t)

const fileLangSql = "SELECT language, COUNT(DISTINCT id) AS files FROM brain_file WHERE project_id = ? GROUP BY language"
const symLangSql = "SELECT f.language AS language, COUNT(*) AS symbols FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = ? WHERE s.project_id = ? GROUP BY f.language"
const modelsSql = "SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC"
const entityTypeSql = "SELECT entity_type, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY entity_type ORDER BY c DESC"
const embeddedEntitiesSql = "SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?"
const kindsSql = "SELECT s.symbol_type AS kind, COUNT(*) AS c FROM brain_symbol s WHERE s.project_id = ? AND NOT EXISTS (SELECT 1 FROM brain_semantic_embedding e WHERE e.entity_id = s.id) GROUP BY s.symbol_type ORDER BY c DESC"
const byLangSql = "SELECT f.language AS language, COUNT(DISTINCT s.id) AS embedded FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = ? WHERE s.project_id = ? AND EXISTS (SELECT 1 FROM brain_semantic_embedding e WHERE e.entity_id = s.id) GROUP BY f.language"
const allFilesSql = "SELECT id, relative_path FROM brain_file WHERE project_id=?"

time("fileLangRows", fileLangSql, projectId)
time("symLangRows", symLangSql, projectId, projectId)
time("modelRows", modelsSql, projectId)
time("entityTypeRows", entityTypeSql, projectId)
time("embeddedEntities", embeddedEntitiesSql, projectId)
time("kindsWithNoEmbeddings", kindsSql, projectId)
time("embeddedByLanguage", byLangSql, projectId, projectId)
time("allFileRows", allFilesSql, projectId)
for (const [label, sql, p] of [
  ["fileLangRows", fileLangSql, [projectId]],
  ["symLangRows", symLangSql, [projectId, projectId]],
  ["kindsWithNoEmbeddings", kindsSql, [projectId]],
  ["embeddedByLanguage", byLangSql, [projectId, projectId]],
]) plan(label, sql, ...p)
