// script/m43/verify-gate-selftest.ts — M43.G1 (#661)
// Mutation-based gate self-test (M31/M35/M40 pattern): for every registered
// non-infra M43 gate, prove two things —
//   (control)  the gate PASSES on the clean/conforming world
//   (mutation) the gate FAILS when its governed surface is corrupted
// A gate that cannot fail is not a gate.
//
// Mutation mechanics:
//   - Plant-style gates (P1/A1/A2/A3): a byte-exact source mutation is written
//     to the REAL governed file, the gate must exit non-zero, and the file is
//     restored byte-identical in `finally`. The mutation anchor must exist in
//     the file (an anchor that vanished = the mutation cannot bite = failure).
//   - Env-style gate (A4): the gate reads BB_M43_MUTATE_A4_SKIP_S5 itself and
//     its missing-scenario assertion must fail.
//   - Evidence safety: control and mutation children run with
//     BB_M43_READ_ONLY=1 so a probe can never stamp (or overwrite) real
//     evidence files.
//
// Honesty rules:
//   - A missing gate script is a hard failure (no unwired gates).
//   - A mutation that does not bite (gate still exits 0 under corruption) is a
//     hard failure — there is no way to record a fabricated pass.
//   - After every plant the file must be byte-identical to the backup; a
//     failed restore fails the selftest (a mutated src file must never leak).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

let checks = 0, passed = 0, failed = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

interface Mutation {
  /** env var added for the mutation run (A4). */
  env?: string
  /** plant-style: repo-relative file to corrupt. */
  file?: string
  /** plant-style: exact string that must exist (anchor). */
  from: string
  /** plant-style: replacement (the corruption). */
  to: string
}

interface GateSpec {
  code: string
  script: string
  mutation: Mutation
}

const GATES: GateSpec[] = [
  {
    code: "P1",
    script: "script/m43/verify-p1-index-lock.ts",
    // A lock whose release never removes the lockfile: every release-based
    // check (normal-run release, reclaim removal, re-acquire) must fail.
    mutation: {
      file: "src/ast/index-lock.ts",
      from: "if (current.pid === process.pid) unlinkSync(lockPath)",
      to: "if (false) unlinkSync(lockPath) // MUT43: release never removes the lockfile",
    },
  },
  {
    code: "A1",
    script: "script/m43/verify-a1-mcp-auto-refresh.ts",
    // Auto-refresh that is NEVER within budget: the MCP read paths must
    // decline instead of repairing — the repair-and-declare checks fail.
    mutation: {
      file: "src/ast/auto-refresh.ts",
      from: "  if (total > maxFiles) {",
      to: "  if (total >= 0) { // MUT43: never within budget",
    },
  },
  {
    code: "A2",
    script: "script/m43/verify-a2-cli-auto-refresh.ts",
    // The CLI symbols-listing path that never auto-refreshes: the CLI
    // repair-and-declare checks fail.
    mutation: {
      file: "src/cli/index.ts",
      from: "  if ((pass1.results.staleCount ?? 0) > 0 && !opts.noAutoRefresh) {",
      to: "  if ((pass1.results.staleCount ?? 0) > 0 && !opts.noAutoRefresh && false) { // MUT43: CLI never auto-refreshes",
    },
  },
  {
    code: "A3",
    script: "script/m43/verify-a3-flag-semantics.ts",
    // A dropped allowlist entry: an env knob the module reads but the
    // allowlist does not declare — the whitelist checks must fail.
    mutation: {
      file: "src/ast/auto-refresh.ts",
      from: "export const AUTO_REFRESH_ENV_ALLOWLIST = [\"BB_NO_AUTO_REFRESH\", \"BB_AUTO_REFRESH_MAX_FILES\", \"BB_AUTO_REFRESH_MAX_BYTES\"] as const",
      to: "export const AUTO_REFRESH_ENV_ALLOWLIST = [\"BB_NO_AUTO_REFRESH\", \"BB_AUTO_REFRESH_MAX_FILES\"] as const // MUT43: entry dropped",
    },
  },
  {
    code: "A4",
    script: "script/m43/verify-a4-corpus.ts",
    // The corpus records S5 under a different name — the gate's own
    // missing-scenario assertion must fail.
    mutation: { env: "BB_M43_MUTATE_A4_SKIP_S5=1", from: "", to: "" },
  },
]

function childEnv(mutationEnv?: string): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), BB_M43_READ_ONLY: "1" }
  if (mutationEnv) {
    const [k, v] = mutationEnv.split("=")
    env[k] = v
  }
  return env
}

function failureDetail(output: string): string {
  const failLines = output.split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 3).join(" | ")
  return failLines || output.slice(-200)
}

const results: Array<{ code: string; script: string; controlPassed: boolean; mutationBit: boolean | null; error?: string }> = []
let hardFailures = 0

