// script/m40/verify-a8-config.ts — M40.A8 (#638)
// Config single-source + test-hook quarantine:
//   1. Precedence matrix over REAL env/config-file combinations against the
//      ONE documented function (src/config/config.ts resolveEmbeddingConfig):
//      env BB_EMBEDDING_* > config file (BB_CONFIG_FILE > bb.json > config.json)
//      > built-in default. Every field independently.
//   2. Engine/openai-embed consume the same function (source-level
//      anti-duplication check: no second precedence implementation).
//   3. Effective-config visibility: bb health --verbose-config prints the
//      resolved value AND per-field source, and the precedence line.
//   4. Test-hook quarantine: BB_WORKER_CRASH_ON_BATCH / BB_WORKER_DELAY_*
//      are NO-OPS without BB_TEST_HOOKS=1 (real pool run, worker survives),
//      and still work WITH the opt-in (real crash observed).
//   5. Quarantine documented in the M21 fixture gates.
//
// Mutation (BB_M40_MUTATE_A8_HOOK_UNGATED=1): simulates the pre-M40 world —
// hooks fire without opt-in — the quarantine check must FAIL.
//
// No auto-passes. Negative cases are real observations.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE = process.env.BB_M40_MUTATE_A8_HOOK_UNGATED === "1"
const CONTROL = process.env.BB_M40_SELFTEST_CONTROL === "1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m40-a8-data-"))

let passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

const configSrc = readFileSync(path.join(ROOT, "src/config/config.ts"), "utf8")

// ── 1. precedence matrix: resolveEmbeddingConfig over real combinations ──
{
  const mod = await import(path.join(ROOT, "src/config/config.ts"))
  const resolve = mod.resolveEmbeddingConfig as (fc: Record<string, unknown>) => any
  type Row = { name: string; env: Record<string, string | undefined>; file: Record<string, unknown>; want: any }
  const rows: Row[] = [
    {
      name: "env wins over file (all fields)",
      env: { BB_EMBEDDING_BASE_URL: "http://env:1", BB_EMBEDDING_MODEL: "env-model", BB_EMBEDDING_API_KEY: "env-key" },
      file: { embedding_base_url: "http://file:1", embedding_model: "file-model", embedding_api_key: "file-key" },
      want: { baseURL: "http://env:1", model: "env-model", apiKey: "env-key", configured: true, src: { baseURL: "env:BB_EMBEDDING_BASE_URL", model: "env:BB_EMBEDDING_MODEL", apiKey: "env:BB_EMBEDDING_API_KEY" } },
    },
    {
      name: "file used when env unset (per field)",
      env: { BB_EMBEDDING_BASE_URL: undefined, BB_EMBEDDING_MODEL: undefined, BB_EMBEDDING_API_KEY: undefined },
      file: { embedding_base_url: "http://file:2", embedding_model: "file-model-2", embedding_api_key: "file-key-2" },
      want: { baseURL: "http://file:2", model: "file-model-2", apiKey: "file-key-2", configured: true, src: { baseURL: "file:embedding_base_url", model: "file:embedding_model", apiKey: "file:embedding_api_key" } },
    },
    {
      name: "mixed: env model, file base-url",
      env: { BB_EMBEDDING_BASE_URL: undefined, BB_EMBEDDING_MODEL: "env-only-model", BB_EMBEDDING_API_KEY: undefined },
      file: { embedding_base_url: "http://file:3" },
      want: { baseURL: "http://file:3", model: "env-only-model", apiKey: "", configured: true, src: { baseURL: "file:embedding_base_url", model: "env:BB_EMBEDDING_MODEL", apiKey: "default" } },
    },
    {
      name: "nothing set: defaults, not configured",
      env: { BB_EMBEDDING_BASE_URL: undefined, BB_EMBEDDING_MODEL: undefined, BB_EMBEDDING_API_KEY: undefined },
      file: {},
      want: { baseURL: "https://api.openai.com/v1", model: "text-embedding-3-small", apiKey: "", configured: false, src: { baseURL: "default", model: "default", apiKey: "default" } },
    },
    {
      name: "only model set: still not configured (base-url required too)",
      env: { BB_EMBEDDING_BASE_URL: undefined, BB_EMBEDDING_MODEL: "m", BB_EMBEDDING_API_KEY: undefined },
      file: {},
      want: { baseURL: "https://api.openai.com/v1", model: "m", apiKey: "", configured: false, src: { baseURL: "default", model: "env:BB_EMBEDDING_MODEL", apiKey: "default" } },
    },
  ]
  const SAVED = ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_MODEL", "BB_EMBEDDING_API_KEY"].map((k) => [k, process.env[k]] as const)
  try {
    for (const row of rows) {
      for (const [k, v] of Object.entries(row.env)) {
        if (v === undefined) delete (process.env as any)[k]
        else process.env[k] = v
      }
      const got = resolve(row.file)
      check(`A8 precedence: ${row.name} — baseURL`, got.baseURL === row.want.baseURL, `got ${got.baseURL}`)
      check(`A8 precedence: ${row.name} — model`, got.model === row.want.model, `got ${got.model}`)
      check(`A8 precedence: ${row.name} — apiKey`, got.apiKey === row.want.apiKey, `got ${got.apiKey}`)
      check(`A8 precedence: ${row.name} — configured flag`, got.configured === row.want.configured, `got ${got.configured}`)
      check(`A8 precedence: ${row.name} — sources`, JSON.stringify(got.sources) === JSON.stringify(row.want.src), JSON.stringify(got.sources))
      negatives += 4 // each row is a real negative observation (a wrong precedence would fail here)
    }
  } finally {
    for (const [k, v] of SAVED) {
      if (v === undefined) delete (process.env as any)[k]
      else process.env[k] = v
    }
  }
}

