// script/m54/verify-closure.ts — M54.X1 (#729)
// Closure gate: refuses milestone close unless every issue has conformant,
// current evidence and every subordinate + downstream gate passes RIGHT NOW
// (re-run live, not trusted from evidence files).
//
// Honesty rules (m31/m35/m52 pattern):
//  - gates are executed fresh in this run; stale evidence alone never passes
//  - the real-repo receipt asserts BOTH halves: 0 true FK danglers AND that
//    the by-design NULL-source external edges are still present (proving the
//    heal did not delete real graph data)
//  - the invariant must appear verbatim in docs/m54/PLAN.md
//  - any failure exits non-zero; nothing is excused

import { spawnSync, execFileSync } from "node:child_process"
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
let pass = 0
let fail = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) { pass++; console.log(`✅ ${name}: ${detail}`) }
  else { fail++; failures.push(`${name}: ${detail}`); console.log(`❌ ${name}: ${detail}`) }
}

const runGate = (cmd: string, args: string[], label: string, timeoutMs = 600_000) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs })
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(-2).join(" | ")
  return { ok: r.status === 0, detail: `${label}: exit=${r.status} ${tail.slice(0, 220)}` }
}

// ── 1. Invariant verbatim in the PLAN ───────────────────────────────────────
{
  const plan = existsSync(path.join(ROOT, "docs/m54/PLAN.md")) ? readFileSync(path.join(ROOT, "docs/m54/PLAN.md"), "utf8") : ""
  const invariant = "Every SQLite connection bb opens enforces the declared foreign keys"
  check("X1.plan-invariant", plan.includes(invariant), plan.includes(invariant) ? "invariant present verbatim in docs/m54/PLAN.md" : "invariant MISSING from PLAN")
}

// ── 2. Live re-run of subordinate gates ─────────────────────────────────────
const p1 = runGate("bun", ["run", "script/m54/verify-p1-fk.ts"], "P1")
check("X1.live-P1", p1.ok, p1.detail)
const p2 = runGate("npx", ["tsx", "script/m54/verify-p2-stdio.ts"], "P2")
check("X1.live-P2", p2.ok, p2.detail)

// ── 3. Live re-run of downstream gates (the M54-touched surfaces) ───────────
const d2 = runGate("bun", ["run", "script/m21/verify-sqlite-runtime-policy.ts"], "m21.D2")
check("X1.downstream-m21-D2", d2.ok, d2.detail)
const a1 = runGate("npx", ["tsx", "script/m51/verify-a1-owner-integrity.ts"], "m51.A1")
check("X1.downstream-m51-A1", a1.ok, a1.detail)
const a2 = runGate("npx", ["tsx", "script/m51/verify-a2-health-split.ts"], "m51.A2")
check("X1.downstream-m51-A2", a2.ok, a2.detail)
const h3 = runGate("npx", ["tsx", "script/m13/verify-health-integrity.ts"], "m13.H3")
check("X1.downstream-m13-H3", h3.ok, h3.detail)
const r2 = runGate("bun", ["run", "script/m21/verify-postprocessing-passes.ts"], "m21.R2")
check("X1.downstream-m21-R2", r2.ok, r2.detail)
const v1 = runGate("npx", ["tsx", "script/m52/verify-v1-parity-latency.ts"], "m52.V1")
check("X1.downstream-m52-V1", v1.ok, v1.detail)

// ── 4. Evidence conformance ─────────────────────────────────────────────────
{
  for (const [code, issue] of [["P1", 727], ["P2", 728]] as const) {
    const f = path.join(ROOT, "validation/m54/results", `${code}.json`)
    if (!existsSync(f)) { check(`X1.evidence-${code}`, false, `missing ${f}`); continue }
    try {
      const ev = JSON.parse(readFileSync(f, "utf8"))
      const ok = ev.status === "verified" && ev.failed === 0 && ev.issue === issue && typeof ev.commit === "string" && ev.commit.length >= 7
      check(`X1.evidence-${code}`, ok, `status=${ev.status} failed=${ev.failed} issue=${ev.issue} commit=${String(ev.commit).slice(0, 8)}`)
    } catch (e: any) { check(`X1.evidence-${code}`, false, `unparseable: ${e.message}`) }
  }
}