for (const gate of GATES) {
  const scriptPath = path.join(ROOT, gate.script)
  if (!existsSync(scriptPath)) {
    check(`${gate.code}: gate script exists`, false, gate.script)
    results.push({ code: gate.code, script: gate.script, controlPassed: false, mutationBit: null, error: "script missing" })
    hardFailures++
    continue
  }

  // ── Control: clean world. Children never stamp evidence. ──
  const ctrl = spawnSync("bun", ["run", gate.script], {
    cwd: ROOT, encoding: "utf8", timeout: 1_200_000, env: childEnv(),
  })
  const controlPassed = ctrl.status === 0
  check(`${gate.code}: control — clean world PASSES`, controlPassed, failureDetail(ctrl.stdout ?? ""))
  if (!controlPassed) {
    results.push({ code: gate.code, script: gate.script, controlPassed, mutationBit: null, error: "control failed on clean world" })
    hardFailures++
    continue
  }

  if (gate.mutation.env) {
    // ── Env-style mutation (A4): the gate reads its own seam var. ──
    const mut = spawnSync("bun", ["run", gate.script], {
      cwd: ROOT, encoding: "utf8", timeout: 1_200_000, env: childEnv(gate.mutation.env),
    })
    const mutationBit = mut.status !== 0
    check(`${gate.code}: mutation — corrupted world FAILS the gate`, mutationBit, failureDetail(mut.stdout ?? ""))
    if (!mutationBit) hardFailures++
    results.push({ code: gate.code, script: gate.script, controlPassed, mutationBit })
    continue
  }

  // ── Plant-style mutation: byte-exact source corruption + byte-identical restore. ──
  const filePath = path.join(ROOT, gate.mutation.file!)
  const backup = readFileSync(filePath, "utf8")
  let mutationBit: boolean | null = null
  let error: string | undefined
  try {
    check(`${gate.code}: mutation anchor exists in ${gate.mutation.file}`, backup.includes(gate.mutation.from), "")
    if (!backup.includes(gate.mutation.from)) {
      hardFailures++
      results.push({ code: gate.code, script: gate.script, controlPassed, mutationBit: false, error: "anchor not found" })
      continue
    }
    writeFileSync(filePath, backup.replace(gate.mutation.from, gate.mutation.to))
    const mut = spawnSync("bun", ["run", gate.script], {
      cwd: ROOT, encoding: "utf8", timeout: 1_200_000, env: childEnv(),
    })
    mutationBit = mut.status !== 0
    check(`${gate.code}: mutation — corrupted surface FAILS the gate`, mutationBit, failureDetail(mut.stdout ?? ""))
    if (!mutationBit) hardFailures++
  } finally {
    writeFileSync(filePath, backup)
  }
  const restoredClean = readFileSync(filePath, "utf8") === backup
  check(`${gate.code}: source restored byte-identical after mutation`, restoredClean, "")
  if (!restoredClean) hardFailures++
  results.push({ code: gate.code, script: gate.script, controlPassed, mutationBit, error })
}

// ── Residue: no leftover mutation artifacts on governed surfaces ──
{
  const out = execFileSync("git", ["status", "--porcelain", "--", "script/m43", "src/ast/index-lock.ts", "src/ast/auto-refresh.ts", "src/cli/index.ts"], { cwd: ROOT, encoding: "utf8" })
  const lines = out.split("\n").filter((l) => l.trim().length > 0)
  check("residue: no uncommitted changes on governed surfaces after the selftest", lines.length === 0, lines.slice(0, 5).join(" | "))
  if (lines.length > 0) hardFailures++
}

const allProven = results.every((r) => r.controlPassed && r.mutationBit === true)
const evidence = {
  status: hardFailures === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m43/verify-gate-selftest.ts",
  generatedAt: new Date().toISOString(),
  passed: results.filter((r) => r.controlPassed && r.mutationBit).length,
  failed: hardFailures,
  negativeCases: results.filter((r) => r.mutationBit).length,
  gates: results,
  allProven,
}
mkdirSync(RESULTS_DIR, { recursive: true })
if (process.env.BB_M43_READ_ONLY !== "1") {
  writeFileSync(path.join(RESULTS_DIR, "gate-selftest.json"), JSON.stringify(evidence, null, 2) + "\n")
}

console.log(`M43 gate-selftest: ${evidence.passed}/${results.length} gates fully proven (${hardFailures} hard failures)`)
for (const r of results) {
  const mark = r.controlPassed && r.mutationBit ? "OK " : "BAD"
  console.log(`  ${mark} ${r.code} control=${r.controlPassed} mutationBit=${r.mutationBit}${r.error ? ` (${r.error})` : ""}`)
}
process.exit(hardFailures === 0 ? 0 : 1)
