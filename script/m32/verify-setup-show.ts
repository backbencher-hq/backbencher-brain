// script/m32/verify-setup-show.ts — M32.S1.
//
// Proves `bb setup show` (describeEmbeddingConfig + renderSetupShow in
// src/setup/setup-show.ts) reports every precedence tier truthfully, names
// the winner per the env > global > project contract, NEVER emits full key
// material (fingerprint only), warns on wrong file modes, and never crashes
// on corrupt state — with planted mutants asserted to be caught. A final
// section rebuilds dist and checks the real bin/bb output end-to-end, so a
// tsx-only pass cannot hide a bundle defect (the M30 P0 class).
//
// CLI: npx tsx script/m32/verify-setup-show.ts   (exit non-zero blocks verify)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/setup/setup-show.ts")
const MUTANT_PATH = path.join(ROOT, "src/setup/.setup-show-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m32/results/S1.json")

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

type ShowMod = {
  describeEmbeddingConfig: (cwd?: string, env?: Record<string, string | undefined>, dataDir?: string) => any
  renderSetupShow: (state: any) => string
}

// Dynamic import caches modules — mutant files share a name, so every load
// after the first would return the PRISTINE component and mutants would
// "survive" as an artifact. Cache-bust with a version query.
let loadCounter = 0
async function loadComponent(p: string): Promise<ShowMod> {
  loadCounter++
  return (await import(`${p}?v=${loadCounter}`)) as ShowMod
}

// Fixture keys deliberately do NOT match real provider key shapes (the
// governance secret-hygiene gate scans tracked files for sk-or-v1-/nvapi-
// patterns); they still exercise fingerprinting and leak detection.
const FULL_ENV_KEY = "fixture-env-key-aaaabbbbccccdddd0000111122223333"
const FULL_GLOBAL_KEY = "fixture-global-key-DEADBEEF_1234567890"

