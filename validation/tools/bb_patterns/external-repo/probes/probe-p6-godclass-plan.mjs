// bb_tests/bb_patterns/probes/probe-p6-godclass-plan.mjs
// P6 — the god-class rule's self-join does not use the index that exists for it.
//
// MEASURED PLAN for src/intelligence/patterns/rules.ts:91-97 on the real index:
//
//   SEARCH s USING INDEX brain_sym_proj_type_idx (project_id=? AND symbol_type=?)
//   SEARCH f USING INDEX sqlite_autoindex_brain_file_1 (id=?)
//   SEARCH m USING INDEX brain_sym_proj_type_idx (project_id=?) LEFT-JOIN
//   USE TEMP B-TREE FOR GROUP BY
//   USE TEMP B-TREE FOR ORDER BY
//
// `brain_symbol_owner_idx ON brain_symbol(owner_symbol_id)` EXISTS and is
// exactly the index for `m.owner_symbol_id = s.id`, but the planner picks
// brain_sym_proj_type_idx(project_id=?) instead, turning the member count into
// a |outer rows| x |all symbols in project| scan. That is the statement P4 sat
// on for minutes at 42% CPU.
//
// This file measures the original and four rewrites, on the real index, so the
// fix is chosen from a number rather than from taste.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const projectId = process.argv[2]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })

const TYPES = "'class','interface','struct','trait','enum'"

const variants = [
  ["A. as shipped (LEFT JOIN + GROUP BY + HAVING)", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`],

  ["B. same, no redundant m.project_id predicate", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`],

  ["C. correlated COUNT(*) over the owner index", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line,
           (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES}) AND
      (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > 10
    ORDER BY members DESC`],

  ["D. pre-aggregate members, then join", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`],

  ["E. D, restricted to the project before aggregating", `
    SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE project_id = ? AND owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`],
]

console.log("=== plan for the shipped query ===")
for (const r of db.prepare(`EXPLAIN QUERY PLAN ${variants[0][1]}`).all(projectId)) console.log("   " + r.detail)

console.log("\n=== timing each rewrite (same result required, not assumed) ===")
const results = []
for (const [name, sql] of variants) {
  const params = name.startsWith("E.") ? [projectId, projectId] : [projectId]
  const t0 = process.hrtime.bigint()
  let rows = []
  let err = null
  try { rows = db.prepare(sql).all(...params) } catch (e) { err = String(e.message).slice(0, 90) }
  const t = Number(process.hrtime.bigint() - t0) / 1e6
  const key = rows.map((r) => `${r.name}@${r.members}`).sort().join("|")
  results.push({ name, t, n: rows.length, key, err })
  console.log(`   ${t.toFixed(0).padStart(8)}ms  rows=${String(rows.length).padStart(4)}  ${name}${err ? "  ERR " + err : ""}`)
}
console.log("\n=== do the rewrites agree with the shipped query? ===")
const base = results[0]
for (const r of results.slice(1)) {
  console.log(`   ${r.name.split(".")[0]}: ${r.key === base.key ? "IDENTICAL result set" : "DIFFERENT (" + r.n + " vs " + base.n + " rows) -- investigate, do not ship blind"}`)
}
db.close()
