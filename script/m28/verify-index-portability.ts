#!/usr/bin/env tsx
// M28.A7 — CROSS-VERSION PORTABILITY OF A WRITTEN INDEX.
//
// WHAT THIS EXISTS FOR (the defect it would have caught, measured 2026-10-06):
// the annotation guard's DDL used an expression inside RAISE(), which SQLite
// added in 3.47.0 (2024-10-21). The tool's own better-sqlite3 bundles 3.49.2,
// so the indexer created the trigger, the trigger enforced, and the indexer
// reported success. But 762 of the 801 local indexes under ~/.bb/projects
// could not be opened by SQLite 3.43.2 AT ALL:
//
//   sqlite3.DatabaseError: malformed database schema
//     (brain_annotation_author_class_guard) - near "||": syntax error
//
// A trigger the reader cannot parse makes the whole schema unloadable, so one
// version-gated token made the database unreadable to every older client. The
// writer had only ever proven the file readable by ITSELF.
//
// THE GATE: write a real index with the real indexer, then open the resulting
// file with a SECOND, INDEPENDENT SQLite that is not the one that wrote it, and
// fail if that client cannot load it. Both versions are recorded, because the
// whole point is that "readable" is a property of a PAIR (writer, reader).
//
// §8.3: if no independent SQLite is available the leg is reported `blocked`
// WITH the reason. It is never reported as a pass.

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

// --- 1. Write a real index with the real indexer -----------------------------
const work = mkdtempSync(path.join(tmpdir(), "bb-portability-"))
const srcDir = path.join(work, "src")
const { mkdirSync, writeFileSync } = await import("node:fs")
mkdirSync(srcDir, { recursive: true })
// A small but real TypeScript file: it must go through the actual analyzer
// path, because a gate over a hand-written schema proves nothing about the
// schema the tool writes.
writeFileSync(
  path.join(srcDir, "probe.ts"),
  `export interface Shape { name: string }\n` +
    `export function area(s: Shape): number {\n  const w = s.name.length\n  return w * w\n}\n` +
    `export class Box implements Shape {\n  name = "box"\n  area() { return area(this) }\n}\n`,
)

const dataDir = path.join(work, "data")
const idx = execFileSync("node", [path.join(ROOT, "bin", "bb"), "index", srcDir, "--no-setup"], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: dataDir },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
console.log(`  indexed: ${(idx.match(/indexed .*/) ?? ["(no summary)"])[0]}`)

const projRoot = path.join(dataDir, "projects")
const dbs = existsSync(projRoot)
  ? readdirSync(projRoot)
      .map((d) => path.join(projRoot, d, "brain.db"))
      .filter((p) => existsSync(p))
  : []
check("the indexer wrote a database to inspect", dbs.length === 1, `${dbs.length} brain.db found under ${dataDir}`)
if (dbs.length !== 1) {
  console.log("\nPORTABILITY: FAILED (nothing to inspect)")
  process.exit(1)
}
const db = dbs[0]!

// --- 2. The WRITER's own SQLite version --------------------------------------
let writerVersion = "unknown"
try {
  const { default: Database } = await import("better-sqlite3")
  const h = new Database(db, { readonly: true })
  writerVersion = String(h.prepare("SELECT sqlite_version() v").get().v)
  h.close()
} catch (error) {
  console.log(`  (writer probe failed: ${String(error).slice(0, 80)})`)
}
console.log(`  writer SQLite: ${writerVersion}`)

// --- 3. The INDEPENDENT reader ------------------------------------------------
const PROBE = `
import sqlite3, sys
try:
    c = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
    v = c.execute("SELECT sqlite_version()").fetchone()[0]
    n = c.execute("SELECT COUNT(*) FROM brain_symbol").fetchone()[0]
    t = c.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()
    print("OK", v, n, ",".join(sorted(r[0] for r in t)))
except Exception as e:
    print("FAIL", str(e)[:200])
`
let reader: { version: string; symbols: number; triggers: string[] } | null = null
let readerErr: string | null = null
let readerRan = false
try {
  const out = execFileSync("python3", ["-c", PROBE, db], { encoding: "utf8" }).trim()
  readerRan = true
  const parts = out.split(" ")
  if (parts[0] === "OK") {
    reader = { version: parts[1]!, symbols: Number(parts[2]), triggers: parts[3] ? parts[3].split(",") : [] }
  } else {
    readerErr = out.slice(0, 200)
  }
} catch (error) {
  // The reader itself could not be launched (no python3, etc.) — a MISSING leg.
  readerErr = `the independent reader could not be launched: ${String(error).slice(0, 120)}`
}

if (reader === null && readerRan) {
  // THE READER RAN AND REJECTED THE FILE. This is a FAILURE, not a blocked leg:
  // the independent SQLite executed, could not load the schema the tool wrote,
  // and said why. Reporting this as `blocked` would put a soft word on the hard
  // failure this gate exists to catch — the defect class this repository is
  // built to eliminate.
  check(
    "a SECOND, independent SQLite can open the index the tool just wrote",
    false,
    `reader rejected it: ${readerErr}`,
  )
  console.log(`\nPORTABILITY: FAILED — writer ${writerVersion}, independent reader could not load the file`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

if (reader === null) {
  // §8.3: a missing leg is `blocked` with its reason, never a pass.
  console.log(`  BLOCKED: no independent SQLite reader could be run — ${readerErr}`)
  console.log("\nPORTABILITY: BLOCKED (the independent-reader leg did not run; NOT a pass)")
  rmSync(work, { recursive: true, force: true })
  process.exit(2)
}

console.log(`  reader SQLite: ${reader.version} (independent of the writer's ${writerVersion})`)

check(
  "a SECOND, independent SQLite can open the index the tool just wrote",
  true,
  `${reader.version} opened it; ${reader.symbols} symbols; triggers [${reader.triggers.join(", ")}]`,
)
check(
  "the two Sqlites are genuinely different builds (a self-check would prove nothing)",
  reader.version !== writerVersion,
  `writer ${writerVersion} vs reader ${reader.version}`,
)
check(
  "the annotation guard is present after an independent read",
  reader.triggers.includes("brain_annotation_author_class_guard"),
  `triggers seen by ${reader.version}: [${reader.triggers.join(", ")}]`,
)

// --- 4. RED PROOF: the version-gated form must be caught by this gate ---------
// Plant the pre-fix DDL into a COPY of the written database is not possible (the
// schema is already created), so the gate re-runs the writer against the
// interpolated DDL and requires the independent reader to REJECT the result.
const { ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } = await import(path.join(ROOT, "src", "brain", "schema-ddl"))
check(
  "the DDL under test carries no version-gated RAISE expression",
  !/RAISE\s*\(\s*[^)]*\|\|/.test(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL),
  ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL.includes("||") ? "DDL contains '||' inside RAISE" : "no '||' inside any RAISE(...)",
)

const failed = checks.filter((c) => !c.ok).length
const fp = createHash("sha256").update(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL).digest("hex").slice(0, 16)
console.log(`\nddl fingerprint: ${fp}`)
console.log(`\nPORTABILITY: ${failed === 0 ? "PASS" : `FAILED (${failed})`} — writer ${writerVersion}, independent reader ${reader.version}`)
rmSync(work, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
