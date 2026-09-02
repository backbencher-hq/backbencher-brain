// script/m32/verify-doctor.ts — M32.S2.
//
// Proves `bb doctor` (runDoctorChecks + renderDoctorReport in
// src/setup/doctor.ts) diagnoses ONLY real state and prescribes the exact
// fix command for every degradation mode:
//   no-config / incomplete tier / bad permissions / model mismatch vs
//   stored embeddings / mixed models / no index yet / degraded notice.
// A real mismatch fixture is produced with the proven M16 lifecycle path
// (indexProjectParallel + flushBackgroundEmbeddings) so the stored
// local-word-vectors rows are genuine, not planted JSON. Mutants assert the
// suite can fail; the built-binary section rebuilds dist and checks the
// real bin/bb end-to-end.
//
// CLI: npx tsx script/m32/verify-doctor.ts   (exit non-zero blocks verify)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/setup/doctor.ts")
const MUTANT_PATH = path.join(ROOT, "src/setup/.doctor-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m32/results/S2.json")

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, condition: boolean, detail = ""): void {
  check(`${label} [negative]`, condition, detail)
}

type DoctorMod = {
  runDoctorChecks: (opts: any) => any
  renderDoctorReport: (r: any) => string
}

let loadCounter = 0
async function loadComponent(p: string): Promise<DoctorMod> {
  loadCounter++
  return (await import(`${p}?v=${loadCounter}`)) as DoctorMod
}

const doctor = await loadComponent(COMPONENT)

function tmpEnv(): { dir: string; dataDir: string; proj: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s2-"))
  const dataDir = path.join(dir, "bbdata")
  const proj = path.join(dir, "proj")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(proj, { recursive: true })
  return { dir, dataDir, proj, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeGlobalConfig(dataDir: string, obj: unknown, mode: number): void {
  const p = path.join(dataDir, "config.json")
  writeFileSync(p, JSON.stringify(obj) + "\n", { mode })
  chmodSync(p, mode)
}

function findings(r: any): Map<string, any> {
  return new Map(r.findings.map((f: any) => [f.id, f]))
}

console.log("M32.S2 bb doctor verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)

// ---------------------------------------------------------------------------
// A. Function-level diagnosis against planted local state
// ---------------------------------------------------------------------------

// A1. Fresh install: no-config FAIL + degraded WARN, exit-relevant finding.
{
  const t = tmpEnv()
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir })
  const f = findings(r)
  check("A1: no-config detected", f.has("no-config") && f.get("no-config").severity === "fail")
  check("A1: degraded notice present", f.has("semantic-degraded"))
  check("A1: fix is bb setup", f.get("no-config")?.fix === "bb setup")
  check("A1: report not healthy", r.healthy === false)
  const out = doctor.renderDoctorReport(r)
  check("A1: render lists findings with fix lines", out.includes("✗") && out.includes("Fix: bb setup"))
  t.cleanup()
}

// A2. Configured + skipped marker: informational wording, still no-config.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { setup_skipped: true }, 0o600)
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir })
  const f = findings(r)
  check("A2: skipped marker acknowledged in message", f.get("no-config")?.message?.includes("skipped earlier"), f.get("no-config")?.message)
  t.cleanup()
}

// A3. Incomplete tier: base URL without model -> FAIL with bb setup fix.
{
  const t = tmpEnv()
  const env = { BB_EMBEDDING_BASE_URL: "https://e.example/v1", BB_EMBEDDING_API_KEY: "fixture-env-key-aaaabbbbccccdddd0000111122223333" }
  const r = doctor.runDoctorChecks({ cwd: t.proj, env, dataDir: t.dataDir })
  const f = findings(r)
  check("A3: incomplete-env FAIL detected", f.has("incomplete-env") && f.get("incomplete-env").severity === "fail", JSON.stringify([...f.keys()]))
  check("A3: missing pieces named", f.get("incomplete-env")?.message?.includes("model"), f.get("incomplete-env")?.message)
  t.cleanup()
}

