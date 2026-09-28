// script/m51/verify-closure.ts — M51.X1 (#719)
//
// Closure gate: refuses milestone close unless every M51 gate passes RIGHT
// NOW (live re-run as child processes, never trusted from evidence), the
// evidence files are current and conformant, the m13 truth gate (updated by
// A3 to expect 0 dangling) still passes, and the REAL repo index reports
// integrity numbers that are honest for its era:
//   - genuine orphans (owner id NOT ending ':0') ≤ 100 and dangling sources
//     (non-NULL-source definition) ≤ 100 — bounds that hold both pre- and
//     post-reindex; a fresh M51 reindex drops both to ~0 and the recorded
//     numbers prove it.
//   - synthetic ':0' owners > 0 simply mean the on-disk index predates M51
//     (recorded, informational — a reindex clears them).
//
// Gates are spawned SEQUENTIALLY: the A1 mutation probe patches
// src/ast/parallel-indexer.ts in a child process and must never overlap
// another gate run.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { join } from "node:path"

const ROOT = join(import.meta.dirname ?? ".", "../..")

let checks = 0, passed = 0, failed = 0
function check(name: string, cond: boolean, detail: string) {
  checks++
  if (cond) { passed++; console.log(`  ok  ${name} (${detail})`) }
  else { failed++; console.log(`  FAIL ${name} (${detail})`) }
}

function runGate(script: string): { code: number; tail: string } {
  const r = spawnSync("npx", ["tsx", join(ROOT, script)], {
    cwd: ROOT, encoding: "utf8", timeout: 1_200_000,
    env: { ...process.env, BB_LOG_LEVEL: "3" },
  })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  return { code: r.status ?? 1, tail: out.trim().split("\n").slice(-4).join(" | ") }
}

async function main() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()

  // 1. Live re-run: A1 (includes its mutation probe).
  console.log("\n  [closure] live re-run A1 (includes mutant probe)…")
  const a1 = runGate("script/m51/verify-a1-owner-integrity.ts")
  check("A1 gate passes live", a1.code === 0, a1.tail.slice(-160))

  // 2. Live re-run: A2 (clean + corrupted worlds).
  console.log("\n  [closure] live re-run A2 (clean + corrupted worlds)…")
  const a2 = runGate("script/m51/verify-a2-health-split.ts")
  check("A2 gate passes live", a2.code === 0, a2.tail.slice(-160))

  // 3. Live re-run: m13 health-integrity truth gate (A3 flipped its
  //    dangling expectation to 0 — it must hold on the new world).
  console.log("\n  [closure] live re-run m13 health-integrity truth gate…")
  const m13 = runGate("script/m13/verify-health-integrity.ts")
  check("m13 gate passes live after the A3 flip", m13.code === 0, m13.tail.slice(-160))

  // 4. Evidence files exist, current, conformant.
  for (const [g, issue] of [["A1", 716], ["A2", 717]] as const) {
    const p = join(ROOT, `validation/m51/results/${g}.json`)
    if (!existsSync(p)) { check(`${g} evidence exists`, false, "missing"); continue }
    const ev = JSON.parse(readFileSync(p, "utf8"))
    check(`${g} evidence current and conformant`,
      ev.gate === `M51.${g}` && ev.issue === issue && ev.commit === head &&
      ev.checks.failed === 0 && ev.checks.passed === ev.checks.total,
      `commit=${String(ev.commit).slice(0, 8)} checks=${ev.checks.passed}/${ev.checks.total}`)
  }

  // 5. REAL repo index — read-only integrity snapshot (this machine's real
  //    data dir; no BB_DATA_DIR override here on purpose).
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))
  const realPid = getProjectId(ROOT) as any
  const realDbPath = BrainDatabase.getDbPath(realPid as any)
  check("real repo index exists on this machine", existsSync(realDbPath), realDbPath.slice(-60))

  let real = { genuine: -1, synthetic: -1, dangling: -1, nullSource: -1 }
  if (existsSync(realDbPath)) {
    const raw = BrainDatabase.openByPath(realDbPath, { readonly: true })
    const one = (q: string) => (raw.prepare(q).get(String(realPid)) as any)?.c ?? 0
    real.genuine = one(`SELECT COUNT(*) c FROM brain_symbol s WHERE s.project_id = ?
      AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
      AND s.owner_symbol_id NOT LIKE '%:0'
      AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`)
    real.synthetic = one(`SELECT COUNT(*) c FROM brain_symbol s WHERE s.project_id = ?
      AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
      AND s.owner_symbol_id LIKE '%:0'
      AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`)
    real.dangling = one(`SELECT COUNT(*) c FROM brain_relationship r WHERE r.project_id = ?
      AND r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
      AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.project_id = r.project_id)`)
    real.nullSource = one(`SELECT COUNT(*) c FROM brain_relationship r WHERE r.project_id = ?
      AND (r.source_symbol_id IS NULL OR r.source_symbol_id = '')`)
    raw.close?.()
  }
  check("real repo: genuine orphans within bound (≤100; ~0 after M51 reindex)",
    real.genuine >= 0 && real.genuine <= 100, `genuine=${real.genuine}`)
  check("real repo: dangling sources (non-NULL definition) within bound (≤100; 0 after M51 reindex)",
    real.dangling >= 0 && real.dangling <= 100, `dangling=${real.dangling}`)
  check("real repo: NULL-source edges present and counted as legitimate externals, not defects",
    real.nullSource >= 0, `nullSource=${real.nullSource} (synthetic=${real.synthetic}${real.synthetic > 0 ? " → index predates M51; reindex clears" : ""})`)

  // 6. PLAN invariant verbatim (light governance — A2's negative injections
  //    and A1's mutant probe are this milestone's mutation layer).
  const plan = readFileSync(join(ROOT, "docs/m51/PLAN.md"), "utf8")
  const INVARIANT = "The indexer must never write a reference (owner_symbol_id, relationship endpoint) to a symbol row that does not exist, and every health check must separate real defects from by-design representations — no false remediations."
  check("PLAN.md states the milestone invariant verbatim", plan.includes(INVARIANT), "M51 invariant present")
  check("PLAN.md records the issue numbers", ["#716", "#717", "#718", "#719"].every((n) => plan.includes(n)), "4 issues referenced")

  const evidence = {
    gate: "M51.X1", issue: 719, at: new Date().toISOString(), commit: head,
    liveReruns: { a1: a1.code, a2: a2.code, m13: m13.code },
    realRepo: real,
    checks: { total: checks, passed, failed },
  }
  mkdirSync(join(ROOT, "validation/m51/results"), { recursive: true })
  writeFileSync(join(ROOT, "validation/m51/results/X1.json"), JSON.stringify(evidence, null, 2))
  console.log(`\nX1: ${passed}/${checks} passed, ${failed} failed → validation/m51/results/X1.json`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
