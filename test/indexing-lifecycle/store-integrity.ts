// test/indexing-lifecycle/store-integrity.ts — the store step of the lifecycle.
//
// Everything else in this suite assumes a run stores something. On this branch
// it does not: `src/ast/parallel-indexer.ts:2163-2165` carries a merge leftover
// in which the brain_symbol INSERT has TWO `VALUES` clauses. That is a SQLite
// syntax error, so `rawDb.prepare()` throws inside `storeResults`, the
// surrounding try/catch swallows it ("a batch failed to store, some files may be
// missing from DB"), the transaction rolls back, and the run completes with an
// index containing nothing. `runPostProcessing` then throws
// "no index for project …" and the whole `bb index` dies.
//
// This is the smallest possible statement of the defect, kept as its own file
// so the suite's first line of evidence is the root cause rather than one of its
// many symptoms, and so a regression is reported as "the store is broken" and
// not as "resume equivalence failed" or "incremental kept stale symbols".
//
// It is deliberately NOT skippable: unlike the diagnostic shim in harness.ts
// (which exists only so the OTHER suites can produce signal past this blocker),
// this file describes what must be true of the product. The one exception is
// BB_TEST_INSERT_SYMBOL_REPAIR, which is honoured here too so that
//
//   BB_TEST_INSERT_SYMBOL_REPAIR=1 npx tsx test/indexing-lifecycle/store-integrity.ts
//
// answers "is the store the ONLY thing wrong?" in one command.
//
// Run:  npx tsx test/indexing-lifecycle/store-integrity.ts

import {
  createSuite, isolateDataDir, printModeBanner, captureStderr, installInsertSymbolRepair,
  makeTsFixture, rmFixture, projectIdFor, rawDb,
} from "./harness"

const suite = createSuite("store-integrity")
isolateDataDir("store")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")

const N = 5

const fx = makeTsFixture("store", N)
const pid = await projectIdFor(fx.root)

// The whole point: watch what the run SAYS as well as what it returns.
const { result: stats, stderr } = await captureStderr(() =>
  indexProjectParallel(pid, fx.root, { skipPostProcessing: true }),
)

suite.check(
  "a normal index run reports NO store-layer failure",
  !/storeResults failed|syntax error|failed to store/i.test(stderr),
  stderr.split("\n").filter((l) => /storeResults|failed to store|syntax/i.test(l)).slice(0, 3).join(" | ").slice(0, 400),
)
suite.check("a normal index run does not announce a re-processing storm", !/files missed, re-processing/i.test(stderr), stderr.split("\n").filter((l) => /missed/i.test(l)).slice(0, 2).join(" | ").slice(0, 300))

suite.check("a normal index run indexed every candidate", stats.summary?.newlyParsed === N + 1, JSON.stringify(stats.summary))
suite.check(
  "a normal index run reports a NON-ZERO symbol count",
  stats.symbolsExtracted > 0,
  `symbolsExtracted=${stats.symbolsExtracted}`,
)
suite.check(
  "a normal index run reports zero symbol loss",
  stats.summary?.symbolLoss === 0,
  `symbolLoss=${stats.summary?.symbolLoss}`,
)

const db = await rawDb(pid)
const fileRows = (db.prepare("SELECT path FROM brain_file WHERE project_id = ?").all(pid) as any[]).map((r) => r.path)
const symbolRows = (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid) as any).c
const relRows = (db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?").get(pid) as any).c

suite.check("every indexed file has a brain_file row", fileRows.length === N + 1, `rows=${fileRows.length}`)
suite.check("the index contains symbols", symbolRows > 0, `symbols=${symbolRows}`)
suite.check("the index contains relationships", relRows > 0, `relationships=${relRows}`)

suite.check(
  "every parsed .ts file has at least one stored symbol",
  fx.files.every((f) =>
    (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND id LIKE ?").get(pid, `${pid}:${f.replace(`${fx.root}/`, "")}:%`) as any).c > 0,
  ),
  fx.files
    .map((f) => `${f.replace(`${fx.root}/`, "")}=${(db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND id LIKE ?").get(pid, `${pid}:${f.replace(`${fx.root}/`, "")}:%`) as any).c}`)
    .join(" "),
)

suite.check(
  "no stored symbol has line 0 (store-bound line numbers survive)",
  (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND line_start < 1").get(pid) as any).c === 0,
  `count=${(db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND line_start < 1").get(pid) as any).c}`,
)
suite.check(
  "the fixture's declared function is present under its own name",
  (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = ?").get(pid, "modFns0") as any).c > 0,
  `modFns0 rows=${(db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = ?").get(pid, "modFns0") as any).c}`,
)
suite.negative(
  "no symbol id is stored twice (the store is idempotent per file)",
  (db.prepare("SELECT COUNT(*) c FROM (SELECT id FROM brain_symbol WHERE project_id = ? GROUP BY id HAVING COUNT(*) > 1)").get(pid) as any).c === 0,
  `dupes=${(db.prepare("SELECT COUNT(*) c FROM (SELECT id FROM brain_symbol WHERE project_id = ? GROUP BY id HAVING COUNT(*) > 1)").get(pid) as any).c}`,
)

const status = db.prepare("SELECT status, total_files, indexed_files, total_symbols, total_relationships FROM brain_index_status WHERE project_id = ?").get(pid) as any
suite.check(
  "the persisted run status is 'complete'",
  String(status?.status) === "complete",
  JSON.stringify(status),
)
suite.check(
  "the persisted counters the indexer DOES maintain are non-zero (files AND symbols)",
  Number(status?.indexed_files) > 0 && Number(status?.total_symbols) > 0,
  JSON.stringify(status),
)
// KNOWN GAP, deliberately left failing. `total_relationships` is declared in the
// schema (src/brain/schema-ddl.ts:176, src/brain/brain.sql.ts:376) and is never
// written by any code path — indexProjectParallel does not pass a relationship
// count to updateIndexStatus (parallel-indexer.ts:4933-4942) — so it is 0 even
// on a fully populated index. Nothing reads it today, so this is a latent
// consumer trap rather than a live wrong number.
suite.check(
  "brain_index_status.total_relationships reflects the stored relationship count [known gap]",
  Number(status?.total_relationships) === relRows,
  `status.total_relationships=${status?.total_relationships} brain_relationship rows=${relRows}`,
)

// A second run must not double anything.
const again = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
suite.negative("a second run stores nothing new", again.summary?.newlyParsed === 0, JSON.stringify(again.summary))
const after = (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid) as any).c
suite.check("a second run does not duplicate symbols", after === symbolRows, `before=${symbolRows} after=${after}`)

rmFixture(fx.root)
suite.finish()