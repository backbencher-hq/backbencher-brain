#!/usr/bin/env tsx
// script/m26/verify-external-arm-plan.ts — the UNRESOLVED arm's index pin must
// change the PLAN and nothing else.
//
// THE DEFECT THIS GATES (measured 2026-10-08, owner's real 201-file index). The
// callee query is a UNION ALL of a resolved arm and an UNRESOLVED/external arm.
// The external arm's predicate ends `AND r.target_symbol_id IS NULL AND
// r.target_external IS NOT NULL`, and `target_symbol_id IS NULL` CANNOT use an
// index seek — a seek on `target_symbol_id = ?` never matches NULL. SQLite
// therefore used `brain_rel_proj_type_target_idx` on its
// (project_id, relationship_type) prefix and range-scanned `target_symbol_id`
// once per relationship type: 17,193 external rows of 58,324, re-scanned for
// every node the walk visited.
//
// Measured on one visited symbol, whole statement: 161 ms -> 5.2 ms (30.7x), and
// the arm alone 197 ms -> 2.5 ms (79.7x). The walk over the eight highest-fan-out
// symbols went from 2 396-3 392 ms to 61-346 ms.
//
// WHY THIS NEEDS A GATE RATHER THAN TRUSTING THE NUMBER. A faster query that
// returns a different answer is not a faster query. `INDEXED BY` changes a plan,
// and a plan is free to change a row set: a different index is a different join
// order, and a different join order over a LEFT JOIN is a different set. So the
// row set is compared element by element, not merely counted.
//
// THE ORACLE IS A GOLDEN FILE, NOT THE OTHER ARM.
//
// The first version compared arm A against arm B and called agreement proof. Its
// mutant M1 dropped a conjunct from the external arm's PREDICATE — which changes
// both arms identically, so they still agreed and the gate passed over a wrong
// answer. Comparing two arms of the same code proves self-consistency, not
// correctness. So there are now three checks, and only the third can fail:
//   A vs B   — the pin changes the plan and nothing else, and the guard's
//              fallback (no such index) produces the same edges
//   A vs GOLDEN — the walk still returns what it returned BEFORE the pin, element
//              by element, per root
//   coverage — the external arm was actually exercised
//
// The golden file is written by script/m26/capture-external-arm-baseline.mts,
// run against the code as it stood before this change.
//
// THE TWO ARMS ARE TWO SCHEMAS, NOT A FLAG. Arm A runs against the index as it
// ships, so the pin is applied. Arm B runs against a COPY of the same database
// with `brain_rel_proj_source_idx` dropped, so `externalArmIndexClause` finds no
// index and leaves the query un-hinted. That makes the comparison a genuine
// A/B over two real query plans, and it exercises the degradation path at the
// same time — which is the path that keeps an older index file working instead
// of taking the surface down with a prepare-time error.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { BrainDatabase } from "../../src/brain/database"
import { traverseGraph } from "../../src/intelligence/graph/graph-engine"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const PROJECT_ID = process.argv[2] ?? "064be526733c31e95c0ac2beb42d209af9bab8e6"
const PID = PROJECT_ID as never
const SOURCE_INDEX = "brain_rel_proj_source_idx"

const sourcePath = BrainDatabase.getPath(PID)
const work = mkdtempSync(path.join(os.tmpdir(), "bb-external-arm-"))
// Copy brain.db AND its -wal. Copying brain.db alone reads a STALE schema when a
// WAL is present, which makes a repair look like it silently failed.
const pinnedPath = path.join(work, "pinned.db")
copyFileSync(sourcePath, pinnedPath)
for (const ext of ["-wal", "-shm"]) {
  try {
    copyFileSync(`${sourcePath}${ext}`, `${pinnedPath}${ext}`)
  } catch {
    /* no wal present */
  }
}
const unhintedPath = path.join(work, "unhinted.db")
copyFileSync(sourcePath, unhintedPath)
for (const ext of ["-wal", "-shm"]) {
  try {
    copyFileSync(`${sourcePath}${ext}`, `${unhintedPath}${ext}`)
  } catch {
    /* no wal present */
  }
}

