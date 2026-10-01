/**
 * verify-override-retarget — the gate for the cross-file `overrides` retarget.
 *
 * ## Why this gate exists
 *
 * The retarget (src/ast/override-retarget.ts) does something unusual for this
 * codebase: it REWRITES relationship rows after they are stored, using project-wide
 * knowledge the analyzer could not have. That is exactly the kind of change that
 * can be quietly wrong — a wrong retarget is not a missing row, it is a confident
 * row pointing at the wrong parent, which is harder to notice than an absence and
 * worse to consume.
 *
 * So the properties that make it safe are asserted rather than assumed:
 *
 *   1. VERIFIED — a row is only ever re-pointed at an ancestor that provably
 *      DECLARES the method. Checked here by an independent walk, not by trusting
 *      the pass's own bookkeeping.
 *   2. NON-DESTRUCTIVE — a row whose method no ancestor declares is left exactly as
 *      it was. An unverifiable override must stay VISIBLE as declared suspicion, not
 *      be deleted: deleting it would convert "wrong" into "absent", which is the
 *      failure mode this whole program exists to prevent.
 *   3. NON-INVENTING — the pass creates no rows and raises no confidence. A
 *      retarget that changed a row count or a confidence value would be a second,
 *      undocumented contract.
 *   4. DEGRADING — a database with no persisted hierarchy is untouched, which is
 *      what every pre-SDJ-8 database looks like.
 *   5. NARROW — high-confidence `overrides` rows and every other relationship type
 *      are never touched.
 *
 * The fixtures below are synthetic and hand-checkable, which is the point: a
 * property that can be stated in one line of SQL should be, rather than asserted
 * only over a corpus where a failure would be hard to read.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { retargetCrossFileOverrides } from "../../src/ast/override-retarget"

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

type Row = { id: string; src: string; tgt: string; conf: number; type?: string }

/**
 * A tiny project that exercises every branch:
 *
 *   Base            declares `run`, `toText`
 *   Middle: Base    declares `extra`
 *   Leaf: Middle    overrides `run`   -> correct parent is Base (depth 2)
 *   Wide: Base      overrides `run`   -> correct parent is Base (depth 1)
 *   Orphan: Unknown overrides `ghost` -> NO ancestor declares it; must stay put
 *   Solo            overrides `run` with NO hierarchy; must stay put
 *
 * `Leaf` is the important one: its FIRST supertype is Middle, which does NOT declare
 * `run`. That is the exact shape of the measured defect, and it is why a name-based
 * resolver gets it wrong.
 */
