// script/m59/verify-legacy-zero-heal.ts — M59.A3 (#821)
//
// The invariant: NO write path into brain_relationship may STORE
// line_number = 0 — not even a path fed by rows from a LEGACY index.
//
// Why this gate exists: the three original zero-writers (contains buffer,
// cross-language persister ×2) were fixed in 828ab45f and verified fresh
// (28,186 rows, zero stored zeros). But the incremental repair path re-reads
// rows a pre-M59 build already stored, so a stored 0 could be carried forward
// silently — the invariant would hold on fresh indexes and break on legacy
// ones, the exact silent-regression shape this milestone exists to kill.
//
// ── What changed under this gate (M14.JS, 2026-10) ─────────────────────────
// The old repair path INSERTED a re-spelled copy of each captured row
// (`…:m40`) and dropped the original, so its heal — the inserted copy carrying
// NULL instead of the legacy 0 — was a side effect of re-inserting. That shape
// was removed because the re-spelling made a re-index disagree with a full
// index about the same edge (see script/m14/verify-store-path-parity.ts). The
// repair now RE-POINTS the surviving row by its captured target id.
//
// So this gate was rewritten onto the new contract, and the heal did not go
// away — it MOVED to a statement of its own, scoped to exactly the rows the
// call captured. Two consequences this gate now pins down, both of which the
// old insert-based heal got for free and the new one must earn:
//
//   1. a captured row that CANNOT be re-pointed (its symbol is gone) must
//      still lose its legacy 0 — under the old shape the insert healed it;
//   2. the heal must stay BOUNDED: a legacy 0 on a row this run never touched
//      must survive, because nothing re-stored it. A global `UPDATE … WHERE
//      line_number = 0` would look green here and be wrong: it rewrites rows
//      the run has no evidence about.
//
// RED-GREEN-MUTATION:
//   RED    (before the heal): the repaired legacy row's line_number is 0
//          → this gate FAILS, proving the gap is real and reachable.
//   GREEN  (after the heal): every captured legacy 0 lands as NULL, on the
//          re-pointed rows AND on the unre-pointable remainder.
//   MUTATION: a 0 seeded OUTSIDE the run's scope must survive untouched —
//          which is simultaneously the proof that the gate's zero-predicate
//          can fire (it is not vacuous) and that the heal is bounded.
//
// Real code paths only: the REAL indexer builds the world (schema-conform
// rows, FK-ON), then the production snapshotInEdges() → repairInEdges()
// round-trip, and the REAL incremental write path (reindexFilesParallel — the
// exact function bb_edit / LSP didSave / MCP bb_index mode=file call).

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m59-heal-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const FIXTURE = path.join(EMPTY, "fixture")
const EVIDENCE = path.join(ROOT, "validation/m59/results/legacy-zero-heal.json")

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string, negative = false) => {
  checks.push({ name, passed, detail, negative })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

async function main() {
  mkdirSync(FIXTURE, { recursive: true })
  // Two files so a real CROSS-FILE edge exists. `lib.ts` is the file the run
  // re-indexes (the IN-SCOPE population); `app.ts` holds rows the run never
  // touches (the OUT-OF-SCOPE control).
  writeFileSync(
    path.join(FIXTURE, "lib.ts"),
    `export function helper(): number {\n  return 1\n}\n`,
  )
  writeFileSync(
    path.join(FIXTURE, "app.ts"),
    `import { helper } from "./lib"\nexport function main(): number {\n  return helper()\n}\n`,
  )

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, snapshotInEdges, repairInEdges, reindexFilesParallel } = await import(
    path.join(ROOT, "src/ast/parallel-indexer.ts")
  )
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(FIXTURE) as any
  const stats = await indexProjectParallel(pid, FIXTURE, {})
  console.log(`fixture indexed: files=${stats.totalFiles} rels=${stats.relationshipsFound}`)
  const raw = await BrainDatabase.getRawInstance(pid)

  const zeroCount = () =>
    (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND line_number = 0`).get(pid) as any).c as number
  const fileId = (rel: string) => `${pid}:${rel}`

  // ── A. the FRESH write path stores no zero (the M59 invariant, pre-legacy) ──
  check("fresh-index-stores-no-zero", zeroCount() === 0, `rows carrying 0 after a fresh index: ${zeroCount()}`)

  // ── pick the two real rows the legacy world will be seeded on ─────────────
  // IN-SCOPE: a cross-file edge whose TARGET symbol lives in lib.ts — the file
  // the re-index re-stores, so the FK clears its pointer and the repair owns it.
  const inScope = raw
    .prepare(
      `SELECT r.id, r.line_number ln, r.target_external te, r.target_symbol_id tid, tf.id targetFileId
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol tsym ON tsym.id = r.target_symbol_id
       JOIN brain_file tf ON tf.id = tsym.file_id
       WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL
         AND r.target_external IS NOT NULL AND r.target_external != ''
         AND s.file_id != tf.id AND tf.relative_path = 'lib.ts'
       LIMIT 1`,
    )
    .get(pid) as { id: string; ln: number | null; te: string; tid: string; targetFileId: string } | undefined
  if (!inScope) throw new Error("fixture produced no resolvable cross-file edge into lib.ts; cannot test the repair path")

  // OUT-OF-SCOPE: a row whose target symbol lives in app.ts — outside the file
  // this run re-indexes. It is the mutation control AND the boundedness proof.
  const outScope = raw
    .prepare(
      `SELECT r.id, r.target_symbol_id tid
       FROM brain_relationship r
       JOIN brain_symbol tsym ON tsym.id = r.target_symbol_id
       JOIN brain_file tf ON tf.id = tsym.file_id
       WHERE r.project_id = ? AND tf.relative_path = 'app.ts'
       LIMIT 1`,
    )
    .get(pid) as { id: string; tid: string } | undefined
  if (!outScope) throw new Error("fixture produced no row targeting app.ts; cannot test that the heal is bounded")

  // ---- seed the LEGACY world on REAL rows: stored line_number = 0
  raw.prepare(`UPDATE brain_relationship SET line_number = 0 WHERE id IN (?, ?)`).run(inScope.id, outScope.id)
  const seeded = raw
    .prepare(`SELECT id, line_number ln FROM brain_relationship WHERE id IN (?, ?)`)
    .all(inScope.id, outScope.id) as Array<{ id: string; ln: number | null }>
  if (seeded.length !== 2 || seeded.some((r) => r.ln !== 0)) throw new Error("legacy seeding failed")
  console.log(`legacy world seeded: in-scope ${inScope.id} and out-of-scope ${outScope.id} carry line_number = 0`)

  // ── B. capture contract: the row is captured BY IDENTITY, 0 and all ───────
  // The repair re-points by id and cannot survive a capture that misses it or
  // normalises it, so the snapshot is asserted on the row's own id — the field
  // the old insert-based shape did not need and did not have.
  const snapshot = await snapshotInEdges(pid, [inScope.targetFileId])
  const captured = snapshot.find((r) => r.id === inScope.id)
  check(
    "snapshot-captures-by-identity",
    !!captured && captured.line_number === 0 && captured.target_symbol_id === inScope.tid,
    captured
      ? `captured id preserved with line_number=${captured.line_number} target=${captured.target_symbol_id === inScope.tid ? "same" : "DIFFERENT"}`
      : `row ${inScope.id} not captured in ${snapshot.length} rows`,
  )

  // ── C. the REAL write path (what `bb index --changed` / bb_edit / LSP run) ─
  // Seed state: the row points at live symbol `helper`, so the store clears the
  // pointer (FK ON DELETE SET NULL) and the repair must put it back — and the
  // legacy 0 must not survive the round-trip.
  const rt = await reindexFilesParallel(pid, FIXTURE, [{ path: path.join(FIXTURE, "lib.ts"), type: "modified" }], {
    logger: { log: () => {}, write: () => {} } as any,
  })
  const after = raw
    .prepare(`SELECT id, line_number ln, target_symbol_id tid FROM brain_relationship WHERE id = ?`)
    .get(inScope.id) as { id: string; ln: number | null; tid: string | null } | undefined
  check("reindex-keeps-the-row", !!after, after ? `row survives the round-trip` : `row ${inScope.id} VANISHED — the store deleted a row it cannot re-emit`)
  check(
    "reindex-repoints-the-row",
    !!after && after.tid === inScope.tid,
    `target after re-index: ${after?.tid === inScope.tid ? "restored to the same symbol" : String(after?.tid)}`,
  )
  check(
    "no-zero-through-the-real-write-path",
    !!after && after.ln !== 0,
    `row's line_number after the round-trip: ${JSON.stringify(after?.ln)} (was 0)`,
  )
  check(
    "heal-count-is-reported",
    (rt as any).derived?.healedZeroLines === 1,
    `derived.healedZeroLines = ${JSON.stringify((rt as any).derived?.healedZeroLines)} (expected exactly the 1 captured legacy row)`,
  )
  check(
    "reindex-reports-the-repoint",
    ((rt as any).derived?.repairedInEdges ?? 0) >= 1,
    `derived.repairedInEdges = ${JSON.stringify((rt as any).derived?.repairedInEdges)}`,
  )

  // ── D. the heal is BOUNDED: the untouched file's legacy 0 survives ────────
  // Nothing re-stored `app.ts`, so nothing may rewrite its rows. A global
  // `WHERE line_number = 0` sweep would fail this check while looking greener
  // on the others.
  const control = raw.prepare(`SELECT line_number ln FROM brain_relationship WHERE id = ?`).get(outScope.id) as { ln: number | null } | undefined
  check(
    "heal-is-scoped-to-the-captured-rows",
    !!control && control.ln === 0,
    `out-of-scope row (target in app.ts, never re-stored) still carries ${JSON.stringify(control?.ln)} — the heal did not become a global sweep`,
    true,
  )

  // ── E. the unre-pointable remainder is STILL healed ──────────────────────
  // The old insert-based heal covered a captured row whose symbol had vanished
  // as a side effect of inserting. Nothing is inserted now, so this is the case
  // the new heal has to earn: seed the 0 again, take the target symbol away,
  // and call the repair directly.
  raw.prepare(`UPDATE brain_relationship SET line_number = 0 WHERE id = ?`).run(inScope.id)
  // Capture FIRST — the same ordering the production path has (the snapshot is
  // taken before the store runs). The snapshot query joins the target SYMBOL,
  // so capturing after the symbol is gone would find nothing: that is the
  // contract, not a convenience — a pointer the FK has already cleared is
  // invisible to the join, and the store runs after the capture for exactly
  // this reason.
  const orphanSnapshot = await snapshotInEdges(pid, [inScope.targetFileId])
  check(
    "capture-precedes-the-store",
    orphanSnapshot.some((r) => r.id === inScope.id),
    `snapshot taken while the pointer is live holds the row (${orphanSnapshot.length} rows captured); a capture taken after the FK cleared it could not`,
  )
  raw.prepare(`DELETE FROM brain_symbol WHERE id = ?`).run(inScope.tid)
  const orphaned = raw.prepare(`SELECT line_number ln, target_symbol_id tid FROM brain_relationship WHERE id = ?`).get(inScope.id) as {
    ln: number | null
    tid: string | null
  }
  check(
    "fk-clears-the-pointer-not-the-row",
    orphaned.tid === null,
    `after the target symbol was removed the pointer is ${JSON.stringify(orphaned.tid)} and the row still exists (M14.JS store contract)`,
  )
  const out: { stillUnresolved?: number; healedZeroLines?: number } = {}
  const rePointed = await repairInEdges(pid, orphanSnapshot, {
    fileIds: [inScope.targetFileId],
    out,
  })
  const healedRow = raw.prepare(`SELECT line_number ln FROM brain_relationship WHERE id = ?`).get(inScope.id) as {
    ln: number | null
  }
  check(
    "unrepointable-row-is-still-healed",
    healedRow.ln === null,
    `row that could not be re-pointed carries line_number=${JSON.stringify(healedRow.ln)} (re-pointed rows this call: ${rePointed})`,
  )
  check(
    "remainder-is-reported-not-hidden",
    (out.stillUnresolved ?? 0) >= 1,
    `repairOut.stillUnresolved = ${JSON.stringify(out.stillUnresolved)} — the surviving unresolved row is named, not counted as repaired`,
  )
  check("repair-writes-no-zero", (out.healedZeroLines ?? 0) >= 1, `repairOut.healedZeroLines = ${JSON.stringify(out.healedZeroLines)}`)

  // ── F. MUTATION: the detector fires on the state the sweep would hide ────
  // `zeroCount()` is the predicate every "no 0" check above uses. It must be
  // shown able to SEE a 0 — the out-of-scope row is exactly that state.
  const zerosNow = zeroCount()
  check(
    "mutation-detected",
    zerosNow >= 1,
    `rows still carrying 0 in the DB: ${zerosNow} — the predicate fires on this state (it is not vacuously true above)`,
    true,
  )
  // And the scoped scope is provably empty: no row whose TARGET lives in the
  // re-indexed file carries a 0 any more.
  const zerosInScope = (
    raw
      .prepare(
        `SELECT COUNT(*) c FROM brain_relationship r
         JOIN brain_symbol t ON t.id = r.target_symbol_id
         JOIN brain_file f ON f.id = t.file_id
         WHERE r.project_id = ? AND f.relative_path = 'lib.ts' AND r.line_number = 0`,
      )
      .get(pid) as any
  ).c as number
  check("no-zero-remains-in-the-reindexed-file", zerosInScope === 0, `rows carrying 0 with a target in lib.ts: ${zerosInScope}`)

  // The DB-wide claim, stated where it can be checked: the only 0 left is the
  // out-of-scope legacy control row. Everything this run could re-store was
  // healed. (The control is why this is not simply "no zeros": a global sweep
  // would make the claim true by rewriting rows the run never saw.)
  const otherZeros = (
    raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND line_number = 0 AND id != ?`).get(pid, outScope.id) as any
  ).c as number
  check(
    "only-the-out-of-scope-legacy-row-keeps-a-zero",
    otherZeros === 0,
    `rows carrying 0 other than the untouched control row: ${otherZeros}`,
  )

  // ---- verdict + evidence written by the run
  const failed = checks.filter((c) => !c.passed)
  const passed = failed.length === 0
  const negatives = checks.filter((c) => c.negative).length
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  // M61: evidence is written SEALED (the library's writer), so a record whose
  // content moved carries a matching envelope instead of a stale or absent one.
  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  writeSealed(EVIDENCE, {
    gate: "M59.A3",
    issue: "#821",
    at: new Date().toISOString(),
    atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    treeModifiedInputs: execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("?? ")).length,
    command: "bun run script/m59/verify-legacy-zero-heal.ts",
    status: passed ? "pass" : "fail",
    checks,
    negativeCases: negatives,
    contract: "M14.JS repair: surviving-row re-point by captured id (+ name only inside the re-stored files) with a scoped heal of legacy line_number = 0",
    note: "verifies the repair path (snapshotInEdges → repairInEdges) AND the real incremental write path against a legacy-index world seeded on REAL indexed rows; the out-of-scope legacy 0 is kept as the boundedness + detector control",
  })
  console.log(`\nevidence: ${EVIDENCE}`)
  if (!passed) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — legacy zeros cannot re-enter through the repair or the write path.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
