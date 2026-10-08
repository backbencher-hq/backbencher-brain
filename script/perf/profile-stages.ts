// profile-stages.ts — per-stage timing + relationship-multiset digest for one
// tier of the scaling pools.
//
// WHY THIS EXISTS: the CLI's own log prints post-processing phases but not the
// parse/store split, and the store phase is where a per-relationship SQL
// resolution runs. "The curve bends" is not a diagnosis; this prints where the
// milliseconds went, and digests the relationship multiset so a change can be
// PROVED not to have altered the graph.
//
// Usage:
//   BB_DATA_DIR=<fresh dir> npx tsx script/perf/profile-stages.ts <poolDir> [label]
//
// Prints one JSON object on stdout. Nothing here is a gate — script/perf/
// verify-scaling-linear.ts is.

import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createHash } from "crypto"
import { getProjectId } from "../../src/util/project-id"

const dir = process.argv[2]
if (!dir) {
  console.error("usage: profile-stages.ts <poolDir> [label]")
  process.exit(2)
}
const label = process.argv[3] ?? "run"

const pid = getProjectId(dir)
const raw: any = await BrainDatabase.getRawInstance(pid)

const wallStart = Date.now()
const stats: any = await indexProjectParallel(pid, dir, {})
const wallMs = Date.now() - wallStart

const p = stats.phases ?? {}

/** Relationship multiset: counts per kind, plus a content hash over the
 *  (id, source, target, kind) tuples. The id already encodes source+target+kind,
 *  so the hash is over the sorted id list — which is a multiset, so duplicates
 *  cannot cancel out. Order-independent by construction (sorted). */
const byKind = raw
  .prepare(`SELECT relationship_type AS k, COUNT(*) AS c FROM brain_relationship GROUP BY k ORDER BY k`)
  .all() as any[]
const ids = raw.prepare(`SELECT id FROM brain_relationship`).all() as any[]
const sortedIds = ids.map((r: any) => String(r.id)).sort()
const hash = createHash("sha256").update(sortedIds.join("\n")).digest("hex").slice(0, 16)

const syms = (raw.prepare(`SELECT COUNT(*) c FROM brain_symbol`).get() as any).c
const files = (raw.prepare(`SELECT COUNT(*) c FROM brain_file`).get() as any).c
const danglingSrc = (
  raw
    .prepare(`SELECT COUNT(*) c FROM brain_relationship r WHERE NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)`)
    .get() as any
).c
const danglingTgt = (
  raw
    .prepare(
      `SELECT COUNT(*) c FROM brain_relationship r WHERE r.target_symbol_id IS NOT NULL AND r.target_symbol_id != '' AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id)`,
    )
    .get() as any
).c
const nullSrc = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL`).get() as any).c
const nullTgt = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id IS NULL`).get() as any).c

// The _i13_pick join cardinality: rows the name-resolution window function must
// sort. Reported because it is the term that grows superlinearly in the measured
// data, and it is a property of the DATA, not of wall clock.
const joinRows = (
  raw
    .prepare(
      `SELECT COUNT(*) AS c FROM brain_relationship r
       JOIN brain_symbol s ON s.project_id = r.project_id AND s.name = r.target_external
       WHERE r.project_id = ? AND r.target_external IS NOT NULL
         AND r.relationship_type <> 'contains'
         AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0`,
    )
    .get(pid) as any
).c

const load1 = Number((process.env.BB_PERF_LOAD1 ?? "0")) || undefined

console.log(
  JSON.stringify({
    label,
    pool: dir.split("/").pop(),
    files,
    symbols: syms,
    relationships: sortedIds.length,
    wallMs,
    phases: {
      discoveryMs: p.discoveryMs,
      workerStartupMs: p.workerStartupMs,
      parseMs: p.parseMs,
      dbFlushMs: p.dbFlushMs,
      postProcessingMs: p.postProcessingMs,
      finalAccountingMs: p.finalAccountingMs,
      mode: p.mode,
      workerCount: p.workerCount,
    },
    relsByKind: Object.fromEntries(byKind.map((r: any) => [r.k, r.c])),
    relHash: hash,
    dangling: { source: danglingSrc, target: danglingTgt, nullSource: nullSrc, nullTarget: nullTgt },
    i13JoinRows: joinRows,
    load1,
  }),
)
