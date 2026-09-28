// script/m51/verify-a2-health-split.ts — M51.A2 (#717)
//
// Proves the health checks separate signal from by-design noise, through the
// REAL runIndexHealthCheck pipeline:
//   CLEAN WORLD (real indexer, real fixture):
//     C1. "Orphan Owner References" reports 0 / ok on a fresh M51 index.
//     C2. "Synthetic Container References" exists and is informational (ok).
//     C3. "Dangling Source Relationships" reports 0 / ok.
//     C4. Remediation strings never recommend the disproven "--force rebuild"
//         cure as guaranteed.
//   CORRUPTED WORLD (real DB copy, injected defects via registerPath seam):
//     N1. 12 injected GENUINE orphans (non-':0' ghost owners) → the genuine
//         check counts exactly 12 and fires (warn), synthetic stays clean.
//     N2. 1 injected ':0' synthetic owner → counted ONLY by the synthetic
//         check, never by the genuine one.
//     N3. 1 injected dangling edge with a REAL source id → dangling counts
//         exactly 1.
//     N4. 2 injected NULL-source edges (with and without source_external) →
//         counted by NEITHER dangling nor orphan checks.
//   A gate that cannot fail is not a gate: N1–N4 are the failure proofs.

process.env.BB_DATA_DIR = mkdtempSync(join(tmpdir(), "bb-m51-a2-"))
process.env.BB_LOG_LEVEL = "3"

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dirname ?? ".", "../..")

let checks = 0, passed = 0, failed = 0
function check(name: string, cond: boolean, detail: string) {
  checks++
  if (cond) { passed++; console.log(`  ok  ${name} (${detail})`) }
  else { failed++; console.log(`  FAIL ${name} (${detail})`) }
}

function findCheck(report: any, name: string) {
  return (report.checks as any[]).find((c) => c.name === name)
}