function buildProject(): { db: Database; rows: Row[] } {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE brain_symbol (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, qualified_name TEXT,
      symbol_type TEXT, super_types TEXT
    );
    CREATE TABLE brain_relationship (
      id TEXT PRIMARY KEY, project_id TEXT, source_external TEXT, target_external TEXT,
      relationship_type TEXT, confidence REAL
    );
  `)
  const PID = "p"
  // `name` is the BARE name and `qualified_name` the dotted form, exactly as
  // parallel-indexer.ts stores them. An earlier draft of this fixture put the dotted
  // string in both columns; the retarget then correctly declined every row and the
  // gate reported a failure that was really the fixture lying about the schema.
  const sym = (qualifiedName: string, kind: string, sup: string[] | null) => {
    const dot = qualifiedName.lastIndexOf(".")
    const bare = dot > 0 ? qualifiedName.slice(dot + 1) : qualifiedName
    return db.prepare(`INSERT INTO brain_symbol VALUES (?,?,?,?,?,?)`)
      .run(`s:${qualifiedName}`, PID, bare, qualifiedName, kind, sup ? JSON.stringify(sup) : null)
  }
  const rel = (id: string, src: string, tgt: string, conf: number, type = "overrides") =>
    db.prepare(`INSERT INTO brain_relationship VALUES (?,?,?,?,?,?)`).run(id, PID, src, tgt, type, conf)

  sym("Base", "class", null)
  sym("Middle", "class", ["Base"])
  sym("Leaf", "class", ["Middle"])
  sym("Wide", "class", ["Base"])
  sym("Orphan", "class", ["Unknown"])
  sym("Solo", "class", null)
  sym("Base.run", "method", null)
  sym("Base.toText", "method", null)
  sym("Middle.extra", "method", null)

  // Leaf.run's first supertype is Middle, which does NOT declare `run` -> the defect shape
  rel("r1", "Leaf.run", "Middle.run", 0.5)
  rel("r2", "Wide.run", "Base.run", 0.5)      // already correct; must not move
  rel("r3", "Orphan.ghost", "Unknown.ghost", 0.5) // unverifiable; must stay
  rel("r4", "Solo.run", "Base.run", 0.5)     // no hierarchy for owner; must stay
  rel("r5", "Leaf.toText", "Middle.toText", 0.5) // depth-2, correct parent Base
  rel("r6", "Leaf.extra", "Middle.extra", 1.0)   // HIGH confidence; must not touch
  rel("r7", "Leaf.run", "Middle.run", 1.0, "calls") // wrong label; must not touch
  return { db, rows: [] }
}

const targets = (db: Database): Map<string, string> => {
  const m = new Map<string, string>()
  for (const r of db.prepare(`SELECT id, target_external FROM brain_relationship`).all() as any[]) {
    m.set(String(r.id), String(r.target_external))
  }
  return m
}

function main(): void {
  console.log("# verify-override-retarget\n")

  // ── 1. the retarget itself ────────────────────────────────────────────────
  const { db } = buildProject()
  const before = targets(db)
  const res = retargetCrossFileOverrides(db, "p")
  const after = targets(db)

  check("scans every low-confidence overrides row", res.scanned === 5, `scanned=${res.scanned} expected 5`)
  check("moves the depth-2 mis-parented row to the ancestor that DECLARES it",
    after.get("r1") === "Base.run", `${before.get("r1")} -> ${after.get("r1")}`)
  check("moves a second depth-2 row", after.get("r5") === "Base.toText", `${before.get("r5")} -> ${after.get("r5")}`)
  check("leaves an already-correct row alone", after.get("r2") === "Base.run", after.get("r2"))
  check("LEAVES AN UNVERIFIABLE ROW IN PLACE (does not delete it)", after.get("r3") === "Unknown.ghost", after.get("r3"))
  check("leaves a row whose owner has no hierarchy alone", after.get("r4") === "Base.run", after.get("r4"))
  // Two DIFFERENT non-resolutions, deliberately counted apart: `Orphan` has a
  // hierarchy but no ancestor declares `ghost` (unverifiable), while `Solo` has no
  // hierarchy at all. Collapsing them would hide the difference between "we looked
  // and found nothing" and "we had nothing to look at".
  check("counts unverifiable rows rather than dropping them", res.unverifiable === 1, `unverifiable=${res.unverifiable}`)
  check("counts owner-with-no-hierarchy separately", res.noHierarchy === 1, `noHierarchy=${res.noHierarchy}`)
  check("resolved exactly the rows whose ancestor declares the method", res.resolved === 3, `resolved=${res.resolved} expected 3`)

  // ── 2. non-inventing, non-touching ────────────────────────────────────────
  check("never touches a HIGH-confidence overrides row", after.get("r6") === "Middle.extra", after.get("r6"))
  check("never touches another relationship type", after.get("r7") === "Middle.run", after.get("r7"))

  const rowsNow = (db.prepare(`SELECT count(*) c FROM brain_relationship`).get() as any).c
  check("creates no rows", rowsNow === 7, `rows=${rowsNow} expected 7`)
  const confs = db.prepare(`SELECT DISTINCT confidence FROM brain_relationship ORDER BY confidence`).all() as any[]
  check("raises no confidence", confs.map((c) => c.confidence).join(",") === "0.5,1", confs.map((c) => c.confidence).join(","))

  // ── 3. independent verification of property 1 ─────────────────────────────
  // Re-derive, from the stored rows alone, that every moved row landed somewhere
  // that declares the method. This does not reuse the pass's own logic.
  const declares = new Map<string, Set<string>>()
  for (const r of db.prepare(`SELECT qualified_name FROM brain_symbol WHERE symbol_type='method'`).all() as any[]) {
    const qn = String(r.qualified_name)
    const dot = qn.lastIndexOf(".")
    const owner = qn.slice(0, dot)
    const m = qn.slice(dot + 1)
    if (!declares.has(owner)) declares.set(owner, new Set())
    declares.get(owner)!.add(m)
  }
  let allMovedValid = true
  for (const [id, tgt] of after) {
    if (before.get(id) === tgt) continue
    const dot = tgt.lastIndexOf(".")
    const ok = declares.get(tgt.slice(0, dot))?.has(tgt.slice(dot + 1)) ?? false
    if (!ok) allMovedValid = false
  }
  check("every re-pointed row lands on an ancestor that DECLARES the method (verified independently)", allMovedValid)
  db.close()

  // ── 4. degradation: no hierarchy anywhere ─────────────────────────────────
  const db2 = new Database(":memory:")
  db2.exec(`
    CREATE TABLE brain_symbol (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, qualified_name TEXT, symbol_type TEXT, super_types TEXT);
    CREATE TABLE brain_relationship (id TEXT PRIMARY KEY, project_id TEXT, source_external TEXT, target_external TEXT, relationship_type TEXT, confidence REAL);
  `)
  db2.prepare(`INSERT INTO brain_symbol VALUES ('s1','p','Base','Base','class',NULL)`).run()
  db2.prepare(`INSERT INTO brain_relationship VALUES ('r1','p','Leaf.run','Middle.run','overrides',0.5)`).run()
  const r2 = retargetCrossFileOverrides(db2, "p")
  const t2 = (db2.prepare(`SELECT target_external FROM brain_relationship`).get() as any).target_external
  check("a database with no persisted hierarchy is left untouched", r2.moved === 0 && t2 === "Middle.run", `moved=${r2.moved} target=${t2}`)

  // ── 5. an unknown project must not throw ─────────────────────────────────
  let threw = false
  try { retargetCrossFileOverrides(db2, "no-such-project") } catch { threw = true }
  check("an unknown project id is a no-op, not a throw", !threw)
  db2.close()

  console.log("")
  if (failures === 0) {
    console.log("all override-retarget properties hold")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main()