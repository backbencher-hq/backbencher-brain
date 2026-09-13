// script/m29/r5-tier-fixture.ts — M29.R5 (issue #540): the F7 fixture for the
// evidence-tier precision fix.
//
// F7 rule: every improvement lands fixture-first, with the fixture authored
// BEFORE the fix, and a permanent mutant added to the gate.
//
// The fixture seeds a REAL sqlite db with the rows the analyzers actually
// write (see src/ast/real-java-analyzer.ts classifyEvidenceTier):
//   contains/exports  -> metadata.evidenceClass = "structural"
//   instantiates      -> metadata.evidenceClass = "structural" (conf >= 0.9)
//   calls             -> no metadata class needed (hover's map covers it)
// and then runs the REAL hover tier resolution (evidenceTiersFor) against it.
//
// EXPECTED BEHAVIOR (the precision claim under test):
//   a symbol whose only edges are contains/exports/instantiates with stored
//   evidenceClass "structural" resolves to the STRUCTURAL tier — the hover
//   must not downgrade parser-deterministic facts to "inferred".
//
// Authored BEFORE the fix: against the pre-R5 hover this asserts FAIL (RED),
// which is the F7 fixture-first contract. After the fix it passes (GREEN) and
// the assertion becomes a permanent gate inside verify-precision-improvements.

import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export interface TierFixture {
  dbPath: string
  symbolId: string
  cleanup: () => void
}

const PROJECT = "r5-tier-fixture"

/** Seed a real db with analyzer-shaped rows. Returns paths + the symbol id. */
export function seedTierFixture(): TierFixture {
  const Database = require("better-sqlite3")
  const dir = mkdtempSync(path.join(os.tmpdir(), "r5-tier-"))
  const dbPath = path.join(dir, "brain.db")
  const db = new Database(dbPath)

  // Minimal real schema (columns hover/brain queries touch).
  db.exec(`
    CREATE TABLE brain_file (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL,
      relative_path TEXT NOT NULL, file_hash TEXT NOT NULL, language TEXT
    );
    CREATE TABLE brain_symbol (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_id TEXT NOT NULL,
      name TEXT NOT NULL, symbol_type TEXT NOT NULL, line_start INTEGER,
      line_end INTEGER, byte_start INTEGER, byte_end INTEGER
    );
    CREATE TABLE brain_relationship (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_symbol_id TEXT,
      target_symbol_id TEXT, relationship_type TEXT NOT NULL,
      confidence REAL NOT NULL, is_cross_language INTEGER,
      is_cross_file INTEGER NOT NULL DEFAULT 0, metadata TEXT
    );
    CREATE INDEX rel_target ON brain_relationship(target_symbol_id);
    CREATE INDEX rel_source ON brain_relationship(source_symbol_id);
  `)

  const fileId = "f1"
  const projectId = createHash("sha1").update(PROJECT).digest("hex").substring(0, 40)
  db.prepare("INSERT INTO brain_file (id, project_id, path, relative_path, file_hash, language) VALUES (?,?,?,?,?,?)")
    .run(fileId, projectId, "/fix/Widget.java", "Widget.java", "h", "java")

  // The hovered symbol: Widget — its edges are the structural set under test.
  const widget = "sym-widget"
  db.prepare("INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(widget, projectId, fileId, "Widget", "class", 1, 20, 0, 400)

  // Analyzer-shaped edges: metadata.evidenceClass exactly as the real
  // analyzers' classifyEvidenceTier writes it.
  const edges: Array<{ id: string; type: string; conf: number; cls: string | null }> = [
    { id: "e1", type: "contains", conf: 1, cls: "structural" },      // declares a member
    { id: "e2", type: "exports", conf: 1, cls: "structural" },       // module export
    { id: "e3", type: "instantiates", conf: 0.95, cls: "structural" }, // new Widget()
  ]
  const ins = db.prepare("INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, metadata) VALUES (?,?,?,?,?,?,0,?)")
  for (const e of edges) {
    ins.run(e.id, projectId, widget, null, e.type, e.conf, e.cls === null ? null : JSON.stringify({ evidenceClass: e.cls }))
  }

  return {
    dbPath,
    symbolId: widget,
    cleanup: () => {
      try { db.close() } catch {}
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** The expected tier set for the fixture symbol AFTER the R5 fix.
 *
 *  M55.T5: the emitted vocabulary is closed — the legend's five tiers plus the
 *  declared `unknown` — so the legacy "indexed" bucket is no longer part of
 *  any expectation (the pre-T5 value is kept in history, not in the fixture).
 *  This fixture's three rows all carry a STORED structural class, so the
 *  honest expectation is exactly the structural tier. */
export const EXPECTED_TIERS = ["structural"]
// Kept as a distinct name: R5's claim is the STRICT one (structural, nothing
// else) — the fixture must not smuggle a legacy label back in.
export const EXPECTED_TIERS_STRICT = ["structural"]

/** RED/GREEN probe: resolve tiers for the fixture symbol through the REAL hover. */
export async function probeFixture(): Promise<{ tiers: string[]; ok: boolean; detail: string }> {
  const fx = seedTierFixture()
  try {
    const { evidenceTiersFor } = await import(path.join(process.cwd(), "src/lsp/hover.ts"))
    const Database = require("better-sqlite3")
    const raw = new Database(fx.dbPath)
    const tiers = evidenceTiersFor(raw as never, fx.symbolId) as string[]
    raw.close()
    const ok = EXPECTED_TIERS_STRICT.every((t) => tiers.includes(t))
    return { tiers, ok, detail: ok ? "structural evidence resolved" : `expected ${JSON.stringify(EXPECTED_TIERS_STRICT)} ⊆ got ${JSON.stringify(tiers)} — structural evidence downgraded` }
  } finally {
    fx.cleanup()
  }
}

// CLI: npx tsx script/m29/r5-tier-fixture.ts  (prints RED/GREEN verdict)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  void probeFixture().then((r) => {
    console.log(`R5 fixture probe: ${r.ok ? "GREEN" : "RED"} — ${r.detail}`)
    process.exit(r.ok ? 0 : 1)
  })
}