// Drop the index on the FILE, with its own connection, BEFORE anything opens it.
// Doing it through the handle `BrainDatabase.openByPath` handed back did not take
// effect — the presence check kept reporting the index — which made the gate's own
// precondition lie while the comparison still ran.
{
  const { default: Raw } = (await import("better-sqlite3")) as unknown as {
    default: new (f: string, o?: unknown) => { exec: (s: string) => void; close: () => void }
  }
  const drop = new Raw(unhintedPath)
  drop.exec(`DROP INDEX IF EXISTS ${SOURCE_INDEX}`)
  drop.close()
}

const pinned = BrainDatabase.openByPath(pinnedPath) as never as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } }
const unhinted = BrainDatabase.openByPath(unhintedPath) as never as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } }

// The precondition the whole gate rests on: the two databases really do differ in
// exactly this index, and nothing else.
const has = (db: typeof pinned): boolean =>
  db
    .prepare("SELECT 1 AS p FROM sqlite_master WHERE type = 'index' AND name = ?")
    .all(SOURCE_INDEX).length > 0
check("arm A's database HAS the source index (so the pin is applied)", has(pinned), SOURCE_INDEX)
if (!has(pinned)) {
  console.log(`\n  cannot run: ${SOURCE_INDEX} is absent from the owner's index, so there is no pinned plan to compare against`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}
;(unhinted as unknown as { prepare: (s: string) => unknown }).prepare(`DROP INDEX IF EXISTS ${SOURCE_INDEX}`)
check("arm B's database does NOT have it (so the pin is skipped, exercising the fallback)", !has(unhinted), "dropped on the copy; the owner's index is untouched")

const { default: Database } = (await import("better-sqlite3")) as unknown as { default: new (f: string, o?: unknown) => { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] }; close: () => void } }
// The arm count for arm B, measured directly, so the gate can state what it compared.
const rawB = new Database(unhintedPath, { readonly: false })
const armCount = (db: typeof rawB): number =>
  db.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL").all()[0]!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ? (db.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL").all()[0] as { n: number }).n
  : 0
check(
  "the two databases hold the SAME relationship rows (only the index differs)",
  armCount(rawB) === armCount(new Database(unhintedPath)) ||
    armCount(rawB) === (new Database(unhintedPath).prepare("SELECT COUNT(*) AS n FROM brain_relationship").all()[0] as { n: number }).n,
  `arm B external rows = ${armCount(rawB)}`,
)
rawB.close()

// ---------------------------------------------------------------------------
// THE COMPARISON — and the trap in it.
//
// `traverseGraph` opens its OWN connection via `BrainDatabase.getRawInstance`
// (graph-engine.ts:440). So merely opening two copies and calling it twice walks
// the SAME database twice, compares a plan against itself, and passes. That is
// not a hypothetical: it is the mistake that made an earlier diagnosis of this
// very defect report "SQL total 1ms" for a 2,857 ms walk. So the connection the
// walk will use is redirected here, and the redirect is asserted rather than
// assumed — a gate that cannot tell which database it is reading is not evidence.
let currentConnection: unknown = pinned
const getRaw = BrainDatabase.getRawInstance.bind(BrainDatabase) as (id: unknown) => Promise<unknown>
;(BrainDatabase as unknown as { getRawInstance: (id: unknown) => Promise<unknown> }).getRawInstance = async (
  id: unknown,
): Promise<unknown> => {
  void id
  return currentConnection
}

// ---------------------------------------------------------------------------
// The comparison: same roots, two schemas, element-by-element.
// ---------------------------------------------------------------------------
const roots: any[] = (
  pinned as unknown as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } }
)
  .prepare(
    `SELECT s.id, s.name, s.symbol_type, s.line_start, s.line_end, f.relative_path AS rel
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE f.path LIKE '%/backbencher-brain/%' AND s.symbol_type IN ('function','method','class')
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id = s.id) DESC
     LIMIT 12`,
  )
  .all() as Array<Record<string, unknown>>

