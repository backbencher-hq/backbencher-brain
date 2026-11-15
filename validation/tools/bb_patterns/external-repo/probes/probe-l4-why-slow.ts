// bb_tests/bb_patterns/probes/probe-l4-why-slow.ts
// L4 — is the cost SQLite, or is it row materialization?
//
// L3 found detectOrphans taking 187s on `move` (223,880 symbols, 898,806
// relationships) and 14.8s on solidity (56,738 symbols, 143,622 relationships) —
// 8x the rows for 12x the time. The first guess was I/O, because the database is
// 2.96 GB and the OS page cache cannot hold it alongside everything else. That
// guess is wrong and it is worth saying so precisely:
//
//   COUNT(*) over the same filter          448ms   (index-only, all 710,671 rows)
//   the same filter returning the columns   51,000ms, steady across four passes
//
// Repeat passes do not get faster (73s -> 52s -> 51s -> 55s), so it is not a cold
// cache. Something between the index and the JS rows is the cost, and the two
// candidates are: SQLite doing the rowid lookups, or better-sqlite3 building
// 710,671 JS values. This separates them.
//
//   COUNT(col) over the same rows     forces SQLite to READ every column and
//                                     return one row. All of SQLite's work, none
//                                     of the materialization.
//   .raw().all()                     returns arrays instead of objects.
//   .iterate()                       never builds an array at all.
//   one column at a time             which of the three non-indexed columns it is.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const pid = process.argv[2]
const USAGE = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]
const ph = USAGE.map(() => "?").join(",")
const IN = `r.project_id = ? AND r.relationship_type IN (${ph})`
const COLS = "r.relationship_type, r.target_symbol_id, r.target_external, r.source_symbol_id, r.confidence"

const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

const t = (label: string, fn: () => number) => {
  const t0 = process.hrtime.bigint()
  const n = fn()
  console.log(`   ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0).padStart(8)}ms  ${String(n).padStart(8)}  ${label}`)
}

const pc = db.prepare("PRAGMA page_count").get() as { page_count: number }
const ps = db.prepare("PRAGMA page_size").get() as { page_size: number }
console.log(`\nproject ${pid.slice(0, 10)}  ${(pc.page_count * ps.page_size / 1e9).toFixed(2)} GB`)
console.log(`  sqlite default cache_size = ${(db.prepare("PRAGMA cache_size").get() as any).cache_size} pages\n`)

t("index-only: COUNT(*)", () =>
  (db.prepare(`SELECT COUNT(*) c FROM brain_relationship r WHERE ${IN}`).get(pid, ...USAGE) as any).c)

t("SQLite reads all three non-indexed columns, returns 1 row", () => {
  const r = db.prepare(
    `SELECT COUNT(target_external) a, COUNT(source_symbol_id) b, COUNT(confidence) c
       FROM brain_relationship r WHERE ${IN}`,
  ).get(pid, ...USAGE) as any
  return r.a + r.b + r.c
})

t("all rows, index-covered columns only, .all() of objects", () =>
  db.prepare(`SELECT r.relationship_type, r.target_symbol_id FROM brain_relationship r WHERE ${IN}`).all(pid, ...USAGE).length)

t("all rows, all columns, .raw().all()  (arrays, not objects)", () =>
  db.prepare(`SELECT ${COLS} FROM brain_relationship r WHERE ${IN}`).raw().all(pid, ...USAGE).length)

t("all rows, all columns, .iterate()   (no array at all)", () => {
  let n = 0
  for (const _ of db.prepare(`SELECT ${COLS} FROM brain_relationship r WHERE ${IN}`).iterate(pid, ...USAGE)) n++
  return n
})

console.log("")
t("all rows, target_external alone, .raw()", () =>
  db.prepare(`SELECT r.target_external FROM brain_relationship r WHERE ${IN}`).raw().all(pid, ...USAGE).length)
t("all rows, source_symbol_id alone, .raw()", () =>
  db.prepare(`SELECT r.source_symbol_id FROM brain_relationship r WHERE ${IN}`).raw().all(pid, ...USAGE).length)
t("all rows, confidence alone, .raw()", () =>
  db.prepare(`SELECT r.confidence FROM brain_relationship r WHERE ${IN}`).raw().all(pid, ...USAGE).length)
t("all rows, metadata alone (the wide column), .raw()", () =>
  db.prepare(`SELECT r.metadata FROM brain_relationship r WHERE ${IN}`).raw().all(pid, ...USAGE).length)

db.close()