async function main() {
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))
  const { runIndexHealthCheck } = await import(join(ROOT, "src/brain/brain-index-health"))

  // ── Clean world ──────────────────────────────────────────────────────────
  const fixture = mkdtempSync(join(tmpdir(), "bb-m51-a2-fixture-"))
  mkdirSync(join(fixture, "src"), { recursive: true })
  writeFileSync(join(fixture, "package.json"), JSON.stringify({
    name: "m51-a2", version: "1.0.0", scripts: { build: "tsc -p ." },
    dependencies: { leftpad: "^1.3.0" },
  }, null, 2))
  writeFileSync(join(fixture, "src", "user.ts"), [
    "export interface User { id: string; name: string }",
    "export const DEFAULT_NAME = 'anon'",
    "export function createUser(name: string): User {",
    "  return { id: '1', name }",
    "}",
    "export class UserService {",
    "  getUser(id: string): User | null {",
    "    return null",
    "  }",
    "}",
  ].join("\n") + "\n")
  // Top-level symbols carry NULL owners post-M51 — this file guarantees the
  // 13 NULL-owner rows the corrupted-world injections require.
  writeFileSync(join(fixture, "src", "util.ts"), Array.from({ length: 12 }, (_, i) =>
    `export const utilConst${i} = ${i}`
  ).join("\n") + "\n")

  const pid = getProjectId(fixture) as any
  await indexProjectParallel(pid, fixture)
  const clean = await runIndexHealthCheck(pid)

  const orphan = findCheck(clean, "Orphan Owner References")
  const synthetic = findCheck(clean, "Synthetic Container References")
  const dangling = findCheck(clean, "Dangling Source Relationships")

  check("C1: orphan-owner check exists and reports 0/ok on a fresh M51 index",
    !!orphan && orphan.value === 0 && orphan.status === "ok", orphan ? `value=${orphan.value} status=${orphan.status}` : "missing")
  check("C2: synthetic-container check exists and is informational (ok)",
    !!synthetic && synthetic.status === "ok", synthetic ? `value=${synthetic.value} status=${synthetic.status}` : "missing")
  check("C3: dangling-source check reports 0/ok on a fresh M51 index",
    !!dangling && dangling.value === 0 && dangling.status === "ok", dangling ? `value=${dangling.value} status=${dangling.status}` : "missing")
  check("C4: remediations never recommend the disproven unconditional --force cure",
    [orphan, dangling].every((c) => !c?.remediation || (!c.remediation.includes("Run bb_health with refresh=true and force=true"))),
    "old false remediation string absent")

  // ── Corrupted world (real DB copy + registerPath seam) ───────────────────────
  // Redirect the ORIGINAL pid to the corrupted copy: the copied rows keep
  // their real project_id, so health queries filtered by that pid see exactly
  // the copy — and nothing else in this process touches the real DB.
  const dbPath = BrainDatabase.getDbPath(pid as any)
  const corruptedPath = join(tmpdir(), `bb-m51-a2-corrupted-${Date.now()}.db`)
  // WAL-aware copy: the indexer runs in WAL mode, so a plain file copy can
  // miss un-checkpointed commits. Force a truncate checkpoint on the source
  // handle first, THEN copy.
  const rawOrig = await BrainDatabase.getRawInstance(pid as any)
  rawOrig.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()
  copyFileSync(dbPath, corruptedPath)
  BrainDatabase.registerPath(pid as any, corruptedPath)
  try {
    const raw2 = await BrainDatabase.getRawInstance(pid as any)
    const P = String(pid)

    const copyRows = (raw2.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
    check("corrupted copy carries the full symbol table (WAL-aware copy)", copyRows >= 15, `${copyRows} rows in copy`)
    // The schema declares FKs on owner/source ids but enforcement is
    // runtime-dependent (better-sqlite3 ON by default, bun:sqlite OFF — the
    // production indexer runs under Bun, which is how the pre-M51 orphans
    // were ever writable). Disable for the injection block so the corrupted
    // world mirrors what Bun wrote historically.
    raw2.exec("PRAGMA foreign_keys = OFF")

    // 13 distinct LEAF rows (constants nothing owns): the injections
    // overwrite owner values, so prior owner state is irrelevant — what
    // matters is that the corrupted rows are not the owner of anything else,
    // keeping the post-injection counts exactly deterministic.
    const leafNames = [...Array.from({ length: 12 }, (_, k) => `utilConst${k}`), "DEFAULT_NAME"]
    const leafRows = raw2.prepare(
      `SELECT id FROM brain_symbol WHERE name IN (${leafNames.map(() => "?").join(",")}) LIMIT 13`
    ).all(...leafNames) as any[]
    check("fixture supplies 13 leaf rows for deterministic injection", leafRows.length === 13, `${leafRows.length} rows`)
    let i = 0
    for (const r of leafRows.slice(0, 12)) {
      raw2.prepare("UPDATE brain_symbol SET owner_symbol_id = ? WHERE id = ?")
        .run(`${P}:src/user.ts:Ghost${i++}:42`, r.id)
    }
    // N2: one synthetic ':0' owner on the 13th row.
    raw2.prepare("UPDATE brain_symbol SET owner_symbol_id = ? WHERE id = ?")
      .run(`${P}:src/user.ts:PhantomModule:0`, leafRows[12].id)
    // N3: one REAL dangling edge (non-NULL source id, no such symbol).
    raw2.prepare(`INSERT INTO brain_relationship
      (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, context, line_number, is_cross_file, is_cross_language, bridge_mechanism, metadata, time_created, time_updated)
      VALUES (?, ?, ?, NULL, NULL, 'm51Target', 'calls', 1.0, NULL, 0, 0, 0, NULL, NULL, strftime('%Y-%m-%d %H:%M:%f','now'), strftime('%Y-%m-%d %H:%M:%f','now'))`)
      .run("m51-a2-dangling-1", P, `${P}:src/user.ts:NoSuchSymbol:99`)
    // N4: two NULL-source edges — must be invisible to the dangling count.
    const nullEdge = (id: string, ext: string | null) => raw2.prepare(`INSERT INTO brain_relationship
      (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, context, line_number, is_cross_file, is_cross_language, bridge_mechanism, metadata, time_created, time_updated)
      VALUES (?, ?, NULL, NULL, ?, 'm51Target2', 'calls', 1.0, NULL, 0, 0, 0, NULL, NULL, strftime('%Y-%m-%d %H:%M:%f','now'), strftime('%Y-%m-%d %H:%M:%f','now'))`)
      .run(id, P, ext)
    nullEdge("m51-a2-ext-1", "SomeExternal.thing")
    nullEdge("m51-a2-ext-2", null)

    const corrupted = await runIndexHealthCheck(pid as any)
    const o2 = findCheck(corrupted, "Orphan Owner References")
    const s2 = findCheck(corrupted, "Synthetic Container References")
    const d2 = findCheck(corrupted, "Dangling Source Relationships")

    check("N1: genuine orphan count is exactly 12 and fires (warn)",
      o2?.value === 12 && o2?.status === "warn", o2 ? `value=${o2.value} status=${o2.status}` : "missing")
    check("N2: the ':0' injection is counted ONLY as synthetic (1), not genuine",
      s2?.value === 1 && o2?.value === 12, s2 ? `synthetic=${s2.value}` : "missing")
    check("N3: dangling count is exactly 1 (the real dangling edge)",
      d2?.value === 1, d2 ? `value=${d2.value}` : "missing")
    check("N4: NULL-source edges (± external) counted by no integrity check",
      d2?.value === 1 && o2?.value === 12, "2 NULL-source edges invisible")
    check("corrupted report actually degraded overall health",
      corrupted.overallHealth < clean.overallHealth, `clean=${clean.overallHealth} corrupted=${corrupted.overallHealth}`)

    raw2.close?.()
  } finally {
    BrainDatabase.close(pid as any)
    BrainDatabase.clearPathOverrides()
    rmSync(corruptedPath, { force: true })
  }

  // Cleanup
  BrainDatabase.close(pid as any)
  rmSync(fixture, { recursive: true, force: true })
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })

  const { execFileSync } = await import("node:child_process")
  const { writeFileSync: wf, mkdirSync: ms } = await import("node:fs")
  const evidence = {
    gate: "M51.A2", issue: 717, at: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
    clean: { orphan: orphan?.value, synthetic: synthetic?.value, dangling: dangling?.value, overallHealth: clean.overallHealth },
    corrupted: { injectedGenuine: 12, injectedSynthetic: 1, injectedDangling: 1, injectedNullSource: 2 },
    checks: { total: checks, passed, failed },
  }
  ms(join(ROOT, "validation/m51/results"), { recursive: true })
  wf(join(ROOT, "validation/m51/results/A2.json"), JSON.stringify(evidence, null, 2))
  console.log(`\nA2: ${passed}/${checks} passed, ${failed} failed → validation/m51/results/A2.json`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