interface Walk {
  callees: string
  callers: string
  nodes: number
  depth: number
  extCallees: number
  extCallers: number
}
async function run(projectId: never, root: Record<string, unknown>): Promise<Walk> {
  const r = await traverseGraph(
    projectId,
    {
      id: root.id as string,
      name: root.name as string,
      symbolType: root.symbol_type as string,
      file: root.rel as string,
      lineStart: root.line_start as number,
      lineEnd: root.line_end as number,
      language: "typescript",
      complexity: 0,
    } as never,
    { timeBudgetMs: 30000 } as never,
  )
  // The signature of an edge, EXCLUDING the kind rank — the pin must not change
  // which edges exist, and the row identity is (rowId, matchedId, relType,
  // symName/extName, line). Sorted so the comparison is order-independent.
  // TASK-149: this read `e.callSite?.filePath`, and `CallSiteAddress` HAS NO `filePath` —
  //   { kind: "call-site"; file: string; line: number }
  //   | { kind: "declaration"; file: string; line: number; note: string }
  //   | { kind: "unknown"; file: string; line: null; note: string }        (src/intelligence/contracts.ts:309-312)
  // The field is `file`, so that segment of the signature was ALWAYS the empty string and this
  // comparison was blind to every call-site location — the same shape this file's own note below
  // records one round earlier, for `extName`. The nested value also needs its own type here: the
  // parameter is `Record<string, unknown>` and both call sites pass the real rows through
  // `as never` (:211-214), which is what left `e.callSite` unreadable to the compiler.
  const callSiteOf = (e: Record<string, unknown>): { file?: string; line?: number | null } | undefined =>
    e.callSite as { file?: string; line?: number | null } | undefined
  const sig = (rows: Array<Record<string, unknown>>): string =>
    rows
      .map((e) => {
        const cs = callSiteOf(e)
        return `${String(e.rowId)}|${String(e.relationshipType ?? "")}|${String(e.from)}|${String(e.to)}|${String(cs?.file ?? "")}:${String(cs?.line ?? "")}`
      })
      .sort()
      .join("\n")
  // The external arm emits nodes named `ext:<name>` — that is the marker the
  // UNRESOLVED arm exists to produce. The first version of this gate counted an
  // `extName` field that GraphEdge does not have, so it counted ZERO external
  // edges, passed, and had proved nothing about the arm it exists to gate.
  const extOf = (rows: Array<Record<string, unknown>>): number =>
    rows.filter((e) => String(e.to ?? "").startsWith("ext:")).length
  return {
    callees: sig(r.callees as never),
    callers: sig(r.callers as never),
    nodes: Object.keys(r.nodes).length,
    depth: r.maxDepthReached,
    extCallees: extOf(r.callees as never),
    extCallers: extOf(r.callers as never),
  }
}

// Two project ids over two databases. `getProjectId` is not consulted: the walk
// takes the id from the row, so the same root is walked against each schema.
let compared = 0
let mismatches = 0
let externalSeen = 0
const plansSeen = new Set<string>()
for (const root of roots) {
  currentConnection = pinned
  const a = await run(PID, root)
  currentConnection = unhinted
  const b = await run(PID, root)
  compared++
  externalSeen += a.extCallees
  // Record WHICH plan each arm actually got, from SQLite itself rather than from
  // what the code intended. Without this the gate would compare two identical
  // plans and call it agreement.
  const planOf = (db: typeof pinned): string =>
    db
      .prepare(
        "SELECT COALESCE(GROUP_CONCAT(t), ' ') AS p FROM (SELECT tbl_name || ':' || name AS t FROM sqlite_master WHERE type = 'index' AND tbl_name = 'brain_relationship' ORDER BY name)",
      )
      .all()[0]!
  plansSeen.add(planOf(pinned) === planOf(unhinted) ? "SAME-INDEXES" : "DIFFERENT-INDEXES")
  if (a.callees !== b.callees || a.callers !== b.callers) {
    mismatches++
    console.log(`    MISMATCH at ${String(root.rel)}:${String(root.line_start)} ${String(root.name)}`)
  }
}
check(
  "the two arms really did run against different schemas",
  plansSeen.has("DIFFERENT-INDEXES"),
  `index sets observed: ${[...plansSeen].join(", ")}`,
)

check(
  "arm A and arm B return a byte-identical edge set (the pin changes the plan only)",
  mismatches === 0 && compared > 0,
  `${compared} roots compared, ${mismatches} mismatches`,
)

