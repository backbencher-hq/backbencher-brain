#!/usr/bin/env tsx
/**
 * JAVASCRIPT (and every file-level lane) — the `<module>:<item>` import resolver,
 * run through its REAL entry point (`resolveImportTargets`) against a real
 * sqlite handle.
 *
 * ## What this pins, and why it needs a DB
 *
 * `planImportResolutions` is pure and independently testable, but the decision
 * that matters to a consumer has THREE steps and the arm has to cover all of
 * them, because each can silently disable the other two:
 *
 *   1. the EXPORT SURFACE is recovered from `exports` rows, whose only file
 *      evidence is `source_external` (an `exports` edge's source symbol is the
 *      module, which is not a symbol);
 *   2. the planner decides, and the path-spelling branch resolves the specifier
 *      from the IMPORTING file's own directory;
 *   3. the UPDATE writes `target_symbol_id`, guarded on it being NULL.
 *
 * MEASURED on the pinned JS draw before the two fixes this arm covers: 926 of
 * 1,202 `imports` rows were detached. 234 of them named an internal module whose
 * declaration is in the sample — a should-bind population declined because (a)
 * the export surface was recovered from a module BASENAME, and a path-spelling
 * lane's export rows matched no basename key, so the surface was EMPTY for every
 * file in the lane; and (b) the planner refused an ambiguous specifier because
 * "the row carries no importing file", which stopped being true when file-level
 * rows began carrying the project-relative path. After both fixes: 672 detached,
 * attached edges 5,381 → 5,622 on the same draw.
 *
 * ## Why the fixture is two files with the SAME basename
 *
 * Because that is the shape both defects are invisible to. `src/a/util.js` and
 * `src/b/util.js` both declare `helper`, both spell an import `./util.js:helper`,
 * and each importer's meaning is unambiguous — while the specifier STRING is
 * ambiguous project-wide. A fixture with one `util.js` would pass with either
 * strategy and would prove nothing about which one ran.
 *
 * ## The falsification case, stated as a case
 *
 * The fourth check runs the SAME fixture with basename-spelled export rows
 * (`source_external = "util"`). The item is still declared and still exported;
 * the only thing that changed is the spelling. The row must then FAIL to
 * resolve, which is what shows the export surface is load-bearing rather than a
 * formality — a suite that only asserted the success would pass on a resolver
 * that resolved everything.
 *
 * ## Run it with bun, not node
 *
 *   bun run script/m14/verify-import-resolution-path-spelling.ts
 *
 * `bun:sqlite` is the handle the real resolver takes, so `npx tsx` cannot load
 * this file (it fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on the `bun:` import
 * before a single assertion runs) — that is a property of the entry point under
 * test, not of the arm.
 *
 * Exit 0 when every property holds, 1 otherwise. No fixture, no corpus, no
 * indexer: a temp sqlite database built here and thrown away.
 */
import { Database } from "bun:sqlite"
import { resolveImportTargets } from "../../src/ast/import-resolution"

const PROJECT = "verify:path-spelling"

/** The four tables the resolver reads, with exactly the columns its SQL touches. */
function makeDb(): Database {
  const db = new Database(":memory:")
  db.run(`CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, relative_path TEXT)`)
  db.run(`CREATE TABLE brain_symbol (id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT)`)
  db.run(`CREATE TABLE brain_import (id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, import_path TEXT)`)
  db.run(`CREATE TABLE brain_relationship (
    id TEXT PRIMARY KEY, project_id TEXT,
    relationship_type TEXT, source_external TEXT, target_external TEXT,
    source_symbol_id TEXT, target_symbol_id TEXT, metadata TEXT,
    is_cross_file INTEGER NOT NULL DEFAULT 0)`)
  return db
}

interface Fixture {
  /** How the `exports` rows spell their file: the project-relative PATH, or a basename. */
  exportSpelling: "path" | "basename"
}

/**
 * `src/a/index.js` and `src/b/index.js` both `import { helper } from './util.js'`,
 * and there IS a `helper` in each importer's own `util.js`. One relationship row
 * names its importer as a PATH and one as a basename, so the two strategies are
 * measured against the same index rather than against two different fixtures.
 */
