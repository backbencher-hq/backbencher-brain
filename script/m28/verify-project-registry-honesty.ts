#!/usr/bin/env tsx
// M28.A8 — AN UNREADABLE INDEX MUST NOT BE REPORTED AS AN EMPTY PROJECT.
//
// THE DEFECT (measured 2026-10-06). `listProjects` caught every error from
// reading a database and then pushed an entry with `files = 0, symbols = 0`,
// which `bb projects` rendered as `0 files 0 syms` — indistinguishable from a
// project that was genuinely indexed and genuinely holds nothing. Twelve lines
// above that catch, the same file said "never show a fabricated zero". The
// measurement: 536 projects listed as `0 files 0 syms`, of which 530 (99%)
// were databases the reader could not open at all.
//
// WHY A FIXTURE IS NEEDED. On this machine the tool's own better-sqlite3
// bundles SQLite 3.49.2, which CAN read every index under ~/.bb — so the
// defective path never fires here and a naive test would pass against the
// defect. This gate therefore builds a database that the RUNNING client cannot
// load, by writing a syntactically invalid trigger body straight into
// sqlite_master, and then requires the listing to say so.
//
// §8.3: if the fixture cannot be constructed the leg is `blocked` with its
// reason, never a pass.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const dataDir = mkdtempSync(path.join(tmpdir(), "bb-registry-"))
const projDir = path.join(dataDir, "projects")

// Two sha1-shaped ids, so both go through the same directory scan.
const BROKEN = "0".repeat(40)
const EMPTY = "1".repeat(40)
mkdirSync(path.join(projDir, BROKEN), { recursive: true })
mkdirSync(path.join(projDir, EMPTY), { recursive: true })

const { default: Database } = await import("better-sqlite3")

// --- fixture 1: a database file the client cannot load ----------------------
// A brain.db that is not a SQLite database. `listProjects` only requires the
// file to EXIST, so this reaches the same code path a corrupt schema does: the
// handle opens lazily and the first query throws. Used instead of a
// hand-corrupted sqlite_master because `writable_schema` is refused by this
// better-sqlite3 build ("table sqlite_master may not be modified"), and a
// fixture leaning on SQLite internals is a fixture that breaks silently.
const brokenPath = path.join(projDir, BROKEN, "brain.db")
writeFileSync(brokenPath, "this is not a sqlite database\n")

// --- fixture 2: a genuinely readable but genuinely EMPTY index --------------
const emptyPath = path.join(projDir, EMPTY, "brain.db")
{
  const db = new Database(emptyPath)
  db.exec("CREATE TABLE brain_symbol (id TEXT PRIMARY KEY, name TEXT)")
  db.exec("CREATE TABLE brain_file (id TEXT PRIMARY KEY, path TEXT)")
  db.exec("CREATE TABLE brain_index_status (project_id TEXT, total_files INT, total_symbols INT, time_updated INT, status TEXT)")
  db.close()
}

// --- the precondition, stated so a silent no-op cannot pass ------------------
{
  const db = new Database(brokenPath, { readonly: true })
  let threw = false
  try {
    db.prepare("SELECT COUNT(*) c FROM brain_symbol").get()
  } catch {
    threw = true
  }
  db.close()
  check("the fixture is genuinely unreadable by THIS client", threw, threw ? "the broken fixture refuses to open, as intended" : "the fixture is readable — it would not test anything")
}

process.env.BB_DATA_DIR = dataDir
const { listProjects } = await import(path.join(ROOT, "src", "ast", "project-registry"))
const entries = listProjects()
const byId = new Map(entries.map((e) => [e.id, e]))
const broken = byId.get(BROKEN)
const empty = byId.get(EMPTY)

check("both fixture projects are listed", entries.length === 2, `${entries.length} listed`)
check(
  "an unreadable database is reported as unreadable, not as 0 files 0 syms",
  broken?.unreadable !== null && broken?.unreadable !== undefined,
  broken === undefined ? "the broken fixture is missing from the listing" : `unreadable=${JSON.stringify(broken.unreadable)}`,
)
check(
  "a readable but EMPTY database is still reported as 0 files 0 syms",
  empty !== undefined && empty.unreadable === null && empty.files === 0 && empty.symbols === 0,
  empty === undefined ? "the empty fixture is missing" : `unreadable=${JSON.stringify(empty.unreadable)} files=${empty.files} symbols=${empty.symbols}`,
)
check(
  "the two are distinguishable — this is the property the defect destroyed",
  (broken?.unreadable ?? null) !== (empty?.unreadable ?? null),
  `broken.unreadable=${JSON.stringify(broken?.unreadable ?? null)} vs empty.unreadable=${JSON.stringify(empty?.unreadable ?? null)}`,
)

// --- RED PROOF: without the carried reason, the two rows are identical -------
const asRendered = (e: { files: number; symbols: number; unreadable: string | null } | undefined) =>
  e === undefined ? "missing" : e.unreadable ? `UNREADABLE (${e.unreadable})` : `${e.files} files ${e.symbols} syms`
check(
  "the rendered rows differ (the defect rendered both as '0 files 0 syms')",
  asRendered(broken) !== asRendered(empty),
  `broken -> ${asRendered(broken).slice(0, 60)} | empty -> ${asRendered(empty).slice(0, 60)}`,
)

rmSync(dataDir, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok).length
console.log(`\nREGISTRY HONESTY: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)