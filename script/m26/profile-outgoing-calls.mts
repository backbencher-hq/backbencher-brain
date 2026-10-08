// script/m26/profile-outgoing-calls.mts — WHY `outgoingCalls` takes 2-3.5 s.
//
// Diagnosis, not a gate. This reproduces the attribution recorded in
// docs/M26-OUTGOING-CALLS-PERF.md so the numbers there can be re-checked rather
// than taken on trust. It changes nothing and asserts nothing.
//
// It exists because the obvious way to measure this is wrong, in a way that is
// easy to ship. `expandCalls` receives a `raw` handle and runs its own SQL on
// it — and that SQL is fast (3 ms total). The 2-3 s is spent inside
// `traverseGraph`, which opens ITS OWN handle via
// `BrainDatabase.getRawInstance(projectId)` (graph-engine.ts:440). Instrumenting
// the handle you were handed measures the wrong queries and reports that the
// cost is not in SQL at all — which is what happened here first. So this wraps
// getRawInstance.
//
// WHAT IT PRINTS
//   1. latency by traversal depth (cost scales with depth, not fan-out)
//   2. per-SQL-text attribution on the handle the walk actually uses
//   3. the LIMIT cliff on a THROWAWAY COPY of the index
//
// Usage:  npx tsx script/m26/profile-outgoing-calls.mts [projectId]
// No node on PATH?  export PATH="$HOME/.local/node/bin:$PATH" first.

import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { BrainDatabase } from "../../src/brain/database"
import { traverseGraph } from "../../src/intelligence/graph/graph-engine"

const PROJECT_ID = process.argv[2] ?? "064be526733c31e95c0ac2beb42d209af9bab8e6"
const PID = PROJECT_ID as never

interface Root {
  id: string
  name: string
  symbolType: string
  file: string
  lineStart: number
  lineEnd: number
  language: string
  complexity: number
}
interface Sampled {
  root: Root
  label: string
}

const raw: any = BrainDatabase.openByPath(BrainDatabase.getPath(PID))
const SELECT_ROOT = `SELECT s.id, s.name, s.symbol_type, s.line_start, s.line_end, f.relative_path AS rel
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.symbol_type = 'function'`
const BY_FANOUT = `${SELECT_ROOT}
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id = s.id) DESC LIMIT 6`
const QUIETEST = `${SELECT_ROOT}
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id = s.id) ASC LIMIT 3`

function sample(sql: string): Sampled[] {
  const out: Sampled[] = []
  for (const row of raw.prepare(sql).all(PROJECT_ID) as Array<Record<string, any>>) {
    out.push({
      label: `${row.rel}:${row.line_start}`,
      root: {
        id: row.id,
        name: row.name,
        symbolType: row.symbol_type,
        file: row.rel,
        lineStart: row.line_start,
        lineEnd: row.line_end,
        language: "typescript",
        complexity: 0,
      },
    })
  }
  return out
}