function build(f: Fixture): Database {
  const db = makeDb()
  const file = (id: string, p: string) => db.run(`INSERT INTO brain_file VALUES (?,?,?)`, [id, PROJECT, p])
  const sym = (id: string, fileId: string, name: string) => db.run(`INSERT INTO brain_symbol VALUES (?,?,?,?)`, [id, PROJECT, fileId, name])
  file("F:a/index", "src/a/index.js")
  file("F:b/index", "src/b/index.js")
  file("F:a/util", "src/a/util.js")
  file("F:b/util", "src/b/util.js")
  sym("S:a/helper", "F:a/util", "helper")
  sym("S:b/helper", "F:b/util", "helper")

  for (const [importer, specifier] of [["F:a/index", "./util.js"], ["F:b/index", "./util.js"]] as const) {
    db.run(`INSERT INTO brain_import VALUES (?,?,?,?)`, [`I:${importer}`, PROJECT, importer, specifier])
  }

  const exports: Array<[string, string, string]> = [
    ["F:a/util", "src/a/util.js", "S:a/helper"],
    ["F:b/util", "src/b/util.js", "S:b/helper"],
  ]
  for (const [fileId, path, symbolId] of exports) {
    const spelling = f.exportSpelling === "path" ? path : "util"
    db.run(
      `INSERT INTO brain_relationship VALUES (?,?,?,?,?,?,?,?,?)`,
      [`E:${symbolId}`, PROJECT, "exports", spelling, "helper", null, symbolId, JSON.stringify({ isDefault: false }), 0],
    )
  }

  const row = (id: string, src: string) =>
    db.run(
      `INSERT INTO brain_relationship VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, PROJECT, "imports", src, "./util.js:helper", null, null, null, 0],
    )
  row("R:path", "src/a/index.js") // the file-level spelling — importer-relative resolvable
  row("R:basename", "index") // the older spelling — nothing breaks the project-wide tie
  return db
}

const target = (db: Database, id: string): string | null =>
  (db.prepare(`SELECT target_symbol_id t FROM brain_relationship WHERE id = ?`).get(id) as any)?.t ?? null

const results: Array<{ ok: boolean; label: string; detail: string }> = []
const check = (ok: boolean, label: string, detail: string) => results.push({ ok, label, detail })

// ── 1–3: the path-spelled fixture ──────────────────────────────────────────
{
  const db = build({ exportSpelling: "path" })
  const out = resolveImportTargets(db as any, PROJECT)
  check(
    target(db, "R:path") === "S:a/helper",
    "a path-spelled row resolves in the directory of the file that wrote the specifier",
    `target_symbol_id=${target(db, "R:path") ?? "NULL"} (want S:a/helper), via importer-relative; the project-wide candidates for './util.js' are TWO files, so any other strategy has to refuse`,
  )
  check(
    target(db, "R:basename") === null,
    "a basename-spelled row is still refused on an ambiguous specifier — the fix is scoped, not a license to guess",
    `target_symbol_id=${target(db, "R:basename") ?? "NULL"} (want NULL); byReason=${JSON.stringify(out.byReason)}`,
  )
  check(
    out.resolved === 1 && out.scanned === 2,
    "the resolver reports what it did (one resolved of two scanned)",
    `scanned=${out.scanned} resolved=${out.resolved} byReason=${JSON.stringify(out.byReason)}`,
  )
}

// ── 4: the falsification case — same index, basename-spelled exports ───────
{
  const db = build({ exportSpelling: "basename" })
  resolveImportTargets(db as any, PROJECT)
  check(
    target(db, "R:path") === null,
    "FALSIFICATION: with the export surface spelled as a basename the SAME row does not resolve",
    `target_symbol_id=${target(db, "R:path") ?? "NULL"} (want NULL). The item is still declared and still exported; only the spelling of the exports row's source changed. A resolver that resolved this would be joining on something other than the target module's export surface.`,
  )
}

let failed = 0
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.label}`)
  else {
    failed++
    console.log(`FAIL  ${r.label}\n      ${r.detail}`)
  }
}
console.log(failed === 0 ? "\nall import-resolution path-spelling properties hold" : `\n${failed} of ${results.length} properties FAILED`)
process.exit(failed === 0 ? 0 : 1)
