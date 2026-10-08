// probe-rel-id-collisions.mjs — how many analyzer-emitted relationships the
// store DROPS because two of them claim the same relationship id.
//
// Run: node script/perf/probe-rel-id-collisions.mjs <brain.db>
//
// storeResults builds every relationship id as
//
//   `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
//
// and inserts with INSERT OR IGNORE, so the id IS the identity of an edge: two
// emissions with one id become one row, silently. When `sourceId` is null — the
// unresolved-caller case — the id carries no file identity at all, so the same
// (target, type, line) emitted by two different files collides.
//
// This probe reports the stored shape and then measures the collision directly:
// it re-derives, from the STORED rows, how many distinct
// (source_external, target, type, line) tuples exist among null-source rows and
// how many distinct (target, type, line) tuples those rows occupy. The gap is
// the number of stored edges that stand in for more than one real call site.
//
// A probe, not a gate: it prints, it does not assert.

import Database from "better-sqlite3"
import { basename, dirname } from "path"

const dbPath = process.argv[2]
if (!dbPath) {
  console.error("usage: probe-rel-id-collisions.mjs <brain.db>")
  process.exit(2)
}
const db = new Database(dbPath, { readonly: true })

const byKind = db.prepare(`SELECT relationship_type k, COUNT(*) c FROM brain_relationship GROUP BY k ORDER BY k`).all()

const nullSrc = db
  .prepare(
    `SELECT COUNT(*) rows,
            COUNT(DISTINCT source_external) srcs,
            COUNT(DISTINCT id) ids
     FROM brain_relationship WHERE source_symbol_id IS NULL`,
  )
  .get()

// The stored id for a null-source row is projectId:rel:null:<target>:<type>:<line>
// — no file. So two files emitting the same (target, type, line) produce ONE row.
// A tuple that appears for N distinct source_external values therefore stands in
// for N emissions.
const collisions = db
  .prepare(
    `SELECT target_external, relationship_type, line_number,
            COUNT(DISTINCT source_external) contributors
     FROM brain_relationship
     WHERE source_symbol_id IS NULL
     GROUP BY target_external, relationship_type, line_number
     HAVING contributors > 1
     ORDER BY contributors DESC
     LIMIT 10`,
  )
  .all()

const colliderRows = db
  .prepare(
    `SELECT SUM(c) collapsed_rows, SUM(c - 1) hidden_emissions, COUNT(*) tuples
     FROM (
       SELECT COUNT(DISTINCT source_external) c
       FROM brain_relationship WHERE source_symbol_id IS NULL
       GROUP BY target_external, relationship_type, line_number
     ) WHERE c > 1`,
  )
  .get()

console.log(
  JSON.stringify(
    {
      db: basename(dirname(dbPath)),
      byKind: Object.fromEntries(byKind.map((r) => [r.k, r.c])),
      nullSourceRows: nullSrc.rows,
      distinctNullIds: nullSrc.ids,
      distinctSourceExternals: nullSrc.srcs,
      collisionTuples: colliderRows.tuples,
      rowsInvolved: colliderRows.collapsed_rows,
      // Emissions the single stored row stands in for, beyond the one it holds.
      hiddenEmissions: colliderRows.hidden_emissions,
      worst: collisions,
    },
    null,
    1,
  ),
)
db.close()