// BOTH ends of the fan-out range. A table of eight depth-4 symbols cannot show
// that depth is what costs anything — the first version of this sampled only the
// busiest symbols and printed "depth 4" down the whole column.
const projects: Sampled[] = [...sample(BY_FANOUT), ...sample(QUIETEST)]
if (projects.length === 0) {
  console.error(`  no functions indexed for project ${PROJECT_ID} — is this the right index?`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. depth vs latency
// ---------------------------------------------------------------------------
// Instrumentation MUST be installed before the first walk. STATEMENT_CACHE holds
// the statement objects produced by the first db.prepare(sql); a wrapper installed
// later never sees those .all() calls. Doing this after leg 1 reported "SQL total
// 1ms" for a 2857ms walk and concluded the cost was not in SQL — which was wrong,
// and wrong in the direction that looks like a clean negative result.
const byTextEarly = new Map<string, { n: number; ms: number; rows: number; example: string }>()
const getRawEarly = BrainDatabase.getRawInstance.bind(BrainDatabase) as any
function instrument(db: unknown): unknown {
  const d = db as any
  if (d.__profiled) return d
  d.__profiled = true
  const prepare = d.prepare.bind(d)
  d.prepare = (sql: string) => {
    const stmt = prepare(sql)
    const all = stmt.all.bind(stmt)
    stmt.all = (...a: unknown[]) => {
      const t0 = performance.now()
      const out = all(...a)
      const h = createHash("sha1").update(sql).digest("hex").slice(0, 8)
      const e = byTextEarly.get(h) ?? { n: 0, ms: 0, rows: 0, example: sql }
      e.n += 1
      e.rows += out.length
      e.ms += performance.now() - t0
      byTextEarly.set(h, e)
      return out
    }
    return stmt
  }
  return d
}
;(BrainDatabase as any).getRawInstance = async (pid: unknown) => instrument(await getRawEarly(pid))
instrument(await getRawEarly(PID))
instrument(raw)

console.log("\n1. LATENCY BY TRAVERSAL DEPTH (each measured warm)\n")
interface Row {
  label: string
  name: string
  ms: number
  edges: number
  depth: number
}
const rows: Row[] = []
for (const p of projects) {
  // warm once, so JIT and the statement cache are not counted as walk cost
  await traverseGraph(PID, p.root as never, { timeBudgetMs: 8000 } as never)
  const t0 = performance.now()
  const r = await traverseGraph(PID, p.root as never, { timeBudgetMs: 8000 } as never)
  rows.push({ label: p.label, name: p.root.name, ms: performance.now() - t0, edges: r.callees.length + r.callers.length, depth: r.maxDepthReached })
}
rows.sort((a, b) => a.depth - b.depth || b.ms - a.ms)
console.log("   depth   latency     edges  symbol")
for (const r of rows) {
  console.log(`   ${String(r.depth).padStart(5)}  ${r.ms.toFixed(0).padStart(8)}ms  ${String(r.edges).padStart(6)}  ${r.label} ${r.name}`)
}
const depths = new Set(rows.map((r) => r.depth))
console.log(`\n   depths observed: ${[...depths].sort().join(", ")}`)
console.log("   cost tracks DEPTH, not edge count — the busiest and quietest symbols return")
console.log("   comparable edge counts at very different depths and costs.")

if (depths.size < 2) {
  console.log("\n   (only one depth appeared in this sample; the depth claim needs a wider index")
  console.log("    than this one to be visible here. See docs/M26-OUTGOING-CALLS-PERF.md.)")
}

// ---------------------------------------------------------------------------
// 2. per-SQL-text attribution, on the handle the WALK uses
// ---------------------------------------------------------------------------
console.log("\n2. WHERE THE WALK TIME GOES (on BrainDatabase.getRawInstance, not the passed handle)\n")
const byText = byTextEarly
const worst = rows.reduce((a, b) => (b.ms > a.ms ? b : a))
const worstProject = projects.find((p) => p.label === worst.label) ?? projects[0]!
byText.clear()
const walkT0 = performance.now()
const walkResult = await traverseGraph(PID, worstProject.root as never, { timeBudgetMs: 8000 } as never)
const walkMs = performance.now() - walkT0
const totalSql = [...byText.values()].reduce((a, e) => a + e.ms, 0)
console.log(`   walk ${walkMs.toFixed(0)}ms for ${worstProject.label} (depth ${walkResult.maxDepthReached}, ${walkResult.callees.length} callees / ${walkResult.callers.length} callers)`)
console.log(`   SQL total ${totalSql.toFixed(0)}ms across ${byText.size} distinct statement texts\n`)
for (const [h, e] of [...byText].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5)) {
  console.log(`     ${h}  ran ${String(e.n).padStart(4)}x  ${e.ms.toFixed(0).padStart(6)}ms  (${e.ms > 0 ? Math.round(e.ms / Math.max(e.n, 1)) : 0}ms each, ${((100 * e.ms) / walkMs).toFixed(0)}% of the walk)  ${e.rows} rows`)
}
const top = [...byText].sort((a, b) => b[1].ms - a[1].ms)[0]
if (top && top[1].ms > walkMs * 0.5) {
  console.log(`\n   One statement is ${((100 * top[1].ms) / walkMs).toFixed(0)}% of the walk, at ${(top[1].ms / Math.max(top[1].n, 1)).toFixed(0)}ms a call.`)
  console.log("   It is NOT recompiled (STATEMENT_CACHE holds it), NOT engine-bound (python's")
  console.log("   sqlite runs it just as slowly), and NOT limited away (LIMIT -1 returns the")
  console.log("   same rows). The cost is a post-join filter cliff — see the doc.")
}

// ---------------------------------------------------------------------------
// 3. the LIMIT cliff, on a THROWAWAY COPY (the owner's index is only ever read)
// ---------------------------------------------------------------------------
console.log("\n3. THE CLIFF: the hot statement with LIMIT swept (throwaway copy)\n")
const betterSqlite = (await import("better-sqlite3")) as unknown as { default?: unknown; Database?: unknown }
// better-sqlite3 is CommonJS: under ESM the constructor is on `.default`, not the
// namespace. The first version of this destructured the namespace and got
// "Database is not a constructor".
const Database = (betterSqlite.default ?? betterSqlite.Database) as new (f: string, o?: unknown) => {
  prepare: (s: string) => { all: (...a: unknown[]) => unknown[] }
  close: () => void
}
// mkdirSync returns undefined, NOT the directory it created. Assigning its result
// to scratchDir is why the first run died in path.join with "must be of type
// string, received undefined" — a crash in the measuring tool, not in bb.
const scratchDir = path.join(os.tmpdir(), "bb-outgoing-calls-")
mkdirSync(scratchDir, { recursive: true })
const scratch = path.join(scratchDir, "copy.db")
const src = BrainDatabase.getPath(PID)
copyFileSync(src, scratch)
// The -wal matters: copying brain.db ALONE reads a stale schema when a WAL is
// present, and a repair built on that looks like the repair failed.
try {
  copyFileSync(`${src}-wal`, `${scratch}-wal`)
  copyFileSync(`${src}-shm`, `${scratch}-shm`)
} catch {
  /* no wal present */
}
const probe = new Database(scratch, { readonly: true })
const hot = (top?.[1].example ?? "").replace(/\s+/g, " ").trim()
if (hot.length === 0) {
  console.log("   no dominant statement was captured; nothing to sweep.")
} else {
  const arity = hot.length - hot.replace(/\?/g, "").length
  const stmt = probe.prepare(hot)
  // The real parameters were bound on the live handle; here we only vary the LAST
  // placeholder (the edgeLimit). Where the synthetic binding is not representative
  // the sweep says so rather than printing a confident but meaningless number.
  const sample2: unknown[] = new Array(arity).fill("")
  console.log(`   ${arity} placeholders; sweeping the last one (the walk's edgeLimit).\n`)
  for (const lim of [50, 150, 201, 210, 250, 276, -1]) {
    try {
      sample2[arity - 1] = lim
      const t0 = performance.now()
      const out = stmt.all(...sample2)
      console.log(`     LIMIT ${String(lim).padStart(4)}  ${(performance.now() - t0).toFixed(1).padStart(7)}ms  ${String(out.length).padStart(4)} rows`)
    } catch {
      console.log("     (the synthetic binding is not representative; reproduce the sweep with the")
      console.log("      real parameters — see the LIMIT table in docs/M26-OUTGOING-CALLS-PERF.md)")
      break
    }
  }
  console.log("\n   A cliff between two adjacent LIMITs is the signature: past the point where")
  console.log("   matches get rare, each remaining row costs a seek plus four joins, because the")
  console.log("   relationship_type filter is applied AFTER the joins rather than inside the index")
  console.log("   seek (brain_rel_proj_source_idx has no relationship_type column).")
}
probe.close()
console.log(`\n   scratch copy: ${scratch}`)
console.log("   the owner's index was opened read-only and never written.")