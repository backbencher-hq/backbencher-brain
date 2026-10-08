// Timing probe for the SQL statements inside resolveRelationships.
//
// Run with: node script/perf/probe-resolve-steps.mjs <brain.db> <projectId>
//
// Each statement is timed in isolation against an already-indexed DB, in the
// same order resolveRelationships issues them, so the numbers attribute the
// phase's wall time to individual statements rather than to "SQL" as a lump.
// Statements are written to a COPY of the DB so the probe never mutates a
// measurement artifact.
//
// This is a probe, not a gate: it prints, it does not assert.

import Database from "better-sqlite3"
import { copyFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const dbPath = process.argv[2]
const projectId = process.argv[3]
if (!dbPath || !projectId) {
  console.error("usage: probe-resolve-steps.mjs <brain.db> <projectId>")
  process.exit(2)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-probe-"))
const copy = path.join(tmp, "brain.db")
copyFileSync(dbPath, copy)
const db = new Database(copy)

const steps = [
  ["fill _res_qname", `INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id)
     SELECT qualified_name, MIN(id), MIN(file_id) FROM brain_symbol
     WHERE project_id = '${projectId}' AND qualified_name IS NOT NULL GROUP BY qualified_name`],
  ["fill _res_name", `INSERT OR IGNORE INTO _res_name (name, symbol_id, file_id, cnt)
     SELECT name, id, file_id, COUNT(*) OVER (PARTITION BY name)
     FROM brain_symbol WHERE project_id = '${projectId}'`],
  ["index _res_name", `CREATE INDEX IF NOT EXISTS _res_name_idx ON _res_name(name)`],
  ["strategy 1 qualified", `UPDATE brain_relationship
     SET target_symbol_id = _res_qname.symbol_id,
         is_cross_file = CASE WHEN _res_qname.file_id != COALESCE(
           (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
         ) THEN 1 ELSE 0 END
     FROM _res_qname
     WHERE brain_relationship.target_external = _res_qname.qualified_name
       AND brain_relationship.target_symbol_id IS NULL
       AND brain_relationship.target_external IS NOT NULL
       AND brain_relationship.project_id = '${projectId}'`],
  ["strategy 2 unambiguous", `UPDATE brain_relationship
     SET target_symbol_id = _res_name.symbol_id,
         is_cross_file = CASE WHEN _res_name.file_id != COALESCE(
           (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
         ) THEN 1 ELSE 0 END
     FROM _res_name
     WHERE brain_relationship.target_external = _res_name.name
       AND _res_name.cnt = 1
       AND brain_relationship.target_symbol_id IS NULL
       AND brain_relationship.target_external IS NOT NULL
       AND brain_relationship.project_id = '${projectId}'`],
  ["i13 _src", `CREATE TEMP TABLE _i13_src AS
     SELECT r.id AS rel_id, src.file_id AS src_file, COALESCE(sf.language, '') AS src_lang
     FROM brain_relationship r
     LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
     LEFT JOIN brain_file sf ON sf.id = src.file_id
     WHERE r.project_id = '${projectId}'`],
  ["i13 _pick (window sort)", `CREATE TEMP TABLE _i13_pick AS
     SELECT rel_id, target_symbol_id FROM (
       SELECT t.rel_id AS rel_id, s.id AS target_symbol_id,
              ROW_NUMBER() OVER (PARTITION BY t.rel_id
                ORDER BY COALESCE(s.is_declaration, 0) ASC,
                         (s.file_id = t.src_file) DESC,
                         (COALESCE(f.language, '') = t.src_lang) DESC,
                         s.id ASC) AS rn
       FROM _i13_src t
       JOIN brain_relationship r ON r.id = t.rel_id
       JOIN brain_symbol s ON s.project_id = '${projectId}' AND s.name = r.target_external
       LEFT JOIN brain_file f ON f.id = s.file_id
       WHERE r.project_id = '${projectId}'
         AND r.target_external IS NOT NULL
         AND r.relationship_type <> 'contains'
         AND instr(r.target_external, '.') = 0
         AND instr(r.target_external, ':') = 0
     ) WHERE rn = 1`],
  ["i13 _pick index", `CREATE UNIQUE INDEX temp._i13_pick_rel ON _i13_pick(rel_id)`],
  ["i13 apply", `UPDATE brain_relationship
     SET target_symbol_id = p.target_symbol_id
     FROM _i13_pick p WHERE brain_relationship.id = p.rel_id`],
  ["i13 recompute is_cross_file", `UPDATE brain_relationship
     SET is_cross_file = CASE WHEN t.file_id <> s.file_id THEN 1 ELSE 0 END
     FROM brain_symbol t, brain_symbol s
     WHERE t.id = brain_relationship.target_symbol_id
       AND s.id = brain_relationship.source_symbol_id
       AND brain_relationship.project_id = '${projectId}'
       AND brain_relationship.relationship_type <> 'contains'
       AND instr(brain_relationship.target_external, '.') = 0
       AND instr(brain_relationship.target_external, ':') = 0`],
  ["cross-language pass", `UPDATE brain_relationship
     SET is_cross_language = CASE WHEN EXISTS (
           SELECT 1 FROM brain_symbol ss
           LEFT JOIN brain_file sf ON sf.id = ss.file_id
           JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
           LEFT JOIN brain_file tf ON tf.id = ts.file_id
           WHERE ss.id = brain_relationship.source_symbol_id
             AND COALESCE(sf.language, '') <> ''
             AND COALESCE(tf.language, '') <> ''
             AND lower(sf.language) <> lower(tf.language)
         ) THEN 1 ELSE brain_relationship.is_cross_language END,
         bridge_mechanism = COALESCE(
           brain_relationship.bridge_mechanism,
           CASE WHEN EXISTS (
             SELECT 1 FROM brain_symbol ss
             LEFT JOIN brain_file sf ON sf.id = ss.file_id
             JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
             LEFT JOIN brain_file tf ON tf.id = ts.file_id
             WHERE ss.id = brain_relationship.source_symbol_id
               AND COALESCE(sf.language, '') <> ''
               AND COALESCE(tf.language, '') <> ''
               AND lower(sf.language) <> lower(tf.language)
           ) THEN 'name-resolution' ELSE NULL END
         )
     WHERE brain_relationship.project_id = '${projectId}'
       AND brain_relationship.target_symbol_id IS NOT NULL`],
]

db.exec(`CREATE TEMP TABLE _res_qname (qualified_name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT);
         CREATE TEMP TABLE _res_name (name TEXT, symbol_id TEXT NOT NULL, file_id TEXT, cnt INTEGER);`)

const out = []
let total = 0
for (const [name, sql] of steps) {
  const t0 = process.hrtime.bigint()
  const info = db.prepare(sql).run()
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  total += ms
  out.push({ step: name, ms: Math.round(ms), changes: info.changes })
}

const rels = db.prepare(`SELECT COUNT(*) c FROM brain_relationship`).get().c
const pickRows = db.prepare(`SELECT COUNT(*) c FROM _i13_pick`).get().c
const joinRows = db
  .prepare(
    `SELECT COUNT(*) c FROM brain_relationship r
     JOIN brain_symbol s ON s.project_id = r.project_id AND s.name = r.target_external
     WHERE r.project_id = ? AND r.target_external IS NOT NULL
       AND r.relationship_type <> 'contains'
       AND instr(r.target_external,'.')=0 AND instr(r.target_external,':')=0`,
  )
  .get(projectId).c

console.log(JSON.stringify({ db: path.basename(path.dirname(dbPath)), projectId, relationships: rels, joinRows, pickRows, totalMs: Math.round(total), steps: out }, null, 1))

db.close()
rmSync(tmp, { recursive: true, force: true })