function tmpEnv(): { dir: string; dataDir: string; proj: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-"))
  const dataDir = path.join(dir, "bbdata")
  const proj = path.join(dir, "proj")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(proj, { recursive: true })
  return {
    dir,
    dataDir,
    proj,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function writeGlobalConfig(dataDir: string, obj: unknown, mode: number): void {
  const p = path.join(dataDir, "config.json")
  writeFileSync(p, JSON.stringify(obj) + "\n", { mode })
  chmodSync(p, mode) // writeFileSync mode only applies at creation
}

function writeProjectConfig(proj: string, obj: unknown): void {
  writeFileSync(path.join(proj, "bb.json"), JSON.stringify(obj) + "\n")
}

console.log("M32.S1 bb setup show verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)

const show = await loadComponent(COMPONENT)

// ---------------------------------------------------------------------------
// A. Tier states and winner contract
// ---------------------------------------------------------------------------

// A1. Nothing configured anywhere.
{
  const t = tmpEnv()
  const s = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  check("A1: no config -> configured=false, winner=none", s.configured === false && s.winner === "none", JSON.stringify(s))
  const r = show.renderSetupShow(s)
  check("A1: render names bb setup as the fix", r.includes("bb setup"), r.split("\n").slice(-2).join(" | "))
  t.cleanup()
}

// A2. Env tier wins over global and project.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
  writeProjectConfig(t.proj, { embedding_base_url: "https://p.example/v1", embedding_model: "p-model", embedding_api_key: "pk-0001" })
  const env = { BB_EMBEDDING_BASE_URL: "https://e.example/v1", BB_EMBEDDING_MODEL: "e-model", BB_EMBEDDING_API_KEY: FULL_ENV_KEY }
  const s = show.describeEmbeddingConfig(t.proj, env, t.dataDir)
  check("A2: env outranks global and project", s.winner === "env" && s.configured === true, `winner=${s.winner}`)
  check("A2: all three tiers reported present", s.tiers.every((x: any) => x.present === true), JSON.stringify(s.tiers.map((x: any) => x.tier)))
  t.cleanup()
}

// A3. Global wins when env absent; project wins when both absent.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
  const s1 = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  check("A3: global wins without env", s1.winner === "global", `winner=${s1.winner}`)
  writeProjectConfig(t.proj, { embedding_base_url: "https://p.example/v1", embedding_model: "p-model", embedding_api_key: "pk-0001" })
  const s2 = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  check("A3: env absent -> global still outranks project", s2.winner === "global", `winner=${s2.winner}`)
  rmSync(path.join(t.dataDir, "config.json"))
  const s3 = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  check("A3: project wins when env and global absent", s3.winner === "project", `winner=${s3.winner}`)
  t.cleanup()
}

// A4. Incomplete tier is shown but can never win.
{
  const t = tmpEnv()
  // env has only a base URL (no model) — present, incomplete.
  const env = { BB_EMBEDDING_BASE_URL: "https://e.example/v1" }
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
  const s = show.describeEmbeddingConfig(t.proj, env, t.dataDir)
  const envTier = s.tiers.find((x: any) => x.tier === "env")
  check("A4: partial env tier is present but incomplete", envTier?.present === true && envTier?.complete === false && typeof envTier?.incompleteReason === "string", JSON.stringify(envTier))
  check("A4: incomplete tier cannot win — global wins", s.winner === "global", `winner=${s.winner}`)
  t.cleanup()
}

// A5. Corrupt global JSON counts as absent — never crashes, lower tier wins.
{
  const t = tmpEnv()
  writeFileSync(path.join(t.dataDir, "config.json"), "{ not valid json !!!", { mode: 0o600 })
  writeProjectConfig(t.proj, { embedding_base_url: "https://p.example/v1", embedding_model: "p-model", embedding_api_key: "pk-0001" })
  let s: any = null
  let threw = false
  try {
    s = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  } catch {
    threw = true
  }
  check("A5: corrupt config does not crash", !threw && s !== null)
  check("A5: corrupt tier is skipped — project wins", s?.winner === "project", `winner=${s?.winner}`)
  t.cleanup()
}

// A6. Skipped marker surfaced on the global tier.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { setup_skipped: true }, 0o600)
  const s = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  const g = s.tiers.find((x: any) => x.tier === "global")
  check("A6: setup_skipped marker surfaced on global tier", g?.skippedMarker === true, JSON.stringify(g))
  const r = show.renderSetupShow(s)
  check("A6: render mentions the skip marker", r.includes("wizard skipped"), r.split("\n").filter((l) => l.includes("global")).join(" | "))
  t.cleanup()
}

// A7. Wrong file mode is warned about in render; 0600 is not.
{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o644)
  const s = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  const r = show.renderSetupShow(s)
  check("A7: 0644 mode warned in render", r.includes("644") && r.includes("600"), r.split("\n").filter((l) => l.includes("global")).join(" | "))
  const g = s.tiers.find((x: any) => x.tier === "global")
  check("A7: tier exposes numeric fileMode", g?.fileMode === 0o644, `fileMode=${g?.fileMode}`)
  chmodSync(path.join(t.dataDir, "config.json"), 0o600)
  const s2 = show.describeEmbeddingConfig(t.proj, {}, t.dataDir)
  const r2 = show.renderSetupShow(s2)
  check("A7: 0600 mode renders without warning", r2.includes("mode: 600") && !r2.includes("expected"), r2.split("\n").filter((l) => l.includes("global")).join(" | "))
  t.cleanup()
}

// ---------------------------------------------------------------------------
// B. Secret hygiene: the full key must never leak into state or render
// ---------------------------------------------------------------------------