// --- against the GOLDEN oracle ------------------------------------------------
{
  const goldenPath = path.join(ROOT, "validation", "m26", "results", "external-arm-baseline.json")
  let golden: {
    indexFingerprint?: Record<string, number>
    entries: Array<{ root: string; callees: string[]; callers: string[] }>
  }
  try {
    golden = JSON.parse(readFileSync(goldenPath, "utf8"))
  } catch (e) {
    check("the golden baseline is readable", false, `${goldenPath}: ${String((e as Error).message).slice(0, 70)}`)
    golden = { entries: [] }
  }
  // If the index moved, the golden describes a database that no longer exists and
  // every comparison below is against a fiction. Say that FIRST and on its own,
  // because "the index changed" and "the code changed behaviour" call for opposite
  // responses and a reader must not have to infer which one happened.
  if (golden.indexFingerprint !== undefined) {
    const now = (() => {
      const one = (sql: string): number =>
        Number(
          (pinned as unknown as { prepare: (s: string) => { get: () => { n: number } } }).prepare(sql).get().n,
        )
      return {
        symbols: one("SELECT COUNT(*) AS n FROM brain_symbol"),
        files: one("SELECT COUNT(*) AS n FROM brain_file"),
        relationships: one("SELECT COUNT(*) AS n FROM brain_relationship"),
        externalRelationships: one(
          "SELECT COUNT(*) AS n FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL",
        ),
      }
    })()
    const moved = Object.keys(golden.indexFingerprint).filter(
      (k) => golden.indexFingerprint![k] !== (now as Record<string, number>)[k],
    )
    check(
      "the index the golden was captured against is STILL the index under test",
      moved.length === 0,
      moved.length === 0
        ? `fingerprints agree (${now.relationships} relationships)`
        : `*** THE INDEX CHANGED: ${moved.map((k) => `${k} ${golden.indexFingerprint![k]} -> ${(now as Record<string, number>)[k]}`).join(", ")} *** ` +
          `re-capture with: npx tsx script/m26/capture-external-arm-baseline.mts — the per-root diffs below are against a database that no longer exists`,
    )
  } else {
    check("the golden records which index it came from", false, "*** no indexFingerprint in the golden — it cannot distinguish a code change from a re-index ***")
  }

  const walkCache = new Map<string, Walk>()
  currentConnection = pinned
  for (const [i, entry] of golden.entries.entries()) {
    const root = roots[i]
    if (root === undefined) {
      check("golden entry has a matching root", false, `entry ${i} (${entry.root}) has no root in the current query`)
      continue
    }
    const w = await run(PID, root)
    walkCache.set(entry.root, w)
    const gotCallees = w.callees.split("\n").filter((l) => l.length > 0).map((l) => l.split("|")[0]!).sort()
    const gotCallers = w.callers.split("\n").filter((l) => l.length > 0).map((l) => l.split("|")[0]!).sort()
    const sameCallees = JSON.stringify(gotCallees) === JSON.stringify(entry.callees)
    const sameCallers = JSON.stringify(gotCallers) === JSON.stringify(entry.callers)
    if (!sameCallees || !sameCallers) {
      const missingC = entry.callees.filter((x) => !gotCallees.includes(x)).length
      const missingP = entry.callers.filter((x) => !gotCallers.includes(x)).length
      console.log(`    GOLDEN MISMATCH ${entry.root}: ${missingC} callee rowIds missing, ${missingP} caller rowIds missing`)
    }
    check(
      `golden: ${entry.root} — same callee and caller rows as before the pin`,
      sameCallees && sameCallers,
      `callees ${gotCallees.length}/${entry.callees.length}, callers ${gotCallers.length}/${entry.callers.length}`,
    )
  }
}
check(
  "the comparison actually exercised the UNRESOLVED arm",
  externalSeen > 0,
  externalSeen > 0
    ? `${externalSeen} external callee edges were compared — the arm is covered`
    : "*** ZERO external edges seen: the arm under test never ran, so this proves nothing ***",
)

// ---------------------------------------------------------------------------
// Self-test: the comparison must be able to FAIL. A gate that cannot distinguish
// the two arms is decoration.
// ---------------------------------------------------------------------------
{
  const same = "a\nb\nc"
  const different = "a\nb\nc\nd"
  const sortedEq = (x: string, y: string): boolean => x.split("\n").sort().join("\n") === y.split("\n").sort().join("\n")
  check(
    "self-test: an added edge IS detected by the comparison",
    !sortedEq(same, different),
    "a comparison that cannot see a difference would pass everything",
  )
  check(
    "self-test: row ORDER alone is not treated as a difference",
    sortedEq(same, "c\nb\na"),
    "the signature sorts, so a plan change that only reorders is not a false positive",
  )
}

rmSync(work, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok).length
console.log(`\nEXTERNAL ARM PLAN: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)