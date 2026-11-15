// bb_tests/bb_patterns/probes/probe-p5-rule-latency.mjs
// P5 — find WHICH statement in detectIndexRules is expensive.
//
// P4 sat in the F7 section for minutes at ~42% CPU with no output. That is a
// latency fact worth pinning down rather than describing, because the rule
// branch is on the default bb_patterns path (includeAntiPatterns defaults true)
// and the registry advertises the tool as a full pattern scan.
//
// Each statement from src/intelligence/patterns/rules.ts is timed here as raw
// SQL, so the number is the database's and not the JS wrapper's.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const projectId = process.argv[2]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })

const statements = [
  ["complexity (rules.ts:39-44)", `SELECT s.name, s.complexity, f.relative_path AS file, COALESCE(s.line_start,0) AS line
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.complexity IS NOT NULL AND s.complexity >= 15
     ORDER BY s.complexity DESC`, [projectId]],
  ["long-parameter-list (rules.ts:68-76)", `SELECT s.name, s.parameters, f.relative_path AS file, COALESCE(s.line_start,0) AS line,
     (SELECT COUNT(*) FROM json_each(s.parameters)) AS paramCount
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.parameters IS NOT NULL AND s.parameters != '[]'
       AND json_valid(s.parameters) AND length(s.parameters) >= 17
       AND (SELECT COUNT(*) FROM json_each(s.parameters)) > 7
     ORDER BY s.id`, [projectId]],
  ["god-class (rules.ts:91-97)", `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id
     WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum')
     GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`, [projectId]],
  ["framework census (rules.ts:115-117)", `SELECT framework_type, COUNT(*) c FROM brain_file
     WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('','unknown')
     GROUP BY framework_type ORDER BY c DESC`, [projectId]],
]

// The orphan branch's own statements, for a like-for-like comparison.
const orphanStatements = [
  ["orphan symbol load (orphans.ts:74-80)", `SELECT s.id, s.name, s.symbol_type AS symbolType, s.visibility,
     COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS file, f.id AS fileId
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','struct','enum')`, [projectId]],
  ["usage rows (orphans.ts:57-60)", `SELECT target_symbol_id AS id, target_external AS ext FROM brain_relationship
     WHERE project_id = ? AND relationship_type IN ('calls','instantiates','extends','implements','uses')`, [projectId]],
  ["duplicate names (orphans.ts:69-71)", `SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1`, [projectId]],
  ["cross-file edges (orphans.ts:100-104)", `SELECT r.source_symbol_id AS src, r.target_symbol_id AS tgt FROM brain_relationship r
     WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IS NOT NULL
       AND r.relationship_type IN ('calls','instantiates','extends','implements','uses')`, [projectId]],
  ["import targets (orphans.ts:207-209)", `SELECT target_external AS ext FROM brain_relationship
     WHERE project_id = ? AND relationship_type = 'imports'`, [projectId]],
  ["all files (orphans.ts:199-201)", `SELECT id, relative_path AS relativePath FROM brain_file WHERE project_id = ?`, [projectId]],
]

function run(label, list) {
  console.log(`\n--- ${list === statements ? "detectIndexRules" : "detectOrphans"} ---`)
  for (const [name, sql, params] of list) {
    const t0 = process.hrtime.bigint()
    let n = -1
    let err = null
    try { n = db.prepare(sql).all(...params).length } catch (e) { err = String(e.message).slice(0, 80) }
    const t = Number(process.hrtime.bigint() - t0) / 1e6
    console.log(`   ${t.toFixed(0).padStart(7)}ms  rows=${String(n).padStart(6)}  ${name}${err ? "  ERR: " + err : ""}`)
  }
}
run("rules", statements)
run("orphans", orphanStatements)
db.close()
