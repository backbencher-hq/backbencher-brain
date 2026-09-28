// script/m54/probe-fk.ts — M54.P1 evidence probe (read-only on real data; all
// mutations happen on throwaway fixture DBs). Establishes the FK-ON truth
// table that decides the P1 design:
//   A1. INSERT OR REPLACE on a symbol that is a relationship SOURCE + FK ON:
//       the edge is cascade-DELETED (data loss if no pre-delete).
//   A2. INSERT OR REPLACE on a symbol that is an edge TARGET + FK ON:
//       edge survives, target nulled (ON DELETE SET NULL) — repairable.
//   A3. Same REPLACE under FK OFF (bun's current default): nothing happens —
//       the runtime asymmetry in one measurement.
//   B.  The store path's exact statement sequence (pre-delete rels by
//       source+target, delete symbols/imports, insert file, insert symbols,
//       insert relationships) under FK ON: clean pass?
//   C.  UPDATE touching a HISTORICAL orphan row (created FK-OFF, pragma then
//       ON — exactly the real DB's situation) fails under FK ON → a one-time
//       cleanup migration is REQUIRED before enabling.
//   D.  Cleanup migration deletes exactly the FK-violating rows, nothing else.

import { Database } from "bun:sqlite"
import { mkdirSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"

const TMP = path.join("/tmp", `m54-probe-${Date.now()}`)
mkdirSync(TMP, { recursive: true })
const results: Record<string, string> = {}
const check = (name: string, ok: boolean, detail: string) => {
  results[name] = `${ok ? "PASS" : "FAIL"} — ${detail}`
  console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`)
}

function freshDb(file: string): Database {
  const db = new Database(path.join(TMP, file))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(`
    CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, path TEXT, time_updated INTEGER);
    CREATE TABLE brain_symbol (
      id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT, owner_symbol_id TEXT,
      time_updated INTEGER,
      FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
    );
    CREATE TABLE brain_relationship (
      id TEXT PRIMARY KEY, project_id TEXT,
      source_symbol_id TEXT NOT NULL, target_symbol_id TEXT,
      relationship_type TEXT, time_updated INTEGER,
      FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
      FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL
    );
  `)
  return db
}

const PID = "p1"
function seedFile(db: Database, fid: string) {
  db.prepare(`INSERT INTO brain_file (id, project_id, path, time_updated) VALUES (?, ?, ?, 1)`).run(fid, PID, `/x/${fid}.ts`)
}
function seedSymbol(db: Database, sid: string, fid: string) {
  db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES (?, ?, ?, ?, 1)`).run(sid, PID, fid, sid.split(":").pop())
}
function edge(db: Database, id: string, src: string, tgt: string | null) {
  db.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, time_updated) VALUES (?, ?, ?, ?, 'calls', 1)`).run(id, PID, src, tgt)
}

// ── A1. REPLACE of an edge SOURCE under FK ON → cascade delete ────────────
{
  const db = freshDb("a1.db")
  db.exec("PRAGMA foreign_keys = ON")
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1"); seedSymbol(db, "f1:bar:5", "f1")
  seedFile(db, "f2"); seedSymbol(db, "f2:baz:1", "f2")
  edge(db, "r1", "f1:bar:5", "f2:baz:1")
  db.prepare(`INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES ('f1:bar:5', ?, 'f1', 'bar', 2)`).run(PID)
  const rel = db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE id='r1'`).get() as any
  // THE HAZARD: the edge is gone — REPLACE deletes the old symbol row, the
  // source-side FK (ON DELETE CASCADE) fires, r1 silently disappears.
  check("A1.REPLACE-source-cascades", rel.c === 0, `FK ON + REPLACE of a SOURCE symbol: edge row count after = ${rel.c} (expected 0) — REPLACE silently cascade-DELETES outgoing edges; any write path REPLACEing symbols without pre-deleting relationships loses data`)
  db.close()
}

// ── A2. REPLACE of an edge TARGET under FK ON → SET NULL ──────────────────
{
  const db = freshDb("a2.db")
  db.exec("PRAGMA foreign_keys = ON")
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1")
  seedFile(db, "f2"); seedSymbol(db, "f2:baz:1", "f2")
  edge(db, "r2", "f1:foo:1", "f2:baz:1")
  db.prepare(`INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES ('f2:baz:1', ?, 'f2', 'baz', 2)`).run(PID)
  const rel = db.prepare(`SELECT id, target_symbol_id FROM brain_relationship WHERE id='r2'`).get() as any
  const benign = rel && rel.target_symbol_id === null
  check("A2.REPLACE-target-sets-null", !!benign, `FK ON + REPLACE of a TARGET symbol: edge survives with target_symbol_id = ${rel ? rel.target_symbol_id : "ROW-GONE"} (expected null via ON DELETE SET NULL) — lossy but re-resolvable by the repair pass`)
  db.close()
}

