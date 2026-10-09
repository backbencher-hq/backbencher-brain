// probe-taint-plan-stats.ts — why the cross-symbol taint pass cost 440 s on a
// 37-minute cold index while the pass itself is 3 s of work.
//
// The statement in `CROSS_SYMBOL_TAINT_QUERY` joins brain_taint_flow to
// brain_relationship, and SQLite picks its join order when the statement is
// PREPARED. The pipeline runs `ANALYZE` at the END of post-processing, so on a
// fresh index the planner is choosing between tables whose sizes it has never
// measured — and the plan it picks scans the taint table once per source row.
// `resolveCrossSymbolTaints` now analyzes the four indexes this statement can
// use before preparing it; this probe is what measured that, and what keeps the
// claim checkable.
//
// Usage:
//   BB_DATA_DIR=<data dir> npx tsx script/perf/probe-taint-plan-stats.ts <projectId> [flags]
//
//   --blind   also run the statement with statistics DELETED, which is the state
//             a cold run is in. On the ASP.NET Core index that arm is ~9 minutes
//             (546 s measured); on small corpora it is seconds.
//   --revert   first put back every flow this pass has already resolved
//             (`cross_language_boundaries = 1` → unresolved). The probe WRITES:
//             the fixed arm resolves flows exactly as production does.
//
// Prints one JSON object on stdout: the reference groups the statement produces,
// optionally the same statement's cost without statistics, the fixed pass's cost
// and rows, and whether every row it stored is one of the groups the statement
// produced. Nothing here is a gate.

import { CROSS_SYMBOL_TAINT_QUERY, resolveCrossSymbolTaints } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const pid = process.argv[2]
if (!pid) {
  console.error("usage: probe-taint-plan-stats.ts <projectId> [--blind] [--revert]")
  process.exit(2)
}
const blind = process.argv.includes("--blind")
const revert = process.argv.includes("--revert")

const raw: any = await BrainDatabase.getRawInstance(pid)
// The statistics tables do not exist until something runs ANALYZE, so asking
// them for a COUNT before that is an error rather than a zero.
const statRows = (table: "sqlite_stat1" | "sqlite_stat4") => {
  const has = Number((raw.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE name = ?`).get(table) as any)?.c ?? 0) > 0
  return has ? Number((raw.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as any)?.c ?? 0) : 0
}
const statCounts = () => ({ stat1: statRows("sqlite_stat1"), stat4: statRows("sqlite_stat4") })

interface Group {
  src: string
  sink: string
  target: string
  path: string[]
}

function runQuery(): { ms: number; rows: Group[] } {
  const t = Date.now()
  const rows = (raw.prepare(CROSS_SYMBOL_TAINT_QUERY).all(pid, pid) as any[]).map((r) => ({
    src: String(r.flow_source_id),
    sink: String(r.flow_sink_id),
    target: String(r.target_symbol_id),
    path: String(r.path ?? "").split("|||").filter(Boolean),
  }))
  return { ms: Date.now() - t, rows }
}

function storedRows(): Group[] {
  return (
    raw
      .prepare(
        `SELECT id, sink_symbol_id, flow_path FROM brain_taint_flow
         WHERE cross_language_boundaries = 1 AND sink_symbol_id IS NOT NULL`,
      )
      .all() as any[]
  ).map((r) => {
    let path: string[] = []
    try {
      path = JSON.parse(String(r.flow_path ?? "[]"))
    } catch {
      path = ["<unparseable>"]
    }
    return { src: String(r.id), sink: "", target: String(r.sink_symbol_id), path }
  })
}

const statsBefore = statCounts()
if (revert) {
  const reverted = raw
    .prepare(`UPDATE brain_taint_flow SET sink_symbol_id = NULL, cross_language_boundaries = 0 WHERE cross_language_boundaries = 1`)
    .run()
  console.error(`reverted ${(reverted as any)?.changes ?? "?"} previously resolved flow(s) to the unresolved state`)
}

// 1. What the statement produces with whatever statistics exist right now. This
//    is the reference set the fixed pass's writes are checked against.
const reference = runQuery()

// 2. The same statement with the statistics deleted — the cold-run state. BOTH
//    tables go: either one alone can still steer the planner to the good plan
//    (measured), so deleting only `sqlite_stat1` would not reproduce the cold
//    state it is meant to reproduce. This is the arm that costs minutes on a
//    large index (546 s measured on the ASP.NET Core index), so it is opt-in.
let blindArm: { ms: number; groups: number; statsDeleted: { stat1: number; stat4: number } } | null = null
if (blind) {
  const deleted = statCounts()
  raw.exec(`DELETE FROM sqlite_stat1`)
  raw.exec(`DELETE FROM sqlite_stat4`)
  const b = runQuery()
  blindArm = { ms: b.ms, groups: b.rows.length, statsDeleted: deleted }
}

// 3. The pass itself, on the same state (it refreshes the statistics it needs).
//    Which rows it touched is measured rather than assumed: it only updates rows
//    whose `sink_symbol_id IS NULL`, so the difference between the stored set
//    before and after is exactly its write set. Rows resolved by an EARLIER run
//    are not part of this pass's output and comparing them would be comparing
//    the wrong thing (they can be in the table because the data changed since).
const alreadyResolved = new Set(storedRows().map((r) => r.src))
const t = Date.now()
const flows = await resolveCrossSymbolTaints(pid as any)
const fixedMs = Date.now() - t

// 4. Equivalence: every stored row must be one of the groups the statement
//    produced for that source row, and every source the statement resolved must
//    have a stored row. One source flow can carry several sinks, and the pass
//    stores one resolution per row (the UPDATE's `sink_symbol_id IS NULL` guard
//    makes later writes for the same row no-ops), so the comparison is per row,
//    not per group.
const stored = storedRows().filter((r) => !alreadyResolved.has(r.src))
const bySource = new Map<string, Group[]>()
for (const g of reference.rows) {
  if (!bySource.has(g.src)) bySource.set(g.src, [])
  bySource.get(g.src)!.push(g)
}
const matched = stored.filter((r) =>
  (bySource.get(r.src) ?? []).some((g) => g.target === r.target && JSON.stringify(g.path) === JSON.stringify(r.path)),
)
const refSources = new Set(reference.rows.map((g) => g.src))
const storedSources = new Set(stored.map((r) => r.src))
// Only sources that were UNRESOLVED when this pass started are expected to gain a
// row; a source already resolved by an earlier run is out of this pass's scope.
const sourcesWithoutARow = [...refSources].filter((s) => !storedSources.has(s) && !alreadyResolved.has(s))

console.log(
  JSON.stringify(
    {
      projectId: pid,
      statsBefore,
      statsAfter: statCounts(),
      reference: { groups: reference.rows.length, distinctSourceFlows: refSources.size, ms: reference.ms },
      blind: blindArm,
      fixed: { flows, ms: fixedMs, storedRows: stored.length },
      equivalence: {
        storedRowsMatchingAReferenceGroup: matched.length,
        storedRowsNotMatching: stored.length - matched.length,
        sourcesResolvedByTheStatementWithoutAStoredRow: sourcesWithoutARow.length,
        verdict: matched.length === stored.length && sourcesWithoutARow.length === 0 ? "identical" : "differs",
      },
    },
    null,
    1,
  ),
)
process.exit(0)
