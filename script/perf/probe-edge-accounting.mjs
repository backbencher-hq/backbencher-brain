// probe-edge-accounting.mjs — emitted vs stored relationships, per pool.
//
// Run: node script/perf/probe-edge-accounting.mjs <brain.db>
//
// The store's relationship id is
//
//   `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
//
// inserted with INSERT OR IGNORE. When `sourceId` is null — the
// unresolved-caller case — that id contains NO file identity, so two files
// emitting `imports fs:existsSync` on line 25 produce the SAME id and the
// second row is silently ignored. A stored row count cannot show this: the
// dropped rows are gone.
//
// This probe measures it from the other side. It reads the per-file
// relationship counts the store phase already logs ([STORE] <file>: Ns Mr),
// which are the ANALYZER's emission counts (`result.relationships.length`),
// sums them, and compares against the rows the table actually holds. The
// `emitted` column is what the analyzers produced; `stored` is what survived;
// the difference is edges the id scheme merged away.
//
// A probe, not a gate: it prints, it does not assert.

import Database from "better-sqlite3"
import { readFileSync } from "fs"
import { basename, dirname } from "path"

const dbPath = process.argv[2]
const logPath = process.argv[3]
if (!dbPath || !logPath) {
  console.error("usage: probe-edge-accounting.mjs <brain.db> <index.log>")
  process.exit(2)
}

const db = new Database(dbPath, { readonly: true })
const stored = db.prepare(`SELECT COUNT(*) c FROM brain_relationship`).get().c
const storedNullSrc = db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL`).get().c

// `[STORE] t0043_config.ts: 13s 52r` — `13s` is the SYMBOL count and `52r`
// the RELATIONSHIP count (the format is `${symCount}s ${relCount}r`). Only
// files above the log threshold appear, so this is a LOWER BOUND on emissions,
// which is stated in the output rather than glossed.
const log = readFileSync(logPath, "utf8")
let emitted = 0
let loggedFiles = 0
const perFile = []
for (const m of log.matchAll(/\[STORE\] (\S+): (\d+)s (\d+)r/g)) {
  emitted += Number(m[3])
  loggedFiles++
  perFile.push({ file: m[1], syms: Number(m[2]), rels: Number(m[3]) })
}

const indexedFiles = db.prepare(`SELECT COUNT(*) c FROM brain_file`).get().c

console.log(
  JSON.stringify(
    {
      db: basename(dirname(dbPath)),
      indexedFiles,
      loggedFiles,
      emittedByLoggedFiles: emitted,
      storedRelationships: stored,
      // Only a lower bound: the store logs a file only when relCount > 50 or
      // symCount > 20, so small files' emissions are absent from the sum.
      storedMinusLoggedEmissions: stored - emitted,
      storedNullSource: storedNullSrc,
      byKind: Object.fromEntries(
        db.prepare(`SELECT relationship_type k, COUNT(*) c FROM brain_relationship GROUP BY k ORDER BY k`).all().map((r) => [r.k, r.c]),
      ),
      nullSourceByKind: Object.fromEntries(
        db
          .prepare(`SELECT relationship_type k, COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL GROUP BY k ORDER BY k`)
          .all()
          .map((r) => [r.k, r.c]),
      ),
      topLoggedByRels: perFile.sort((a, b) => b.rels - a.rels).slice(0, 5),
    },
    null,
    1,
  ),
)
db.close()
