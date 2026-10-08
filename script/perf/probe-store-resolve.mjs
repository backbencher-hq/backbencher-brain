// probe-store-resolve.mjs — cost of the PER-RELATIONSHIP target resolution that
// storeResults runs inside the store phase.
//
// Run: node script/perf/probe-store-resolve.mjs <brain.db> <projectId>
//
// storeResults resolves every relationship's target with ONE prepared statement
// per relationship (`resolveTargetStmt`), shaped
//
//   SELECT s.id, s.file_id, f.language FROM brain_symbol s
//   LEFT JOIN brain_file f ON f.id = s.file_id
//   WHERE s.project_id = ? AND s.name = ?
//   ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC,
//            (f.language = ?) DESC, s.id
//   LIMIT 1
//
// The WHERE is index-served (brain_sym_proj_name_idx), so reaching the candidate
// rows is O(log n). The ORDER BY cannot use that index, so SQLite must read
// every candidate for that NAME and sort them to find the winner — and the
// number of candidates for a name grows with the project. So the cost of ONE
// lookup grows with N, and the store phase issues one per relationship.
//
// This probe measures that directly against a real index: it replays the same
// statement over every distinct (target_external, source-language) pair and
// scales by each pair's relationship multiplicity, which is what the store
// phase actually pays. It reads a COPY, so a measurement artifact is never
// mutated.
//
// A probe, not a gate: it prints, it does not assert.

import Database from "better-sqlite3"
import { copyFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const dbPath = process.argv[2]
const projectId = process.argv[3]
if (!dbPath || !projectId) {
  console.error("usage: probe-store-resolve.mjs <brain.db> <projectId>")
  process.exit(2)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-probe-store-"))
const copy = path.join(tmp, "brain.db")
copyFileSync(dbPath, copy)
const db = new Database(copy)

const stmt = db.prepare(
  `SELECT s.id, s.file_id, f.language FROM brain_symbol s
   LEFT JOIN brain_file f ON f.id = s.file_id
   WHERE s.project_id = ? AND s.name = ?
   ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC,
            (f.language = ?) DESC, s.id
   LIMIT 1`,
)

// Distinct (target_external, source-language) pairs with their relationship
// multiplicity — the unit storeResults can share work on, and the unit this
// probe times once and then scales.
const pairs = db
  .prepare(
    `SELECT r.target_external AS n, COALESCE(f.language, '') AS lang, COUNT(*) AS c
     FROM brain_relationship r
     LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
     LEFT JOIN brain_file f ON f.id = s.file_id
     WHERE r.project_id = ? AND r.target_external IS NOT NULL
     GROUP BY r.target_external, lang`,
  )
  .all(projectId)

const perLookup = []
let lookups = 0
let hits = 0
const t1 = process.hrtime.bigint()
for (const p of pairs) {
  const a = process.hrtime.bigint()
  const row = stmt.get(projectId, p.n, p.n, p.lang)
  const b = process.hrtime.bigint()
  perLookup.push(Number(b - a) / 1e6)
  if (row) hits++
  lookups += p.c
}
const elapsedMs = Number(process.hrtime.bigint() - t1) / 1e6

perLookup.sort((x, y) => x - y)
const pct = (q) => perLookup[Math.min(perLookup.length - 1, Math.floor(perLookup.length * q))]

const cands = db
  .prepare(
    `SELECT AVG(k) a, MAX(k) m FROM (
       SELECT COUNT(*) k FROM brain_symbol WHERE project_id = ? GROUP BY name)`,
  )
  .get(projectId)

console.log(
  JSON.stringify(
    {
      db: path.basename(path.dirname(dbPath)),
      distinctNameLangPairs: pairs.length,
      lookupsProductionIssues: lookups,
      hits,
      wallMsOneEach: Math.round(elapsedMs),
      // Production issues one statement per RELATIONSHIP, so the replayed cost
      // scales by the mean multiplicity. This is the store-phase term.
      extrapolatedStoreResolveMs: Math.round((elapsedMs / pairs.length) * lookups),
      perLookupMs: {
        p50: +pct(0.5).toFixed(4),
        p90: +pct(0.9).toFixed(4),
        p99: +pct(0.99).toFixed(4),
        max: +perLookup[perLookup.length - 1].toFixed(4),
      },
      candidatesPerName: { avg: +cands.a.toFixed(2), max: cands.m },
    },
    null,
    1,
  ),
)

db.close()
rmSync(tmp, { recursive: true, force: true })