// ── 5. Real-repo receipt: both halves, measured now ─────────────────────────
{
  const receiptScript = path.join(ROOT, "script/m54/tmp-receipt.ts")
  writeFileSync(receiptScript, `
    const { createHash } = await import("node:crypto")
    const { realpathSync } = await import("node:fs")
    const path = await import("node:path")
    const pid = createHash("sha1").update(realpathSync(${JSON.stringify(ROOT)})).digest("hex")
    const dbPath = path.join("$HOME/.bb", "projects", pid, "brain.db")
    const { openDatabase } = await import(${JSON.stringify(path.join(ROOT, "src/storage/db.bun.ts"))})
    const db = openDatabase(dbPath, { readonly: true })
    const fk = (db.native as any).prepare("PRAGMA foreign_keys").get() as any
    const danglers = db.prepare(\`SELECT COUNT(*) c FROM brain_relationship r
      WHERE r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)\`).get() as any
    const nullSource = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL").get() as any
    const withName = db.prepare(\`SELECT COUNT(*) c FROM brain_relationship
      WHERE source_symbol_id IS NULL AND source_external IS NOT NULL AND source_external != ''\`).get() as any
    const orphanSyms = db.prepare(\`SELECT COUNT(*) c FROM brain_symbol s
      WHERE s.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brain_file f WHERE f.id = s.file_id)\`).get() as any
    db.close()
    console.log(JSON.stringify({ fk: fk.foreign_keys, danglers: danglers.c, nullSource: nullSource.c, withName: withName.c, orphanSyms: orphanSyms.c }))
  `)
  const r = spawnSync("bun", ["run", receiptScript], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
  rmSync(receiptScript, { force: true })
  let rec: any = null
  try { rec = JSON.parse(r.stdout.trim().split("\n").pop() ?? "") } catch {}
  if (!rec) {
    check("X1.real-repo-receipt", false, `receipt probe failed: ${(r.stderr || r.stdout).slice(0, 200)}`)
  } else {
    check("X1.real-repo-fk", rec.fk === 1, `ro open FK=${rec.fk} (expected 1)`)
    check("X1.real-repo-no-danglers", rec.danglers === 0, `true dangling-source rows=${rec.danglers} (expected 0)`)
    check("X1.real-repo-no-orphan-symbols", rec.orphanSyms === 0, `orphan symbol rows=${rec.orphanSyms} (expected 0)`)
    check("X1.real-repo-by-design-preserved", rec.nullSource > 0 && rec.withName === rec.nullSource,
      `by-design NULL-source external edges: ${rec.nullSource} (all ${rec.withName} carry source_external — the heal deleted none of them)`)
  }
}

// ── stamp ───────────────────────────────────────────────────────────────────
{
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  mkdirSync(path.join(ROOT, "validation/m54/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m54/results/X1.json"), JSON.stringify({
    gate: "M54.X1", issue: 729, milestone: "M54", at: new Date().toISOString(), commit,
    checks: pass + fail, passed: pass, failed: fail,
    verifierCommand: "npx tsx script/m54/verify-closure.ts",
    status: fail === 0 ? "verified" : "known-gap",
    downstream: { "m21.D2": d2.ok, "m51.A1": a1.ok, "m51.A2": a2.ok, "m13.H3": h3.ok, "m21.R2": r2.ok, "m52.V1": v1.ok },
  }, null, 2) + "\n")
}

console.log(`\n=== M54.X1 CLOSURE: ${pass} pass, ${fail} fail ===`)
if (fail > 0) { console.log(failures.map(f => `  ✗ ${f}`).join("\n")); process.exit(1) }