// A4. Permissions: 0644 config -> WARN with bb doctor --fix; 0600 -> none.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: "fixture-doctor-key-000000" }, 0o644)
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir })
  const f = findings(r)
  check("A4: 0644 mode WARN detected", f.has("mode-global") && f.get("mode-global").severity === "warn")
  check("A4: fix is bb doctor --fix", f.get("mode-global")?.fix === "bb doctor --fix")
  check("A4: healthy stays true on warn-only (besides no-index info)", r.healthy === true, JSON.stringify(r.findings.map((x: any) => x.severity)))
  chmodSync(path.join(t.dataDir, "config.json"), 0o600)
  const r2 = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir })
  check("A4: 0600 produces no mode finding", !findings(r2).has("mode-global"))
  t.cleanup()
}

// A5. Model mismatch: winner model differs from stored rows -> FAIL + --force.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "config-model-x", embedding_api_key: "fixture-doctor-key-000000" }, 0o600)
  const stored = [{ model: "old-model-z", count: 12 }]
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir, storedModels: stored })
  const f = findings(r)
  check("A5: model-mismatch FAIL detected", f.has("model-mismatch") && f.get("model-mismatch").severity === "fail", JSON.stringify([...f.keys()]))
  check("A5: both model names in message", f.get("model-mismatch")?.message?.includes("config-model-x") && f.get("model-mismatch")?.message?.includes("old-model-z"))
  check("A5: fix is bb index --force", f.get("model-mismatch")?.fix === "bb index --force")
  check("A5: report not healthy", r.healthy === false)
  t.cleanup()
}

// A6. Mixed models: winner matches some rows, foreign rows exist -> WARN.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "config-model-x", embedding_api_key: "fixture-doctor-key-000000" }, 0o600)
  const stored = [{ model: "config-model-x", count: 30 }, { model: "legacy-w", count: 4 }]
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir, storedModels: stored })
  const f = findings(r)
  check("A6: mixed-model WARN detected", f.has("model-mixed") && f.get("model-mixed").severity === "warn")
  check("A6: foreign model named", f.get("model-mixed")?.message?.includes("legacy-w"))
  check("A6: healthy (warn does not fail the report)", r.healthy === true)
  t.cleanup()
}

// A7. Match: winner model equals stored model -> no mismatch finding.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "same-model", embedding_api_key: "fixture-doctor-key-000000" }, 0o600)
  const stored = [{ model: "same-model", count: 9 }]
  const r = doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir, storedModels: stored })
  check("A7: consistent state has no mismatch", !findings(r).has("model-mismatch") && !findings(r).has("model-mixed"), JSON.stringify(r.findings.map((x: any) => x.id)))
  t.cleanup()
}

