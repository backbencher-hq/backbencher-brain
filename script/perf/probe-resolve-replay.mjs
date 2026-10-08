// probe-resolve-replay.mjs — time resolveRelationships' statements, in order,
// through the SAME driver the indexer uses.
//
// Run: node script/perf/probe-resolve-replay.mjs <brain.db> <projectId>
//
// script/perf/probe-resolve-steps.mjs already attributes the phase's time to
// statements, but it does it through the sqlite3 CLI. This one goes through
// better-sqlite3 — the driver `resolveRelationships` actually uses — because a
// 180× discrepancy between the two is itself the finding, and only one of them
// is the code path.
//
// It replays the statements against a COPY so a measurement artifact is never
// mutated, and it prints each step's wall time as the indexer would see it.

import Database from "better-sqlite3"
import { copyFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const dbPath = process.argv[2]
const projectId = process.argv[3]
if (!dbPath || !projectId) {
  console.error("usage: probe-resolve-replay.mjs <brain.db> <projectId>")
  process.exit(2)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-replay-"))
const copy = path.join(tmp, "brain.db")
copyFileSync(dbPath, copy)
const db = new Database(copy)

const P = projectId
const rows = []
let total = 0
const step = (name, fn) => {
  const t0 = process.hrtime.bigint()
  const changes = fn()
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  total += ms
  rows.push({ step: name, ms: Math.round(ms), changes })
}

db.exec(`CREATE TEMP TABLE _res_qname (qualified_name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT);
         CREATE TEMP TABLE _res_name (name TEXT, symbol_id TEXT NOT NULL, file_id TEXT, cnt INTEGER);
         CREATE TEMP TABLE _i13_src (rel_id, src_file, src_lang);
         CREATE TEMP TABLE _i13_tier (name, tier);
         CREATE TEMP TABLE _i13_best_file (name, file_id, symbol_id);
         CREATE TEMP TABLE _i13_best_lang (name, lang, symbol_id);
         CREATE TEMP TABLE _i13_best_any (name, symbol_id);
         CREATE TEMP TABLE _i13_pick (rel_id, target_symbol_id);`)

step("fill _res_qname", () =>
  db
    .prepare(
      `INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id)
       SELECT qualified_name, MIN(id), MIN(file_id) FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL GROUP BY qualified_name`,
    )
    .run(P).changes)

step("fill _res_name", () =>
  db
    .prepare(
      `INSERT OR IGNORE INTO _res_name (name, symbol_id, file_id, cnt)
       SELECT name, id, file_id, COUNT(*) OVER (PARTITION BY name)
       FROM brain_symbol WHERE project_id = ?`,
    )
    .run(P).changes)

step("index _res_name", () => {
  db.exec(`CREATE INDEX IF NOT EXISTS _res_name_idx ON _res_name(name);
           CREATE INDEX IF NOT EXISTS _res_name_uniq_idx ON _res_name(name, cnt)`)
  return 0
})

step("strategy 1 qualified", () =>
  db
    .prepare(
      `UPDATE brain_relationship
       SET target_symbol_id = _res_qname.symbol_id,
           is_cross_file = CASE WHEN _res_qname.file_id != COALESCE(
             (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
           ) THEN 1 ELSE 0 END
       FROM _res_qname
       WHERE brain_relationship.target_external = _res_qname.qualified_name
         AND brain_relationship.target_symbol_id IS NULL
         AND brain_relationship.target_external IS NOT NULL
         AND brain_relationship.project_id = ?`,
    )
    .run(P).changes)

step("strategy 2 unambiguous", () =>
  db
    .prepare(
      `UPDATE brain_relationship
       SET target_symbol_id = _res_name.symbol_id,
           is_cross_file = CASE WHEN _res_name.file_id != COALESCE(
             (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
           ) THEN 1 ELSE 0 END
       FROM _res_name
       WHERE brain_relationship.target_external = _res_name.name
         AND _res_name.cnt = 1
         AND brain_relationship.target_symbol_id IS NULL
         AND brain_relationship.target_external IS NOT NULL
         AND brain_relationship.project_id = ?`,
    )
    .run(P).changes)

step("i13 _src", () => {
  db.exec(`DELETE FROM _i13_src`)
  return db
    .prepare(
      `INSERT INTO _i13_src (rel_id, src_file, src_lang)
       SELECT r.id, src.file_id, COALESCE(sf.language, '')
       FROM brain_relationship r
       LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = src.file_id
       WHERE r.project_id = ?`,
    )
    .run(P).changes
})

step("i13 _tier", () => {
  db.exec(`DELETE FROM _i13_tier`)
  db.exec(`CREATE UNIQUE INDEX temp._i13_tier_name ON _i13_tier(name)`)
  return db
    .prepare(
      `INSERT INTO _i13_tier (name, tier)
       SELECT name, MIN(COALESCE(is_declaration, 0)) FROM brain_symbol WHERE project_id = ? GROUP BY name`,
    )
    .run(P).changes
})

step("i13 _best_file", () => {
  db.exec(`DELETE FROM _i13_best_file; CREATE UNIQUE INDEX temp._i13_best_file_key ON _i13_best_file(name, file_id)`)
  return db
    .prepare(
      `INSERT INTO _i13_best_file (name, file_id, symbol_id)
       SELECT s.name, s.file_id, MIN(s.id)
       FROM brain_symbol s
       JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       WHERE s.project_id = ? GROUP BY s.name, s.file_id`,
    )
    .run(P).changes
})

step("i13 _best_lang", () => {
  db.exec(`DELETE FROM _i13_best_lang; CREATE UNIQUE INDEX temp._i13_best_lang_key ON _i13_best_lang(name, lang)`)
  return db
    .prepare(
      `INSERT INTO _i13_best_lang (name, lang, symbol_id)
       SELECT s.name, COALESCE(f.language, ''), MIN(s.id)
       FROM brain_symbol s
       JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       LEFT JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id = ? GROUP BY s.name, COALESCE(f.language, '')`,
    )
    .run(P).changes
})

step("i13 _best_any", () => {
  db.exec(`DELETE FROM _i13_best_any; CREATE UNIQUE INDEX temp._i13_best_any_key ON _i13_best_any(name)`)
  return db
    .prepare(
      `INSERT INTO _i13_best_any (name, symbol_id)
       SELECT s.name, MIN(s.id)
       FROM brain_symbol s
       JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       WHERE s.project_id = ? GROUP BY s.name`,
    )
    .run(P).changes
})

step("i13 _pick", () => {
  db.exec(`DELETE FROM _i13_pick; CREATE UNIQUE INDEX temp._i13_pick_rel ON _i13_pick(rel_id)`)
  return db
    .prepare(
      `INSERT INTO _i13_pick (rel_id, target_symbol_id)
       SELECT t.rel_id, COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id)
       FROM _i13_src t
       JOIN brain_relationship r ON r.id = t.rel_id
       LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
       LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
       LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
       WHERE r.project_id = ?
         AND r.target_external IS NOT NULL
         AND r.relationship_type <> 'contains'
         AND instr(r.target_external, '.') = 0
         AND instr(r.target_external, ':') = 0
         AND COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) IS NOT NULL`,
    )
    .run(P).changes
})

step("i13 apply", () =>
  db
    .prepare(
      `UPDATE brain_relationship SET target_symbol_id = p.target_symbol_id
       FROM _i13_pick p WHERE brain_relationship.id = p.rel_id`,
    )
    .run().changes)

step("i13 recompute is_cross_file", () =>
  db
    .prepare(
      `UPDATE brain_relationship
       SET is_cross_file = CASE WHEN t.file_id <> s.file_id THEN 1 ELSE 0 END
       FROM brain_symbol t, brain_symbol s
       WHERE t.id = brain_relationship.target_symbol_id
         AND s.id = brain_relationship.source_symbol_id
         AND brain_relationship.project_id = ?
         AND brain_relationship.relationship_type <> 'contains'
         AND instr(brain_relationship.target_external, '.') = 0
         AND instr(brain_relationship.target_external, ':') = 0`,
    )
    .run(P).changes)

step("cross-language pass", () =>
  db
    .prepare(
      `UPDATE brain_relationship
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
       WHERE brain_relationship.project_id = ?
         AND brain_relationship.target_symbol_id IS NOT NULL`,
    )
    .run(P).changes)

const plan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT t.rel_id, COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id)
     FROM _i13_src t
     JOIN brain_relationship r ON r.id = t.rel_id
     LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
     LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
     LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
     WHERE r.project_id = ? AND r.target_external IS NOT NULL
       AND r.relationship_type <> 'contains'
       AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0`,
  )
  .all(P)
  .map((r) => r.detail)

console.log(JSON.stringify({ db: path.basename(path.dirname(dbPath)), totalMs: Math.round(total), steps: rows, pickPlan: plan }, null, 1))
db.close()
rmSync(tmp, { recursive: true, force: true })
