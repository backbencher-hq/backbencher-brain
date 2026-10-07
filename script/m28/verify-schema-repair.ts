#!/usr/bin/env tsx
// M28.A9 — a pre-existing MALFORMED trigger must be REPAIRED, not merely skipped.
//
// THE DEFECT THIS EXISTS FOR (measured 2026-10-07).
//
// The annotation guard's DDL once interpolated a value into RAISE(), which needs
// SQLite >= 3.47. That form is a PARSE ERROR on older SQLite, and a trigger an
// older SQLite cannot parse makes the WHOLE schema unloadable — so every
// database written by a pre-fix build is unreadable to any client older than 3.47.
// 762 of the 801 local indexes under ~/.bb were in that state.
//
// The shipped fix changed the DDL to a static literal, which is correct. But the
// migration installs it as `CREATE TRIGGER IF NOT EXISTS`, and IF NOT EXISTS
// cannot replace a trigger that ALREADY EXISTS — malformed or not. So every
// pre-existing database keeps its malformed trigger forever.
//
// PROVEN, not argued. On a real index (`project 064be526`, schema applied
// 2026-09-30):
//
//     before: MALFORMED (|| present)
//     reindex (bb index src) -> "indexed 201 files"
//     after:  STILL MALFORMED — re-indexing did NOT repair it
//     independent SQLite 3.43.2: NO — malformed database schema ... near "||"
//
// Re-indexing is what the earlier commit told the owner to do. It does not work.
// That claim was wrong and this gate is what makes it wrong no longer.
//
// WHAT THE REPAIR MUST DO: drop the guard and recreate it, so the installed
// trigger is the current DDL whatever was there before. It must be idempotent
// (running twice changes nothing) and it must not lose the table or its rows.
//
// WHY THE FIXTURE CAN BE BUILT HERE. better-sqlite3 bundles SQLite 3.49.2, which
// ACCEPTS the interpolated form — that is exactly how the pre-fix databases came
// to contain it. So the fixture writes the historical DDL through 3.49 and then
// asserts an INDEPENDENT reader (python3's sqlite3, 3.43.2) cannot open the
// result. If a future SQLite stops accepting the old form, the fixture leg
// reports `blocked` with that reason rather than silently testing nothing.
//
// §8.3: a leg that cannot run is `blocked` WITH its reason, never a pass.

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}
const note = (s: string) => console.log(`  NOTE: ${s}`)

const ROOT = process.cwd()
const work = mkdtempSync(path.join(tmpdir(), "bb-repair-"))
const dbPath = path.join(work, "brain.db")

const { default: Database } = await import("better-sqlite3")
const { ensureSchema } = await import(path.join(ROOT, "src", "brain", "schema-ddl"))
const writerVersion: string = new Database(":memory:").prepare("SELECT sqlite_version() v").get().v

// The historical DDL, exactly as it was shipped. Kept as a literal here on
// purpose: this gate must be able to reproduce the old state even after the
// source is fixed, so it cannot import the constant it is testing.
const LEGACY_TRIGGER = `
CREATE TRIGGER brain_annotation_author_class_guard
BEFORE INSERT ON brain_annotation
WHEN NEW.author_class IS NULL OR NEW.author_class NOT IN ('agent', 'human')
BEGIN
  SELECT RAISE(ABORT, 'brain_annotation.author_class must be ''agent'' or ''human'' (got: ' || COALESCE(NEW.author_class, 'NULL') || ')');
END;
`