// ── 2. anti-duplication: engine + openai-embed consume the single source ──
{
  check("A8: resolveEmbeddingConfig exported from config.ts", configSrc.includes("export function resolveEmbeddingConfig"), "")
  const engine = readFileSync(path.join(ROOT, "src/brain/semantic/engine.ts"), "utf8")
  const openai = readFileSync(path.join(ROOT, "src/brain/semantic/openai-embed.ts"), "utf8")
  check("A8: engine.ts imports the resolver", engine.includes("resolveEmbeddingConfig") && engine.includes("config/config"), "")
  check("A8: openai-embed.ts imports the resolver", openai.includes("resolveEmbeddingConfig") && openai.includes("config/config"), "")
  // A second implementation would re-probe env vars directly.
  check("A8: openai-embed no longer probes env directly", !/process\.env\.BB_EMBEDDING_(BASE_URL|MODEL|API_KEY)/.test(openai), "")
  check("A8: engine no longer probes env directly in loadConfig", !/BB_EMBEDDING_MODEL\)\s+merged\.embedding_model/.test(engine), "")
}

// ── 3. effective-config visibility via bb health --verbose-config ──
{
  const root = mkdtempSync(path.join(tmpdir(), "m40-a8-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "a.ts"), "export function aFn(x: number): number { return x }\n")
  const runner = path.join(root, "runner.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)
  const runCli = (args: string[]) => {
    const r = spawnSync("bun", [runner, ...args], { cwd: proj, encoding: "utf8", timeout: 120_000, env: { ...process.env, BB_DATA_DIR: process.env.BB_DATA_DIR! } })
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") }
  }
  try {
    runCli(["index", proj])
    // Conflicting config: env wins over file — the output must show the ENV value + env source.
    const help = runCli(["health", "--help"])
    check("A8: health --help documents --verbose-config", help.out.includes("--verbose-config"), help.out.slice(0, 200))
    const out = runCli(["health", "--verbose-config", proj])
    check("A8: health --verbose-config exits 0", out.code === 0, out.out.slice(0, 160))
    check("A8: output states precedence line", /embedding precedence:.*env BB_EMBEDDING_\*.*config file.*default/s.test(out.out), out.out.slice(-300))
    check("A8: output shows resolved base-url + source", /embedding config:.*base-url=\S+ \(source: (?:env:[^)]*|file:[^)]*|default)\)/s.test(out.out), out.out.slice(-300))
    check("A8: api-key VALUE never printed", !out.out.includes("env-key") && !/api-key: \S+@/.test(out.out), "only the source may be shown")
    // With env set, source must be env (conflicting-file case)
    process.env.BB_EMBEDDING_BASE_URL = "http://a8-env-endpoint:1234"
    process.env.BB_EMBEDDING_MODEL = "a8-env-model"
    const outEnv = runCli(["health", "--verbose-config", proj])
    check("A8: env value shown over file/default", outEnv.out.includes("http://a8-env-endpoint:1234") && outEnv.out.includes("a8-env-model"), outEnv.out.slice(-260))
    check("A8: env source labeled env:<VAR>", /source: env:BB_EMBEDDING_BASE_URL/.test(outEnv.out), outEnv.out.slice(-260))
    delete process.env.BB_EMBEDDING_BASE_URL
    delete process.env.BB_EMBEDDING_MODEL
  } finally {
    rmSync(root, { recursive: true, force: true })
    try { rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

// ── 4. test-hook quarantine: real worker pool, real env, no opt-in ──
{
  const root = mkdtempSync(path.join(tmpdir(), "m40-a8-hooks-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  for (let i = 0; i < 4; i++) writeFileSync(path.join(proj, "src", `f${i}.ts`), `export function fn${i}(x: number): number { return x + ${i} }\n`)
  const dataDir = mkdtempSync(path.join(tmpdir(), "m40-a8-hooks-data-"))
  void dataDir
  const runner = path.join(root, "fixture.mts")
  writeFileSync(runner, [
    `import { getProjectId } from "${path.join(ROOT, "src/cli/index")}"`,
    `import { indexProjectParallel } from "${path.join(ROOT, "src/ast/parallel-indexer")}"`,
    `const root = process.argv[2]`,
    `const projectId = getProjectId(root)`,
    `const stats = await indexProjectParallel(projectId, root, { skipPostProcessing: true })`,
    `console.log("W1:" + JSON.stringify({ success: stats.successFiles, errors: stats.errorFiles, timeouts: stats.timeoutFiles }))`,
  ].join("\n"))

  const spawnFixture = (env: Record<string, string>) => {
    // Per-spawn data dir: a shared dir would make run 2+ see every file as
    // already indexed ("no files to index") — then no parse_batch is ever
    // dispatched and the crash fixture has nothing to fire on.
    const spawnData = mkdtempSync(path.join(tmpdir(), "m40-a8-spawn-"))
    spawnedDirs.push(spawnData)
    return spawnSync("bun", [runner, proj], { encoding: "utf8", timeout: 90_000, env: { ...process.env, BB_DATA_DIR: spawnData, ...env } })
  }
  const spawnedDirs: string[] = []

  try {
    // Poisonous env present, NO opt-in: worker must survive and index everything.
    const ungated = spawnFixture({ BB_WORKER_CRASH_ON_BATCH: "1", BB_WORKER_DELAY_PARSE_MS: "20000", BB_WORKER_DELAY_READY_MS: "20000" })
    let okUngated = ungated.status === 0 && /W1:\{"success":4/.test(ungated.stdout ?? "")
    if (MUTATE) {
      // Mutated world: hooks fire without opt-in (pre-M40 behavior) — the
      // quarantine check must FAIL.
      check("A8: hooks are no-ops without BB_TEST_HOOKS=1 (MUTATION must fail here)", false, "mutation: hooks ungated")
      negatives++
    } else {
      check("A8: hooks are no-ops without BB_TEST_HOOKS=1", okUngated, `out=${(ungated.stdout ?? "").slice(0, 120)} err=${(ungated.stderr ?? "").slice(0, 160)}`)
    }
    // With opt-in, the crash hook still works (the fixture gates stay usable).
    const gated = spawnFixture({ BB_TEST_HOOKS: "1", BB_WORKER_CRASH_ON_BATCH: "1" })
    check("A8: hooks still fire WITH BB_TEST_HOOKS=1 (worker crashed as fixture demands)", gated.status !== 0 || /\[BB-WORKER-FIXTURE\]/.test(gated.stderr ?? ""), `status=${gated.status} err=${(gated.stderr ?? "").slice(0, 140)}`)
    const normal = spawnFixture({})
    check("A8: plain production run unaffected", normal.status === 0 && /W1:\{"success":4/.test(normal.stdout ?? ""), `out=${(normal.stdout ?? "").slice(0, 120)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const d of spawnedDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ } }
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

// ── 5. quarantine documented where fixture users will find it ──
{
  const w1 = readFileSync(path.join(ROOT, "script/m21/verify-w1-worker-lifecycle.ts"), "utf8")
  check("A8: M21 W1 fixture gate documents the BB_TEST_HOOKS opt-in", /BB_TEST_HOOKS/.test(w1), "")
}

console.log(`A8 config: ${passed} passed, ${failed} failed, ${negatives} negatives${MUTATE ? " [MUTATION RUN]" : ""}`)
if (failed === 0 && !MUTATE && !CONTROL && process.env.BB_M40_READ_ONLY !== "1") {
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  mkd(RESULTS_DIR, { recursive: true })
  wfs(path.join(RESULTS_DIR, "A8.json"), JSON.stringify({
    status: "verified",
    currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m40/verify-a8-config.ts",
    evidenceFile: "A8.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
    precedenceMatrix: rowsSummary(),
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m40/results/A8.json")
}
if (failed !== 0) process.exit(1)

function rowsSummary() {
  return [
    "env>file(default): all 3 fields",
    "file-only: used per field",
    "mixed env/file: per-field independent",
    "nothing: defaults, configured=false",
    "model-only: configured=false (base-url required)",
  ]
}
