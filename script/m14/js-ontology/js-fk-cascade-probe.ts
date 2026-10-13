#!/usr/bin/env bun
/**
 * JAVASCRIPT lane — what does the SCHEMA do to an inbound edge when its target
 * symbol is re-written? Four operations, four answers, measured rather than
 * assumed, because the store's deletion policy was justified by a claim about
 * them that turns out to be false.
 *
 * The claim, in storeResults' own comment, was: "without deleting the
 * relationships that target this file's symbols, deleteFileSymbols fails with
 * FK violation". The DDL
 * (`src/brain/schema-ddl.ts`) says something else, and this probe is the
 * measurement:
 *
 *   brain_relationship.source_symbol_id → brain_symbol(id) ON DELETE CASCADE
 *   brain_relationship.target_symbol_id → brain_symbol(id) ON DELETE SET NULL
 *   brain_symbol.file_id                → brain_file(id)   ON DELETE CASCADE
 *
 * The four operations, in the order a store actually performs them:
 *
 *   1. INSERT OR REPLACE the file row        → cascades: the file's symbols are
 *                                              deleted; rows sourced from them
 *                                              go; rows targeting them lose the
 *                                              POINTER but survive
 *   2. INSERT OR REPLACE a symbol (same id)  → same: SET NULL on inbound rows
 *   3. UPSERT a symbol (ON CONFLICT DO UPDATE) → nothing: inbound rows keep
 *                                              their pointer
 *   4. DELETE a symbol                       → SET NULL, never an error
 *
 * So the store destroyed, on every re-index, exactly the rows it could not
 * re-create — and it did not have to. The row-level consequence is measured end
 * to end by `script/m14/verify-store-path-parity.ts`; this probe is the
 * primitive underneath it.
 *
 * Usage: bun run script/m14/js-ontology/js-fk-cascade-probe.ts
 */
import { Database } from "bun:sqlite"

const db = new Database(":memory:")
db.run(`PRAGMA foreign_keys = ON`)
db.run(`CREATE TABLE brain_file (id TEXT PRIMARY KEY, path TEXT)`)
db.run(`CREATE TABLE brain_symbol (id TEXT PRIMARY KEY, file_id TEXT, name TEXT, line_start INTEGER,
  FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE)`)
db.run(`CREATE TABLE brain_relationship (id TEXT PRIMARY KEY, source_symbol_id TEXT, target_symbol_id TEXT,
  FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
  FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL)`)

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
const rows = () => db.prepare(`SELECT id, source_symbol_id AS src, target_symbol_id AS tgt FROM brain_relationship ORDER BY id`).all() as any[]
const symbols = () => db.prepare(`SELECT id, name FROM brain_symbol ORDER BY id`).all() as any[]

/** fresh two-file world: f1 declares X, f2 declares caller (source of the edge) */
function seed() {
  db.run(`DELETE FROM brain_relationship`)
  db.run(`DELETE FROM brain_symbol`)
  db.run(`DELETE FROM brain_file`)
  db.run(`INSERT INTO brain_file VALUES ('f1','a.js'),('f2','b.js')`)
  db.run(`INSERT INTO brain_symbol VALUES ('f1:X:1','f1','X',1),('f2:caller:1','f2','caller',1)`)
  db.run(`INSERT INTO brain_relationship VALUES ('rel1','f2:caller:1','f1:X:1')`)
}

console.log(`fk behaviour probe — inbound edge under four store operations\n`)

// 1. REPLACE the FILE row (what storeResults does on every re-store)
seed()
db.run(`INSERT OR REPLACE INTO brain_file (id, path) VALUES ('f1','a.js')`)
check(
  "file REPLACE keeps the inbound ROW and clears its target (SET NULL)",
  rows().length === 1 && rows()[0].tgt === null,
  `rows=${JSON.stringify(rows())} symbols=${JSON.stringify(symbols())}`,
)

// 2. REPLACE the TARGET symbol with the same id
seed()
db.run(`INSERT OR REPLACE INTO brain_symbol (id, file_id, name, line_start) VALUES ('f1:X:1','f1','X',1)`)
check(
  "symbol REPLACE keeps the inbound ROW and clears its target (SET NULL)",
  rows().length === 1 && rows()[0].tgt === null,
  `rows=${JSON.stringify(rows())}`,
)

// 3. UPSERT the target symbol in place
seed()
db.run(
  `INSERT INTO brain_symbol (id, file_id, name, line_start) VALUES ('f1:X:1','f1','X',2)
   ON CONFLICT(id) DO UPDATE SET file_id=excluded.file_id, name=excluded.name, line_start=excluded.line_start`,
)
check(
  "symbol UPSERT preserves the inbound pointer (the row is not rewritten)",
  rows().length === 1 && rows()[0].tgt === 'f1:X:1' && symbols().find((s) => s.id === 'f1:X:1').name === 'X',
  `rows=${JSON.stringify(rows())}`,
)

// 4. DELETE the target symbol
seed()
db.run(`DELETE FROM brain_symbol WHERE id = 'f1:X:1'`)
check(
  "symbol DELETE is a SET NULL, never a foreign-key error",
  rows().length === 1 && rows()[0].tgt === null,
  `rows=${JSON.stringify(rows())}`,
)

// 5. the negative control: an edge sourced FROM the deleted symbol does go (cascade)
seed()
db.run(`INSERT INTO brain_symbol VALUES ('f1:Y:2','f1','Y',2)`)
db.run(`INSERT INTO brain_relationship VALUES ('rel2','f1:Y:2','f2:caller:1')`)
db.run(`DELETE FROM brain_symbol WHERE id = 'f1:Y:2'`)
check(
  "a row SOURCED from the deleted symbol is removed (CASCADE)",
  !rows().some((r) => r.id === 'rel2') && rows().some((r) => r.id === 'rel1'),
  `rows=${JSON.stringify(rows())}`,
)

let failed = 0
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}\n      ${c.detail}`)
  if (!c.ok) failed++
}
console.log(`\njs-fk-cascade-probe: ${checks.length - failed}/${checks.length} pass`)
process.exit(failed === 0 ? 0 : 1)
