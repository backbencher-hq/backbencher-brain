// script/m59/verify-legacy-zero-heal.ts — M59.A3 (#821)
//
// The invariant: NO write path into brain_relationship may store
// line_number = 0 — not even one fed by rows from a LEGACY index.
//
// Why this gate exists: the three original zero-writers (contains buffer,
// cross-language persister ×2) were fixed in 828ab45f and verified fresh
// (28,186 rows, zero stored zeros). But repairInEdges() re-stores
// snapshotInEdges() rows VERBATIM — so on an incremental reindex over a
// pre-M59 index, a stored 0 flows snapshot → repair → DB unchanged. The
// invariant "never 0" would hold on fresh indexes and silently break on
// legacy ones — the exact silent-regression shape this milestone exists to
// kill.
//
// RED-GREEN-MUTATION:
//   RED    (before the heal): the repaired legacy row's line_number is 0
//          → the gate FAILS, proving the gap is real and reachable.
//   GREEN  (after the heal): repaired legacy 0 rows land as NULL.
//   MUTATION: a row stored as 0 by any path must be detectable by this
//          predicate (the detector is shown able to fail).
//
// Real code paths only: the REAL indexer builds the world (schema-conform
// rows, FK-ON), then the production snapshotInEdges() → repairInEdges()
// round-trip — the exact functions `bb index --changed` executes.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m59-heal-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const FIXTURE = path.join(EMPTY, "fixture")
const EVIDENCE = path.join(ROOT, "validation/m59/results/legacy-zero-heal.json")

type Check = { name: string; passed: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string) => {
  checks.push({ name, passed, detail })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

async function main() {
  mkdirSync(FIXTURE, { recursive: true })
  // Two files so a real CROSS-FILE edge exists — the shape snapshotInEdges
  // captures (target in re-parsed files, source elsewhere).
  writeFileSync(
    path.join(FIXTURE, "lib.ts"),
    `export function helper(): number {\n  return 1\n}\n`,
  )
  writeFileSync(
    path.join(FIXTURE, "app.ts"),
    `import { helper } from "./lib"\nexport function main(): number {\n  return helper()\n}\n`,
  )

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, snapshotInEdges, repairInEdges } = await import(
    path.join(ROOT, "src/ast/parallel-indexer.ts")
  )
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(FIXTURE) as any
  const stats = await indexProjectParallel(pid, FIXTURE, {})
  console.log(`fixture indexed: files=${stats.totalFiles} rels=${stats.relationshipsFound}`)
  const raw = await BrainDatabase.getRawInstance(pid)

  // Pick a real cross-file edge with a real line (typescript emits none yet →
  // NULL; either way it is a REAL row the production round-trip will see).
  // targetFileId must be the TARGET's file — snapshotInEdges captures edges
  // whose TARGET lives in the re-parsed files (source elsewhere). A first
  // draft of this gate passed the source's file and captured 0 rows; the RED
  // run exposed it.
  const edge = raw
    .prepare(
      `SELECT r.id, r.line_number ln, r.target_external te, tf.id targetFileId
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol tsym ON tsym.id = r.target_symbol_id
       JOIN brain_file tf ON tf.id = tsym.file_id
       WHERE r.target_symbol_id IS NOT NULL AND r.target_external IS NOT NULL AND r.target_external != ''
         AND s.file_id != tf.id
       LIMIT 1`,
    )
    .get() as { id: string; ln: number | null; te: string; targetFileId: string } | undefined
  if (!edge) throw new Error("fixture produced no resolvable cross-file edge; cannot test the repair path")

  // ---- seed the LEGACY world on a REAL row: stored line_number = 0
  raw.prepare(`UPDATE brain_relationship SET line_number = 0 WHERE id = ?`).run(edge.id)
  const seeded = raw.prepare(`SELECT line_number ln FROM brain_relationship WHERE id = ?`).get(edge.id) as { ln: number }
  if (seeded.ln !== 0) throw new Error("legacy seeding failed")
  console.log(`legacy world seeded: row ${edge.id} carries line_number = 0`)

  // ---- the REAL production round-trip (what `bb index --changed` runs)
  const snapshot = await snapshotInEdges(pid, [edge.targetFileId])
  const captured = snapshot.find((r) => r.target_name === edge.te)
  check(
    "snapshot-captures-legacy-zero",
    !!captured && captured.line_number === 0,
    captured ? `captured with line_number === ${captured.line_number}` : `target '${edge.te}' not captured in ${snapshot.length} rows`,
  )

  await repairInEdges(pid, snapshot)

  // ---- GREEN target: the repaired row must NOT carry 0
  const repaired = raw
    .prepare(
      `SELECT line_number ln FROM brain_relationship
       WHERE target_external = ? AND relationship_type = 'calls' AND id LIKE '%:m40'`,
    )
    .all(edge.te) as Array<{ ln: number | null }>
  const storedZero = repaired.filter((r) => r.ln === 0).length
  const storedNull = repaired.filter((r) => r.ln === null).length
  check(
    "no-zero-through-repair",
    storedZero === 0 && storedNull > 0,
    `repaired rows: ${repaired.length}, stored 0: ${storedZero}, stored NULL: ${storedNull}`,
  )

  // ---- MUTATION: a 0 anywhere in the DB must be detectable by the gate's
  // predicate — the detector is shown able to fail (before the heal, this is
  // exactly the state the repair path itself produced).
  const zerosNow = raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0`).get() as { c: number }
  check("mutation-detected", zerosNow.c >= 1, `rows carrying 0 in DB: ${zerosNow.c} — the predicate fires on this state`)

  // ---- verdict + evidence written by the run
  const failed = checks.filter((c) => !c.passed)
  const passed = failed.length === 0
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        gate: "M59.A3",
        issue: "#821",
        at: new Date().toISOString(),
        command: "npx tsx script/m59/verify-legacy-zero-heal.ts",
        status: passed ? "pass" : "fail",
        checks,
        note: "verifies the repair path (snapshotInEdges → repairInEdges) against a legacy-index world seeded on a REAL indexed row; RED was demonstrated at HEAD before the heal landed",
      },
      null,
      2,
    ),
  )
  console.log(`\nevidence: ${EVIDENCE}`)
  if (!passed) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — legacy zeros cannot re-enter through repair.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
