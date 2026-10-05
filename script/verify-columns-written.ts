/**
 * Does any column exist that nothing ever writes?
 *
 * Found in the wild: `brain_index_status.total_relationships` was declared
 * `NOT NULL DEFAULT 0` and never written by any code path. It sat at 0 for every
 * project while the table held the real relationships — and because its
 * neighbours `total_files` and `total_symbols` WERE correct, the row looked
 * trustworthy. `verify-schema.ts` passed throughout: it checks that tables and
 * indexes exist, not that each column receives a value.
 *
 * This is a coarse, source-level audit, not a proof. It cannot see values written
 * by SQL assembled at runtime, and a column legitimately left at its default
 * (an audit flag nobody sets yet) will be reported. The point is to make the
 * class visible, so each hit is reviewed rather than trusted.
 */

import { readdirSync, readFileSync, existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const SRC = path.join(ROOT, "src")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

const sources = walk(SRC)

// Schema declaration files — excluded from the write-search (see below).
const DDL = path.join(SRC, "brain", "schema-ddl.ts")
const ORM = path.join(SRC, "brain", "brain.sql.ts")


/**
 * Strip comments before searching.
 *
 * The first version of this audit searched raw source and gave a FALSE PASS on
 * the exact bug it was written for: the fix's own explanatory comments all
 * mention `total_relationships`, so "the column appears in database.ts" was
 * satisfied by prose about writing it rather than by a statement that writes it.
 * A negative test — reverting the fix and re-running — still passed, which is
 * how that was caught.
 *
 * Both comment syntaxes are stripped: `// ...` and block comments. Block comments
 * are removed first so a `//` inside them does not confuse the line pass.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s\/\/.*$/gm, " ")
}

const corpus = sources
  // EXCLUDE the schema declarations themselves. Two earlier versions of this
  // audit passed for the wrong reason: brain.sql.ts contains
  // `total_relationships: integer().notNull().default(0)`, which the
  // `col:` branch of the matcher happily accepts — so the audit was validating
  // the schema against ITSELF and reporting PASS whether or not any writer
  // existed. A column is only "written" if a NON-schema file writes it.
  .filter((f) => f !== DDL && f !== ORM)
  .map((f) => ({ f, s: stripComments(readFileSync(f, "utf8")) }))

// Pull column names out of the two schema declarations.
const columns = new Map<string, string>() // column -> declaring file
for (const f of [DDL, ORM]) {
  if (!existsSync(f)) continue
  const src = readFileSync(f, "utf8")
  // CREATE TABLE ... ( <cols> )  — capture each indented column definition line.
  for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
    for (const line of m[2].split("\n")) {
      const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+(INTEGER|TEXT|REAL|BLOB)/i)
      if (c) columns.set(c[1], `${path.basename(f)}:${m[1]}`)
    }
  }
  // drizzle: `  someColumn: integer()...`
  for (const m of src.matchAll(/^\s{2}([a-z][a-z0-9_]*)\s*:\s*(?:integer|text|real)\(/gm)) {
    columns.set(m[1], `${path.basename(f)} (drizzle)`)
  }
}

console.log(`auditing ${columns.size} declared columns against ${sources.length} source files\n`)

const unwritten: Array<[string, string]> = []
for (const [col, declaredIn] of columns) {
  // A column is "written" if some source names it alongside an INSERT/UPDATE,
  // or passes it as a named property. Searching for the bare identifier is
  // coarse on purpose — a false positive costs one review, a false negative
  // costs a silently-wrong column.
  const hits = corpus.filter(({ s }) => s.includes(col))
  const plausiblyWritten = hits.some(({ s }) => {
    const re = new RegExp(
      `(INSERT|UPDATE)[^;]{0,400}\\b${col}\\b|\\b${col}\\s*:|\\b${col}\\b\\s*[,)]\\s*(//.*)?$|\\bSET\\b[^;]{0,200}\\b${col}\\b`,
      "i",
    )
    return re.test(s)
  })
  if (!plausiblyWritten) unwritten.push([col, declaredIn])
}

if (unwritten.length === 0) {
  console.log("PASS — every declared column is written by at least one non-schema statement")
} else {
  console.log(`${unwritten.length} column(s) declared but never found in a write statement:`)
  for (const [col, where] of unwritten) console.log(`  ${col.padEnd(30)} ${where}`)

  // Triage, so the list is actionable rather than a wall of names.
  //
  // brain_query_cache is the notable one: none of its columns are written, and
  // the only statements that touch the table are DELETE (on reindex and on
  // project removal). So it is allocated, never populated, and cleared — a cache
  // with no cache in it, where every read can only miss.
  const cacheCols = unwritten.filter(([, w]) => w.includes("brain_query_cache"))
  if (cacheCols.length >= 5) {
    console.log(`\n  NOTE: all ${cacheCols.length} brain_query_cache columns are unwritten, and the only`)
    console.log("        statements touching that table are DELETE (reindex + project removal).")
    console.log("        The cache is allocated and cleared but never populated.")
    console.log("        Either a writer is missing, or the table is dead weight to drop.")
  }
  console.log("\n  Remaining hits are columns left at their default by design, unless one")
  console.log("  was meant to hold a count — which would be a silent bug of the same")
  console.log("  class as brain_index_status.total_relationships.")
}