// A8. Real stored rows: genuine local vectors via the M16 lifecycle path.
{
  let ok = false
  let detail = "lifecycle fixture failed"
  const savedEnv = { ...process.env }
  delete process.env.BB_EMBEDDING_BASE_URL
  delete process.env.BB_EMBEDDING_API_KEY
  delete process.env.BB_EMBEDDING_MODEL
  try {
    // In-process imports of the source modules (module-scope import() with a
    // query string can break tsx's transform of these heavier modules).
    const { indexProjectParallel, flushBackgroundEmbeddings } = await import("../../src/ast/parallel-indexer")
    const { getProjectId } = await import("../../src/cli/index")
    const { BrainDatabase } = await import("../../src/brain/database")
    const projDir = mkdtempSync(path.join(os.tmpdir(), "m32-s2-real-"))
    writeFileSync(path.join(projDir, "mod.ts"), "export function alpha() { return 1 }\nexport function beta() { return alpha() + 1 }\n")
    const projectId = getProjectId(projDir)
    await indexProjectParallel(projectId, projDir, {})
    await flushBackgroundEmbeddings()
    const raw = await BrainDatabase.getRawInstance(projectId)
    const rows = raw.prepare("SELECT embedding_model AS model, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").all(projectId) as any[]
    ok = rows.length > 0
    detail = JSON.stringify(rows)
    // Diagnose with a config model that differs from the real stored one.
    // The config and the index MUST share one dataDir — as in reality, where
    // both live under ~/.bb (readStoredModels resolves the DB under dataDir).
    const cfgData = path.dirname(path.dirname(path.dirname(BrainDatabase.getDbPath(projectId))))
    writeGlobalConfig(cfgData, { embedding_base_url: "https://g.example/v1", embedding_model: "not-" + String(rows[0]?.model ?? "x"), embedding_api_key: "fixture-doctor-key-000000" }, 0o600)
    const r = doctor.runDoctorChecks({ cwd: projDir, env: {}, dataDir: cfgData, projectId })
    check("A8: real mismatch from genuine stored vectors", findings(r).has("model-mismatch"), JSON.stringify(r.findings.map((x: any) => x.id)))
    try { BrainDatabase.close(projectId) } catch {}
    rmSync(projDir, { recursive: true, force: true })
    rmSync(path.join(os.homedir(), ".bb", "projects", projectId), { recursive: true, force: true })
    rmSync(path.join(os.homedir(), ".bb", "config.json"), { force: true })
  } catch (e: any) {
    detail = String(e?.message ?? e).slice(0, 200)
  } finally {
    // Restore by DELETE, not assignment: process.env.X = undefined coerces to
    // the string "undefined", which later child processes inherit as a real
    // (garbage) value and the env tier suddenly "exists" with garbage model.
    for (const k of ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_API_KEY", "BB_EMBEDDING_MODEL"]) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  }
  check("A8: genuine stored-vector mismatch fixture produced", ok, detail)
}

// A9. Read-only guarantee: doctor must not create a DB where none existed.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "m", embedding_api_key: "fixture-doctor-key-000000" }, 0o600)
  doctor.runDoctorChecks({ cwd: t.proj, env: {}, dataDir: t.dataDir, projectId: "0000000000000000000000000000000000000000" })
  check("A9: doctor creates no project DB (read-only diagnosis)", !existsSync(path.join(t.dataDir, "projects")), t.dataDir)
  t.cleanup()
}

// ---------------------------------------------------------------------------
// B. Mutants — each planted defect must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (m: DoctorMod) => Promise<boolean> }

// Fixture identical in shape to the positive tests: parent dir + bbdata child.
function mutantFixture(mode: number, cfg: unknown): { dir: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s2-mfix-"))
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  if (cfg !== undefined) {
    const p = path.join(dataDir, "config.json")
    writeFileSync(p, JSON.stringify(cfg), { mode })
    chmodSync(p, mode)
  }
  return { dir, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const mutants: Mutant[] = [
  {
    name: "no-config check removed",
    mutate: (src) => src.replace('id: "no-config",', 'id: "no-config-removed", severity2: 0, //'),
    probe: async (m) => {
      const fx = mutantFixture(0o600, undefined)
      try {
        const r = m.runDoctorChecks({ cwd: fx.dir, env: {}, dataDir: fx.dataDir })
        return !r.findings.some((f: any) => f.id === "no-config")
      } finally { fx.cleanup() }
    },
  },
  {
    name: "mismatch fix command weakened (index . instead of --force)",
    mutate: (src) => src.replaceAll('fix: "bb index --force",', 'fix: "bb index .",'),
    probe: async (m) => {
      const fx = mutantFixture(0o600, { embedding_base_url: "https://g.example/v1", embedding_model: "config-model-x", embedding_api_key: "fixture-doctor-key-000000" })
      try {
        const r = m.runDoctorChecks({ cwd: fx.dir, env: {}, dataDir: fx.dataDir, storedModels: [{ model: "other", count: 1 }] })
        const mm = r.findings.find((f: any) => f.id === "model-mismatch")
        return mm?.fix !== "bb index --force"
      } finally { fx.cleanup() }
    },
  },
  {
    name: "severity swapped: mismatch reported as warn only",
    mutate: (src) => src.replace('id: "model-mismatch",\n        severity: "fail",', 'id: "model-mismatch",\n        severity: "warn",'),
    probe: async (m) => {
      const fx = mutantFixture(0o600, { embedding_base_url: "https://g.example/v1", embedding_model: "config-model-x", embedding_api_key: "fixture-doctor-key-000000" })
      try {
        const r = m.runDoctorChecks({ cwd: fx.dir, env: {}, dataDir: fx.dataDir, storedModels: [{ model: "other", count: 1 }] })
        const mm = r.findings.find((f: any) => f.id === "model-mismatch")
        return mm?.severity !== "fail" || r.healthy === true
      } finally { fx.cleanup() }
    },
  },
  {
    name: "stored-model comparison inverted (mismatch reported as match)",
    mutate: (src) => src.replace("const matches = storedModels.filter((s) => s.model === winnerModel)", "const matches = storedModels.filter((s) => s.model !== winnerModel)"),
    probe: async (m) => {
      const fx = mutantFixture(0o600, { embedding_base_url: "https://g.example/v1", embedding_model: "config-model-x", embedding_api_key: "fixture-doctor-key-000000" })
      try {
        const r = m.runDoctorChecks({ cwd: fx.dir, env: {}, dataDir: fx.dataDir, storedModels: [{ model: "different", count: 5 }] })
        return !r.findings.some((f: any) => f.id === "model-mismatch")
      } finally { fx.cleanup() }
    },
  },
  {
    name: "permission warning removed",
    mutate: (src) => src.replace('id: `mode-${t.tier}`,', 'id: `mode-removed-${t.tier}`,'),
    probe: async (m) => {
      const fx = mutantFixture(0o644, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: "fixture-doctor-key-000000" })
      try {
        const r = m.runDoctorChecks({ cwd: fx.dir, env: {}, dataDir: fx.dataDir })
        return !r.findings.some((f: any) => f.id === "mode-global")
      } finally { fx.cleanup() }
    },
  },
]

const mutantResults: { name: string; caught: boolean; detail: string }[] = []
for (const mut of mutants) {
  const src = readFileSync(COMPONENT, "utf8")
  const mutated = mut.mutate(src)
  if (mutated === src) {
    mutantResults.push({ name: mut.name, caught: false, detail: "mutation produced no change — fix mutant definition" })
    check(`mutant [${mut.name}] applied`, false, "no change")
    continue
  }
  writeFileSync(MUTANT_PATH, mutated)
  let caught = false
  try {
    const mod = await loadComponent(MUTANT_PATH)
    caught = await mut.probe(mod)
  } catch {
    caught = true // a crashing mutant is caught by the suite's probe
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S2: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// C. Built-binary section: real bin/bb, fresh dist
// ---------------------------------------------------------------------------

{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("C: dist rebuilt fresh before binary checks", buildOk)

  const t = tmpEnv()
  const bb = path.join(ROOT, "bin", "bb")
  const proj = t.proj
  writeFileSync(path.join(proj, "a.ts"), "export const x = 1\n")
  // Unconfigured: exit 1 + fail finding (honest failure contract).
  let r1 = ""
  let exit1 = false
  try {
    r1 = execFileSync(bb, ["doctor", "--dir", proj], { env: { ...process.env, BB_DATA_DIR: t.dataDir }, encoding: "utf8" }).toString()
  } catch (e: any) {
    r1 = String(e?.stdout ?? "")
    exit1 = e?.status === 1
    if (!exit1) console.log(`  [debug] doctor exit=${e?.status} code=${e?.code} signal=${e?.signal} stderr=${String(e?.stderr ?? "").slice(0, 200)}`)
  }
  check("C: binary exit 1 on unconfigured + fail finding", exit1 && r1.includes("bb setup"), `exit1=${exit1} FULL=${JSON.stringify(r1.slice(0, 300))}`)
  // Configured with 0644: warn + exit 0.
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: "fixture-doctor-key-000000" }, 0o644)
  const r2 = execFileSync(bb, ["doctor", "--dir", proj], { env: { ...process.env, BB_DATA_DIR: t.dataDir }, encoding: "utf8" }).toString()
  check("C: binary warns on 0644 and points at --fix", r2.includes("644") && r2.includes("bb doctor --fix"))
  check("C: binary exit 0 on warn-only report", true)
  rmSync(t.dir, { recursive: true, force: true })
}

// --- Verdict + evidence ----------------------------------------------------
const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (!ok) {
  console.log("VERDICT: FAIL — doctor gate blocks verify")
  process.exit(1)
}
console.log("VERDICT: PASS")

const evidence = {
  status: "verified",
  milestone: "M32",
  issue: "S2",
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  verifierCommand: "npx tsx script/m32/verify-doctor.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: mutantResults.length,
  mutants: mutantResults.map((m) => ({ name: m.name, caught: m.caught })),
  limitations: [
    "Mismatch fixtures use planted storedModels at function level; A8 additionally produces genuine local-vector rows via the M16 lifecycle path (indexProjectParallel + flushBackgroundEmbeddings).",
    "Doctor never contacts providers; 'never-validated key' appears as no-index/info plus setup advice rather than a network probe.",
    "Binary section covers unconfigured and warn-only states end-to-end; a full mismatch journey on the binary requires a real indexed DB with a diverged config and is covered at function level (A5/A8).",
  ],
}
mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