// ── A3. Same REPLACE under FK OFF (bun today) → nothing happens ───────────
{
  const db = freshDb("a3.db")
  db.exec("PRAGMA foreign_keys = OFF")
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1"); seedSymbol(db, "f1:bar:5", "f1")
  seedFile(db, "f2"); seedSymbol(db, "f2:baz:1", "f2")
  edge(db, "r1", "f1:bar:5", "f2:baz:1")
  db.prepare(`INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES ('f1:bar:5', ?, 'f1', 'bar', 2)`).run(PID)
  const rel = db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE id='r1'`).get() as any
  check("A3.REPLACE-source-FKOFF-noop", rel.c === 1, `FK OFF (bun's current default) + same REPLACE: edge row count = ${rel.c} (expected 1) — proving the runtime asymmetry: the same statement keeps data under bun and destroys it under node`)
  db.close()
}

// ── B. store-path sequence under FK ON ────────────────────────────────────
{
  const db = freshDb("b.db")
  db.exec("PRAGMA foreign_keys = ON")
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1")
  seedFile(db, "f2"); seedSymbol(db, "f2:baz:1", "f2")
  edge(db, "old1", "f1:foo:1", "f2:baz:1")     // out-edge of the re-stored file
  edge(db, "old2", "f2:baz:1", "f1:foo:1")     // in-edge from another file
  try {
    const tx = db.transaction(() => {
      // exact storeResults order (parallel-indexer.ts ~1806-1815)
      db.prepare(`DELETE FROM brain_relationship WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)`).run("f1")
      db.prepare(`DELETE FROM brain_relationship WHERE target_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)`).run("f1")
      db.prepare(`DELETE FROM brain_symbol WHERE file_id = ?`).run("f1")
      db.prepare(`INSERT OR REPLACE INTO brain_file (id, project_id, path, time_updated) VALUES ('f1', ?, '/x/f1.ts', 2)`).run(PID)
      db.prepare(`INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES ('f1:foo:1', ?, 'f1', 'foo', 2)`).run(PID)
      db.prepare(`INSERT OR IGNORE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, time_updated) VALUES ('new1', ?, 'f1:foo:1', 'f2:baz:1', 'calls', 2)`).run(PID)
    })
    tx()
    const rels = (db.prepare(`SELECT id FROM brain_relationship ORDER BY id`).all() as any[]).map(r => r.id)
    check("B.store-sequence-FKON", rels.join(",") === "new1", `store sequence passes under FK ON; end state [${rels.join(", ")}] (expected [new1]: old edges pre-deleted by the path itself, new edge inserted) — the pre-delete ordering is LOAD-BEARING under FK ON`)
  } catch (e: any) {
    check("B.store-sequence-FKON", false, `store sequence FAILED under FK ON: ${e.message}`)
  }
  db.close()
}

// ── C. UPDATE on a historical orphan row once FK is ON ────────────────────
{
  const db = freshDb("c.db")
  db.exec("PRAGMA foreign_keys = OFF")           // how the historical rows were written
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1")
  edge(db, "orph1", "ghost:src", null)
  edge(db, "orph2", "ghost:src", "f1:foo:1")
  db.exec("PRAGMA foreign_keys = ON")            // the state after P1's change
  let updateFailed = false
  try {
    db.prepare(`UPDATE brain_relationship SET target_symbol_id = 'f1:foo:1' WHERE id = 'orph1'`).run()
  } catch { updateFailed = true }
  check("C.update-historical-orphan", updateFailed, updateFailed
    ? "UPDATE touching a historical orphan-source row fails under FK ON (real DB holds 4,154 such rows; repair UPDATEs scan target_symbol_id IS NULL and would abort their statement) → one-time cleanup migration is REQUIRED before enabling"
    : "UPDATE of orphan row unexpectedly passed — cleanup would be optional")
  db.close()
}

// ── D. cleanup migration deletes exactly violators ────────────────────────
{
  const db = freshDb("d.db")
  db.exec("PRAGMA foreign_keys = OFF")
  seedFile(db, "f1"); seedSymbol(db, "f1:foo:1", "f1")
  edge(db, "good", "f1:foo:1", null)
  edge(db, "bad1", "ghost", null)
  db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, time_updated) VALUES ('s:orphan', ?, 'ghostfile', 'x', 1)`).run(PID)
  const delRels = db.prepare(`DELETE FROM brain_relationship WHERE source_symbol_id IN (SELECT r.source_symbol_id FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE s.id IS NULL)`).run()
  const delSyms = db.prepare(`DELETE FROM brain_symbol WHERE file_id IN (SELECT s.file_id FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE f.id IS NULL)`).run()
  const left = (db.prepare(`SELECT id FROM brain_relationship`).all() as any[]).map(r => r.id)
  const leftSyms = (db.prepare(`SELECT id FROM brain_symbol`).all() as any[]).map(r => r.id)
  check("D.cleanup-precision", left.join(",") === "good" && leftSyms.length === 1 && leftSyms[0] === "f1:foo:1",
    `deleted ${delRels.changes} orphan rel(s) + ${delSyms.changes} orphan symbol(s); survivors rel=[${left}] sym=[${leftSyms}] — conforming rows untouched`)
  db.close()
}

// ── runtime defaults + bin/bb runtime ─────────────────────────────────────
{
  const bunDefault = new Database(":memory:").prepare("PRAGMA foreign_keys").get() as any
  results["runtime.bun-default"] = `bun:sqlite foreign_keys default = ${bunDefault.foreign_keys}`
  console.log(`ℹ️  bun:sqlite foreign_keys default = ${bunDefault.foreign_keys}`)
}
try {
  const bin = readFileSync("$HOME/mcp/backbencher-brain/bin/bb", "utf8").split("\n").slice(0, 5).join(" | ")
  results["runtime.bin-bb"] = bin
  console.log(`ℹ️  bin/bb header: ${bin}`)
} catch { /* non-fatal */ }

rmSync(TMP, { recursive: true, force: true })
console.log("\n=== PROBE SUMMARY ===")
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`)
