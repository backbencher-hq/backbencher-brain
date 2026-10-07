/**
 * INCOMING_RUST — the INCOMING/OUTGOING measurement, at the level the question
 * is actually asked.
 *
 * ## THE QUESTION
 *
 * Every number this lane has produced is OUTGOING: an analyzer reads ONE file
 * and publishes edges from the symbols it found there. "Who points AT me" is a
 * different question, and the difference is not a matter of bookkeeping — it is
 * decided by whether the stored row has an id on the far end.
 *
 * `brain_relationship` stores ONE row per edge with `source_symbol_id` and
 * `target_symbol_id`. The graph engine traverses both directions off that one row
 * (`graph-engine.ts`: the callers arm joins `brain_symbol s ON s.id =
 * r.source_symbol_id` and cascades on `r.target_symbol_id`; the callees arm
 * swaps the two). So an incoming answer needs `target_symbol_id`, and a row
 * whose target did not resolve carries only `target_external` — the NAME the
 * store saw, which is not an identity. That row is an outgoing fact and nothing
 * else: nothing can ask what points at it.
 *
 * So the honest statement of this lane is a NUMBER: of the edges rust publishes,
 * how many can be traversed from the far end?
 *
 * ## HOW IT IS MEASURED
 *
 * Through the production indexer (`indexProjectParallel`) over the pinned corpus,
 * then SQL over `brain_relationship` — not over the analyzer's in-memory output,
 * because in-file resolution and project-wide resolution are different questions
 * and only the second one decides the incoming side. Per relationship type:
 *
 *   both      source_symbol_id AND target_symbol_id resolved — traversable from
 *             BOTH ends
 *   out-only  source resolved, target NULL (target_external set) — an outgoing
 *             fact with no far end
 *   in-only   target resolved, source NULL (source_external set)
 *   neither   both external
 *
 * ## NO REGEX
 * Tree walks and SQL only; the corpus file list comes from `git ls-files` and a
 * `.rs` suffix test.
 *
 * Usage: bun script/lanes/incoming-rust/direction.ts [corpusDir] [corpusName]
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, mkdirSync, cpSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const corpusName = process.argv[2] ?? "ripgrep"
const corpusDir = path.resolve(process.argv[3] ?? path.join(CR, corpusName))

// The DB lives under the project's data dir; keep the run out of the user's
// home by pointing HOME at a scratch directory for this process.
const scratch = mkdtempSync(path.join(tmpdir(), "incoming-rust-dir-"))
const dataHome = path.join(scratch, "home")
mkdirSync(dataHome, { recursive: true })
process.env.HOME = dataHome
process.env.BB_DATA_DIR = path.join(dataHome, ".backbencher-brain")

const src = path.join(corpusDir)
const work = path.join(scratch, corpusName)
mkdirSync(work, { recursive: true })
const tracked = execFileSync("git", ["-C", src, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  .split("\n").filter(Boolean)
const files: string[] = []
for (const rel of tracked) {
  if (!rel.endsWith(".rs")) continue
  const from = path.join(src, rel)
  const to = path.join(work, rel)
  mkdirSync(path.dirname(to), { recursive: true })
  cpSync(from, to)
  files.push(rel)
}
const pin = execFileSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
console.log(`direction census — ${corpusName}@${pin.slice(0, 7)}, ${files.length} .rs files staged in ${work}`)

const { indexProjectParallel } = await import(path.join(REPO_ROOT, "src", "ast", "parallel-indexer.ts"))
const projectId = `incoming-rust-${process.pid}`
writeFileSync(path.join(dataHome, ".bb-project"), projectId)

const t0 = Date.now()
const stats = await indexProjectParallel(projectId as any, work, {
  skipPostProcessing: true,
  logger: { log: () => {}, write: () => {} },
})
console.log(`indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${stats.processedFiles} processed, ${stats.successFiles} ok, ` +
  `${stats.errorFiles} error, ${stats.symbolsExtracted} symbols, ${stats.relationshipsFound} relationships`)

const { BrainDatabase } = await import(path.join(REPO_ROOT, "src", "brain", "database.ts") as any)
const db = await (BrainDatabase as any).getRawInstance(projectId)
const rows = db.prepare(`
  SELECT r.relationship_type AS t,
         CASE WHEN r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NOT NULL THEN 'both'
              WHEN r.source_symbol_id IS NOT NULL THEN 'out-only'
              WHEN r.target_symbol_id IS NOT NULL THEN 'in-only'
              ELSE 'neither' END AS arm,
         COUNT(*) AS n
  FROM brain_relationship r
  WHERE r.project_id = ?
  GROUP BY r.relationship_type, arm
`).all(projectId) as any[]

const byType = new Map<string, Record<string, number>>()
for (const r of rows) {
  const rec = byType.get(r.t) ?? { both: 0, "out-only": 0, "in-only": 0, neither: 0 }
  rec[r.arm] = r.n
  byType.set(r.t, rec)
}

// "Silence is guilt": a parsed corpus that stored NOTHING is not a measurement of
// zero incoming edges, it is a broken store phase, and the difference is the whole
// point of this script. Observed 2026-10-04: 110 files parsed, 110 ok, and every
// batch logged `storeResults failed {"error":"near \"VALUES\": syntax error"}` —
// `insertSymbol` in src/ast/parallel-indexer.ts:2154 carries TWO `VALUES` clauses
// in one statement, which SQLite refuses to prepare, so brain_symbol and
// brain_relationship stay empty. That is a report, not a fix: the file is not this
// lane's.
const symbolCount = (db.prepare(`SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?`).get(projectId) as any).n
if (stats.processedFiles > 0 && symbolCount === 0) {
  console.error(`\nREFUSING TO REPORT: ${stats.processedFiles} file(s) parsed and ${stats.successFiles} succeeded, ` +
    `but 0 symbols reached brain_symbol. A zero row over a non-empty corpus is a ` +
    `broken store phase, not a measurement — see the header.`)
  process.exit(6)
}

if (rows.length === 0) {
  console.error(`\nREFUSING TO REPORT: 0 relationship rows in brain_relationship for a corpus of ${stats.processedFiles} parsed file(s).`)
  process.exit(6)
}

const pad = (s: string | number, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`\n${pad("type", 14)}${pad("stored", 10)}${pad("both", 10)}${pad("out-only", 10)}${pad("in-only", 10)}${pad("neither", 10)}incoming-share`)
console.log("-".repeat(96))
let totBoth = 0, totOut = 0, totIn = 0, totNone = 0
for (const [t, rec] of [...byType.entries()].sort()) {
  const stored = rec.both + rec["out-only"] + rec["in-only"] + rec.neither
  totBoth += rec.both; totOut += rec["out-only"]; totIn += rec["in-only"]; totNone += rec.neither
  const denom = rec.both + rec["in-only"]
  const share = denom > 0 ? `${((100 * (rec.both + rec["in-only"])) / stored).toFixed(1)}%` : "n/a (no resolved target)"
  console.log(`${pad(t, 14)}${pad(stored, 10)}${pad(rec.both, 10)}${pad(rec["out-only"], 10)}${pad(rec["in-only"], 10)}${pad(rec.neither, 10)}${share}`)
}
const storedTotal = totBoth + totOut + totIn + totNone
console.log("-".repeat(96))
console.log(`${pad("TOTAL", 14)}${pad(storedTotal, 10)}${pad(totBoth, 10)}${pad(totOut, 10)}${pad(totIn, 10)}${pad(totNone, 10)}` +
  `${((100 * (totBoth + totIn)) / storedTotal).toFixed(1)}%`)

// what an incoming query can actually reach: the target side of every stored row
const incomingReach = db.prepare(`
  SELECT COUNT(DISTINCT r.target_symbol_id) AS n
  FROM brain_relationship r WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL
`).get(projectId) as any
const outgoingReach = db.prepare(`
  SELECT COUNT(DISTINCT r.source_symbol_id) AS n
  FROM brain_relationship r WHERE r.project_id = ? AND r.source_symbol_id IS NOT NULL
`).get(projectId) as any
console.log(`\nsymbols stored ${symbolCount}; distinct ids reachable as an INCOMING target ${incomingReach.n}; ` +
  `as an OUTGOING source ${outgoingReach.n}`)

rmSync(scratch, { recursive: true, force: true })