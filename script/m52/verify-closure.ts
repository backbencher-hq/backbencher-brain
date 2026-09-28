// script/m52/verify-closure.ts — M52.X1 (#724)
//
// Closure gate: refuses milestone close unless the verification evidence is
// conformant and every subordinate gate actually passes RIGHT NOW (re-run
// live, never trusted from a stored file). Mirrors the M51 closure pattern.
//
// Checks:
//  C1. Evidence file exists (validation/m52/results/V1.json) and is
//      conformant: parity byte-equal on all three query families, warm
//      latency under budget, zero failed checks.
//  C2. V1 re-run LIVE (parity + real MCP-stdio latency + mutation).
//  C3. Downstream gates re-run LIVE: m13 (health shape/truth), m51 A2
//      (health split still holds), m21 R2 (post-processing consumer).
//  C4. Real-repo receipt: on the actual project index, the embedding
//      aggregates resolve via the covering index (no BLOB heap scan), and
//      the current in-process cost of all three fixed queries is recorded.
//
// Evidence: validation/m52/results/X1.json

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const ROOT = join(import.meta.dirname ?? ".", "../..")

let checks = 0, passed = 0, failed = 0
function check(name: string, cond: boolean, detail: string) {
  checks++
  if (cond) { passed++; console.log(`  ok  ${name} (${detail})`) }
  else { failed++; console.log(`  FAIL ${name} (${detail})`) }
}
function runGate(cmd: string, args: string[], label: string): { ok: boolean; out: string; ms: number } {
  const t = Date.now()
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 480_000 })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  return { ok: r.status === 0, out, ms: Date.now() - t }
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()

  // C1: stored V1 evidence is conformant.
  const v1Path = join(ROOT, "validation/m52/results/V1.json")
  let ev: any = null
  try { ev = JSON.parse(readFileSync(v1Path, "utf8")) } catch {}
  const evOk = !!ev && ev?.gate === "M52.V1" && ev?.checks?.failed === 0 &&
    ev?.parity?.modelRows?.equal === true && ev?.parity?.entities?.equal === true &&
    ev?.parity?.languageRows?.multisetEqual === true && ev?.latency?.warmMs < 2000
  check("C1: V1 evidence exists and is conformant", evOk,
    ev ? `warm=${ev?.latency?.warmMs}ms commit=${String(ev?.commit ?? "").slice(0, 8)}` : "missing/invalid")

  // C2: V1 re-run live.
  const v1 = runGate("npx", ["tsx", "script/m52/verify-v1-parity-latency.ts"], "V1")
  const m = v1.out.match(/V1: (\d+)\/(\d+) passed, (\d+) failed/)
  check("C2: V1 re-run live passes", v1.ok && !!m && Number(m[3]) === 0,
    m ? `${m[1]}/${m[2]} in ${(v1.ms / 1000).toFixed(1)}s` : v1.out.slice(-200))

  // C3: downstream gates re-run live.
  const m13 = runGate("npx", ["tsx", "script/m13/verify-health-integrity.ts"], "m13")
  check("C3a: m13 health-integrity gate passes", m13.ok && m13.out.includes("VERIFIED"),
    `${(m13.ms / 1000).toFixed(1)}s`)
  const m21 = runGate("bun", ["run", "script/m21/verify-postprocessing-passes.ts"], "m21")
  check("C3b: m21 R2 post-processing consumer passes", m21.ok && m21.out.includes("VERIFIED"),
    `${(m21.ms / 1000).toFixed(1)}s`)
  const m51 = runGate("npx", ["tsx", "script/m51/verify-a2-health-split.ts"], "m51A2")
  check("C3c: m51 A2 health-split gate passes", m51.ok && m51.out.includes("11/11"),
    `${(m51.ms / 1000).toFixed(1)}s`)

  // C4: real-repo receipt (read-only, on the actual project index).
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))
  const realPid = getProjectId(ROOT) as any
  const realDbPath = BrainDatabase.getDbPath(realPid as any)
  const dbExists = existsSync(realDbPath) && statSync(realDbPath).size > 100_000_000
  if (dbExists) {
    BrainDatabase.registerPath(realPid as any, realDbPath)
    const raw = await BrainDatabase.getRawInstance(realPid as any)
    const pid = String(realPid)
    const plan = (raw.prepare("EXPLAIN QUERY PLAN SELECT embedding_model, COUNT(*), GROUP_CONCAT(DISTINCT vector_dimension) FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").get(pid) as any)
    check("C4a: real index answers embedding aggregates via covering index",
      typeof plan?.detail === "string" && plan.detail.includes("brain_embed_health_idx"), plan?.detail ?? "no plan")
    const t1 = Date.now()
    raw.prepare("SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC").all(pid)
    const t2 = Date.now()
    const entities = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any)?.c
    const t3 = Date.now()
    raw.prepare("SELECT f.language AS language, COUNT(DISTINCT f.id) files FROM brain_file f WHERE f.project_id = ? GROUP BY f.language").all(pid)
    const t4 = Date.now()
    console.log(`  receipt: models=${t2 - t1}ms entities(${entities})=${t3 - t2}ms languages=${t4 - t3}ms (in-process, warm)`)
    check("C4b: fixed queries complete in-process under 1000ms each on the real index",
      (t2 - t1) < 1000 && (t3 - t2) < 1000 && (t4 - t3) < 1000,
      `${t2 - t1}/${t3 - t2}/${t4 - t3}ms`)
    BrainDatabase.close(realPid as any)
  } else {
    check("C4: real index present for receipt", false, `no DB at ${realDbPath}`)
  }

  const evidence = {
    gate: "M52.X1", issue: 724, at: new Date().toISOString(), commit,
    subordinate: {
      v1Live: { ok: v1.ok, ms: v1.ms, summary: m ? m[0] : null },
      m13: { ok: m13.ok, ms: m13.ms },
      m21R2: { ok: m21.ok, ms: m21.ms },
      m51A2: { ok: m51.ok, ms: m51.ms },
    },
    storedEvidence: ev ? { warmMs: ev?.latency?.warmMs, parity: ev?.parity, commit: ev?.commit } : null,
    checks: { total: checks, passed, failed },
  }
  mkdirSync(join(ROOT, "validation/m52/results"), { recursive: true })
  writeFileSync(join(ROOT, "validation/m52/results/X1.json"), JSON.stringify(evidence, null, 2))
  console.log(`\nX1: ${passed}/${checks} passed, ${failed} failed → validation/m52/results/X1.json`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