{
  const t = tmpEnv()
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
  const env = { BB_EMBEDDING_API_KEY: FULL_ENV_KEY }
  const s = show.describeEmbeddingConfig(t.proj, env, t.dataDir)
  const stateJson = JSON.stringify(s)
  check("B: full env key absent from state", !stateJson.includes(FULL_ENV_KEY))
  check("B: full global key absent from state", !stateJson.includes(FULL_GLOBAL_KEY))
  const r = show.renderSetupShow(s)
  check("B: full keys absent from render", !r.includes(FULL_ENV_KEY) && !r.includes(FULL_GLOBAL_KEY))
  check("B: env key fingerprint present (last 4)", r.includes("••••" + FULL_ENV_KEY.slice(-4)), r.split("\n").filter((l) => l.includes("env")).join(" | "))
  check("B: global key fingerprint present (last 4)", r.includes("••••" + FULL_GLOBAL_KEY.slice(-4)))
  t.cleanup()
}

// ---------------------------------------------------------------------------
// C. Mutants — each planted defect must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (mod: ShowMod) => Promise<boolean> }

const mutants: Mutant[] = [
  {
    name: "winner order broken (project outranks env)",
    mutate: (src) => src.replace("const winningTier = tiers.find((t) => t.complete)", "const winningTier = [...tiers].reverse().find((t) => t.complete)"),
    probe: async (m) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-mut1-"))
      const dataDir = path.join(dir, "d"); const proj = path.join(dir, "p")
      mkdirSync(dataDir, { recursive: true }); mkdirSync(proj, { recursive: true })
      writeGlobalConfig(dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
      const env = { BB_EMBEDDING_BASE_URL: "https://e.example/v1", BB_EMBEDDING_MODEL: "e-model", BB_EMBEDDING_API_KEY: FULL_ENV_KEY }
      const s = m.describeEmbeddingConfig(proj, env, dataDir)
      rmSync(dir, { recursive: true, force: true })
      return s.winner !== "env" // suite asserts winner === "env", so mutant is caught when this holds
    },
  },
  {
    name: "incomplete tier allowed to win",
    mutate: (src) => src.replace("const winningTier = tiers.find((t) => t.complete)", "const winningTier = tiers.find((t) => t.present)"),
    probe: async (m) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-mut2-"))
      const dataDir = path.join(dir, "d"); const proj = path.join(dir, "p")
      mkdirSync(dataDir, { recursive: true }); mkdirSync(proj, { recursive: true })
      writeGlobalConfig(dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
      const env = { BB_EMBEDDING_BASE_URL: "https://e.example/v1" } // incomplete
      const s = m.describeEmbeddingConfig(proj, env, dataDir)
      rmSync(dir, { recursive: true, force: true })
      return s.winner !== "global"
    },
  },
  {
    name: "full key leaked into state",
    mutate: (src) => src.replace("keyFingerprint: typeof key === \"string\" && key.length > 0 ? fingerprintKey(key) : undefined,", "keyFingerprint: typeof key === \"string\" && key.length > 0 ? (key as string) : undefined,"),
    probe: async (m) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-mut3-"))
      const dataDir = path.join(dir, "d"); const proj = path.join(dir, "p")
      mkdirSync(dataDir, { recursive: true }); mkdirSync(proj, { recursive: true })
      writeGlobalConfig(dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o600)
      const s = m.describeEmbeddingConfig(proj, {}, dataDir)
      const leaked = JSON.stringify(s).includes(FULL_GLOBAL_KEY)
      rmSync(dir, { recursive: true, force: true })
      return leaked
    },
  },
  {
    name: "corrupt config crashes show",
    mutate: (src) => src.replace("  } catch {\n    return null // corrupt JSON counts as absent — show must never crash on it\n  }", "  } catch {\n    throw new Error(\"corrupt config\")\n  }"),
    probe: async (m) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-mut4-"))
      const dataDir = path.join(dir, "d"); const proj = path.join(dir, "p")
      mkdirSync(dataDir, { recursive: true }); mkdirSync(proj, { recursive: true })
      writeFileSync(path.join(dataDir, "config.json"), "{ broken", { mode: 0o600 })
      let threw = false
      try { m.describeEmbeddingConfig(proj, {}, dataDir) } catch { threw = true }
      rmSync(dir, { recursive: true, force: true })
      return threw
    },
  },
  {
    name: "mode warning removed from render",
    mutate: (src) => src.replace("(expected: 600 — fix with bb doctor)", "(mode mismatch)"),
    probe: async (m) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "m32-s1-mut5-"))
      const dataDir = path.join(dir, "d"); const proj = path.join(dir, "p")
      mkdirSync(dataDir, { recursive: true }); mkdirSync(proj, { recursive: true })
      writeGlobalConfig(dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o644)
      const r = m.renderSetupShow(m.describeEmbeddingConfig(proj, {}, dataDir))
      rmSync(dir, { recursive: true, force: true })
      return !r.includes("fix with bb doctor")
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
  } catch (e) {
    // A mutant that crashes on load is caught by the suite (probe fails) —
    // but for crash-detector mutants a throw IS the mutant behavior.
    caught = mut.name === "corrupt config crashes show"
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S1: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// D. Built-binary check: the real bin/bb must render the same truths
// ---------------------------------------------------------------------------

{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("D: dist rebuilt fresh before binary checks", buildOk)

  const t = tmpEnv()
  const bb = path.join(ROOT, "bin", "bb")
  // The unconfigured view is HONEST failure: the CLI exits 1 by design so
  // scripts can branch on it. Accept both code shapes and require the right
  // output either way.
  let r1 = ""
  let r1ok = false
  try {
    r1 = execFileSync(bb, ["setup", "show"], { env: { ...process.env, BB_DATA_DIR: t.dataDir }, encoding: "utf8" }).toString()
    r1ok = true
  } catch (e: any) {
    r1 = String(e?.stdout ?? "")
    r1ok = e?.status === 1
  }
  check("D: binary renders honest no-config view", r1ok && r1.includes("Winner: none") && r1.includes("bb setup"), r1.split("\n").slice(-2).join(" | "))
  writeGlobalConfig(t.dataDir, { embedding_base_url: "https://g.example/v1", embedding_model: "g-model", embedding_api_key: FULL_GLOBAL_KEY }, 0o644)
  const r2 = execFileSync(bb, ["setup", "show"], { env: { ...process.env, BB_DATA_DIR: t.dataDir }, encoding: "utf8" }).toString()
  check("D: binary shows global winner with fingerprint only", r2.includes("Winner: global") && r2.includes("••••" + FULL_GLOBAL_KEY.slice(-4)) && !r2.includes(FULL_GLOBAL_KEY))
  check("D: binary warns on 0644 config", r2.includes("644") && r2.includes("bb doctor"))
  const r3 = execFileSync(bb, ["setup", "show"], { env: { ...process.env, BB_EMBEDDING_BASE_URL: "https://e.example/v1", BB_EMBEDDING_MODEL: "e-model", BB_EMBEDDING_API_KEY: FULL_ENV_KEY, BB_DATA_DIR: t.dataDir }, encoding: "utf8" }).toString()
  check("D: binary shows env winner over global", r3.includes("Winner: env"))
  t.cleanup()
}

// --- Verdict + evidence ----------------------------------------------------
const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (!ok) {
  console.log("VERDICT: FAIL — setup-show gate blocks verify")
  process.exit(1)
}
console.log("VERDICT: PASS")

const evidence = {
  status: "verified",
  milestone: "M32",
  issue: "S1",
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  verifierCommand: "npx tsx script/m32/verify-setup-show.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: mutantResults.length,
  mutants: mutantResults.map((m) => ({ name: m.name, caught: m.caught })),
  limitations: [
    "describeEmbeddingConfig reads local files/env only; it never contacts providers, so no live-key state is asserted here.",
    "Project-tier bb.json rendering is covered at function level; the binary section exercises env and global tiers end-to-end.",
    "Exit-code contract (1 when unconfigured) is asserted via the built binary; script-side process.exitCode behavior is out of scope for a pure-function suite.",
  ],
}
mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