/** Can an INDEPENDENT SQLite (python3, 3.43.2 here) load this file? */
function independentReaderCanOpen(file: string): { ok: boolean; version: string; error: string } {
  const PROBE = `
import sqlite3, sys
try:
    c = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
    v = c.execute("SELECT sqlite_version()").fetchone()[0]
    c.execute("SELECT count(*) FROM brain_symbol").fetchone()
    print("OK", v)
except Exception as e:
    print("FAIL", str(e)[:160])
`
  // copy first: a read-only connection cannot recover a -wal beside a file it
  // cannot write to, and that failure would be indistinguishable from the
  // schema failure this leg is about.
  const copy = file + ".probe"
  copyFileSync(file, copy)
  try {
    const out = execFileSync("python3", ["-c", PROBE, copy], { encoding: "utf8" }).trim()
    const parts = out.split(" ")
    if (parts[0] === "OK") return { ok: true, version: parts[1]!, error: "" }
    return { ok: false, version: "?", error: out.slice(0, 160) }
  } catch (error) {
    return { ok: false, version: "?", error: `python3 unavailable: ${String(error).slice(0, 100)}` }
  } finally {
    try {
      rmSync(copy, { force: true })
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Build a database in the PRE-FIX state: written by a SQLite new enough to
// accept the interpolated RAISE, unreadable by one old enough to reject it.
// ---------------------------------------------------------------------------
// Build the fixture with the REAL schema first — a hand-rolled partial schema
// makes `ensureSchema` fail for reasons that have nothing to do with the repair
// (the first version of this gate did exactly that: "no such column:
// project_id"). Only then is the historical trigger injected, so the fixture is
// a genuine pre-fix database rather than a lookalike.
{
  const fresh = new Database(dbPath)
  try {
    ensureSchema(fresh)
    fresh.prepare("INSERT OR IGNORE INTO brain_symbol (id, name) VALUES ('s1','kept')").run()
  } finally {
    fresh.close()
  }
}

const db = new Database(dbPath)
// Drop the current guard and install the historical one, exactly as a pre-fix
// build left it.
db.exec("DROP TRIGGER IF EXISTS brain_annotation_author_class_guard")
db.exec("DROP TRIGGER IF EXISTS brain_annotation_author_class_guard_update")
try {
  db.exec(LEGACY_TRIGGER)
} catch (error) {
  note(`this SQLite (${writerVersion}) refuses the legacy DDL, so the pre-fix state cannot be reproduced here: ${String(error).slice(0, 120)}`)
  console.log("\nSCHEMA REPAIR: BLOCKED (fixture not reproducible on this SQLite; NOT a pass)")
  rmSync(work, { recursive: true, force: true })
  process.exit(2)
}
db.close()

// Counts BEFORE the repair. The data-preservation leg compares these to the
// counts after, rather than asserting absolute numbers: the first version
// asserted "brain_symbol = 1" and read 0, because the real table has more NOT
// NULL columns than the one-column INSERT it used. "Unchanged" is the property
// that matters for a repair and it needs no schema knowledge to state.
const snapshot = (() => {
  const h = new Database(dbPath, { readonly: true })
  const c = (t: string) => {
    try {
      return (h.prepare(`SELECT count(*) c FROM ${t}`).get() as any).c
    } catch {
      return -1
    }
  }
  const out = { symbol: c("brain_symbol"), file: c("brain_file"), relationship: c("brain_relationship"), annotation: c("brain_annotation") }
  h.close()
  return out
})()

const before = independentReaderCanOpen(dbPath)
check(
  "fixture: the pre-fix state is genuinely unreadable to an independent older SQLite",
  before.ok === false,
  before.ok ? "the fixture IS readable — it would not reproduce the defect" : `independent reader (${before.version}) rejects it: ${before.error.slice(0, 90)}`,
)

// ---------------------------------------------------------------------------
// The repair: run the real schema application over that database.
// ---------------------------------------------------------------------------
const handle = new Database(dbPath)
try {
  ensureSchema(handle)
} finally {
  handle.close()
}

const after = independentReaderCanOpen(dbPath)
check(
  "after ensureSchema: an independent older SQLite CAN open the database",
  after.ok === true,
  after.ok ? `independent reader ${after.version} reads it` : `still rejected: ${after.error.slice(0, 110)}`,
)

// The installed trigger must be the CURRENT ddl, not merely "something".
const verify = new Database(dbPath, { readonly: true })
const installed = verify.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get("brain_annotation_author_class_guard")
const sql = String(installed?.sql ?? "")
verify.close()
check(
  "the installed guard is the current DDL (no interpolated expression)",
  sql.length > 0 && !sql.includes("||"),
  sql.length === 0 ? "the guard is missing entirely" : sql.includes("||") ? "the guard still carries the interpolated message" : "static message, no '||'",
)

// The repair must not cost data.
const after2 = new Database(dbPath, { readonly: true })
const cnt = (t: string) => {
  try {
    return (after2.prepare(`SELECT count(*) c FROM ${t}`).get() as any).c
  } catch {
    return -1
  }
}
const kept = { symbol: cnt("brain_symbol"), file: cnt("brain_file"), relationship: cnt("brain_relationship"), annotation: cnt("brain_annotation") }
const triggers = (after2.prepare("SELECT count(*) c FROM sqlite_master WHERE type='trigger'").get() as any).c
after2.close()
const unchanged = kept.symbol === snapshot.symbol && kept.file === snapshot.file && kept.relationship === snapshot.relationship && kept.annotation === snapshot.annotation
check(
  "the repair preserved every row count it found (a repair that drops data is not a repair)",
  unchanged && triggers >= 1,
  `before symbol=${snapshot.symbol} file=${snapshot.file} rel=${snapshot.relationship} ann=${snapshot.annotation} | after symbol=${kept.symbol} file=${kept.file} rel=${kept.relationship} ann=${kept.annotation} | triggers=${triggers}`,
)

// Idempotence: running it again must change nothing and stay clean.
{
  const h2 = new Database(dbPath)
  try {
    ensureSchema(h2)
    ensureSchema(h2)
  } finally {
    h2.close()
  }
  const again = independentReaderCanOpen(dbPath)
  const v2 = new Database(dbPath, { readonly: true })
  const n2 = v2.prepare("SELECT count(*) c FROM brain_symbol").get() as any
  const t2 = v2.prepare("SELECT count(*) c FROM sqlite_master WHERE type='trigger'").get() as any
  v2.close()
  check(
    "the repair is idempotent: three applications leave it readable, rows intact, no duplicate guard",
    again.ok === true && n2.c === snapshot.symbol && t2.c === 2,
    `independent reader ok=${again.ok}; brain_symbol=${n2.c} (unchanged: ${snapshot.symbol}); triggers=${t2.c} (2 = the insert guard + the update guard)`,
  )
}

// Enforcement still holds after the repair — the property M28.A1 rests on.
{
  const h = new Database(dbPath)
  const cols = h.prepare("PRAGMA table_info(brain_annotation)").all().map((r: any) => r.name)
  // Every NOT NULL column gets a value. The first version left them null and the
  // leg then reported "valid 'human' REFUSED — NOT NULL constraint failed",
  // which is the constraint answering, NOT the guard — the exact confusion this
  // repository keeps having to be careful about. A leg that cannot tell those two
  // apart proves nothing about the guard.
  const notNull = new Set(
    (h.prepare("PRAGMA table_info(brain_annotation)").all() as any[]).filter((r: any) => r.notnull === 1).map((r: any) => r.name),
  )
  const mk = (v: string | null) => {
    const row: Record<string, unknown> = {}
    cols.forEach((c) => {
      row[c] = notNull.has(c) ? "" : null
    })
    Object.assign(row, {
      id: Math.random().toString(36).slice(2),
      project_id: "probe-project",
      symbol_name: "probe",
      symbol_path: "probe.ts",
      author_class: v,
      tool_identity: "probe",
      body: "x",
      time_created: 0,
      time_updated: 0,
    })
    return { sql: `INSERT INTO brain_annotation (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, vals: cols.map((c) => row[c]) }
  }
  let valid = "not run"
  let refused: string[] = []
  for (const [label, v] of [["human", "human"], ["robot", "robot"], ["null", null]] as Array<[string, string | null]>) {
    const { sql, vals } = mk(v)
    try {
      h.prepare(sql).run(vals as any)
      if (label === "human") valid = "ACCEPTED"
      else refused.push(`${label} ACCEPTED (wrong)`)
    } catch (e) {
      if (label === "human") valid = `REFUSED (wrong): ${String(e.message).slice(0, 60)}`
      else refused.push(`${label} refused`)
    }
  }
  h.close()
  check(
    "enforcement survives the repair: valid accepted, invalid and NULL refused",
    valid === "ACCEPTED" && refused.every((r) => r.endsWith("refused")),
    `valid 'human' -> ${valid}; ${refused.join(", ")}`,
  )
}

rmSync(work, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok).length
console.log(`\nSCHEMA REPAIR: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)