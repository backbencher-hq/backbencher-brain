// script/m50/verify-gate-selftest.ts — M50.G2
//
// Mutation-based self-test (M31/M35/M40 pattern). For every registered
// non-infrastructure M50 gate this proves TWO things:
//
//   control   the gate PASSES on the clean world
//   mutation  the gate FAILS when the surface it governs is corrupted
//
// A gate that cannot fail is not a gate — and this milestone exists because
// two gates in the repo had been failing for reasons nobody noticed.
//
// Each mutation is a precise source edit applied to the real file and restored
// byte-for-byte in `finally`; every restore is verified by content comparison,
// so a crash cannot leave the tree mutated. The gate's exit code is the only
// thing consulted — never its prose.
//
// Run: npx tsx script/m50/verify-gate-selftest.ts

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const GATE_TIMEOUT = 600_000

interface Mutation {
  gate: string
  script: string
  /** The governed surface and the exact edit that must break the gate. */
  file: string
  find: string
  replace: string
  /** Optional: extra file mutated for the same gate. */
  extra?: { file: string; find: string; replace: string }
}

const MUTATIONS: Mutation[] = [
  {
    gate: "A2-stats",
    script: "verify-planner-stats.ts",
    file: "src/brain/schema-ddl.ts",
    find: "    const hasStats = raw.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'\").get()",
    replace: "    const hasStats = { name: \"sqlite_stat1\" } // MUTANT: pretend stats always exist",
  },
  {
    gate: "A2-aliases",
    script: "verify-a2-param-aliases.ts",
    file: "src/mcp/tool-validation.ts",
    find: '  bb_graph: { target: "symbol", symbolName: "symbol", query: "symbol" },',
    replace: '  bb_graph: { target: "symbol", symbolName: "symbol" }, // MUTANT: query alias removed',
  },
  {
    gate: "A2-vector-blobs",
    script: "verify-vector-blobs.ts",
    // The mutations/negatives inside this gate are about the BLOB being the
    // right length and decoding to the right numbers, so corrupt the encoder:
    // a truncated blob must trip P2/P5 and the M1 negative.
    file: "src/brain/semantic/vector-binary.ts",
    find: "  for (let i = 0; i < n; i++) view.setFloat32(i * 4, vector[i], true)\n  return bytes",
    replace: "  for (let i = 0; i < n; i++) view.setFloat32(i * 4, vector[i], true)\n  return bytes.subarray(0, Math.max(1, bytes.length - 1)) // MUTANT: one byte short",
  },
  {
    gate: "A2-bounded",
    script: "verify-a2-bounded-work.ts",
    // The gate compares the engine's project-scope aggregate against an
    // independent SQL derivation, so corrupting that aggregate must fail it.
    file: "src/intelligence/analysis/complexity.ts",
    find: '    const locRow = raw.prepare("SELECT COALESCE(SUM(line_count),0) AS lc FROM brain_file WHERE project_id = ?").get(projectId) as { lc: number }',
    replace: '    const locRow = raw.prepare("SELECT COALESCE(SUM(line_count),0) + 1 AS lc FROM brain_file WHERE project_id = ?").get(projectId) as { lc: number } // MUTANT: off-by-one LOC',
  },
  {
    gate: "A2-test-sources",
    script: "verify-a2-test-sources.ts",
    // The gate compares the returned gap page against an independent top-K
    // oracle, so removing the bound must fail it.
    file: "src/intelligence/testing/test-intel.ts",
    find: "  const gaps: TestGap[] = candidates.slice(0, maxResults).map((c) => ({",
    replace: "  const gaps: TestGap[] = candidates.map((c) => ({ // MUTANT: unbounded page",
  },
  {
    gate: "A3-guidance",
    script: "verify-a3-guidance-truth.ts",
    file: "src/cli/onboard.ts",
    find: '    `These are the only bb tools (${names.length} total). A name that is not in this table does not exist —`,',
    replace: '    `These are the only bb tools (${names.length} total); older docs also mention bb_refresh and bb_select.`, // MUTANT: ghost names',
  },
  {
    gate: "A4-adoption",
    script: "verify-a4-adoption.ts",
    file: "src/mcp/tool-validation.ts",
    find: '  bb_impact: { target: "symbol", symbolName: "symbol", query: "symbol" },',
    replace: '  bb_impact: { symbolName: "symbol", query: "symbol" }, // MUTANT: target alias removed',
  },
  {
    gate: "A5-chain",
    script: "verify-a5-verify-chain.ts",
    file: "docs/data/m10-baseline.json",
    find: '      "bb_search",\n      "bb_ask",',
    replace: '      "bb_ask",',
  },
]

let pass = 0
let failed = 0
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++
    console.log(`  ok ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function runGate(script: string): { ok: boolean; tail: string } {
  const r = spawnSync("npx", ["tsx", `script/m50/${script}`], { cwd: ROOT, encoding: "utf8", timeout: GATE_TIMEOUT })
  const tail = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(-2).join(" | ").slice(0, 200)
  return { ok: r.status === 0, tail }
}

// A mutation must never outlive the process. `finally` covers exceptions, but
// not SIGTERM/SIGINT (a killed run leaves the MUTANT text in the tree, which a
// previous run of this very gate proved the hard way). So: a global restore
// registry + synchronous signal handlers + a residue precheck at startup.
let activeEdits: Array<{ abs: string; original: string }> = []
function restoreActive(): string[] {
  const failedRestores: string[] = []
  for (const f of activeEdits) {
    try {
      writeFileSync(f.abs, f.original)
      if (readFileSync(f.abs, "utf8") !== f.original) failedRestores.push(f.abs)
    } catch {
      failedRestores.push(f.abs)
    }
  }
  activeEdits = []
  return failedRestores
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    const bad = restoreActive()
    if (bad.length) console.error(`failed to restore after ${signal}: ${bad.join(", ")}`)
    else console.error(`restored ${bad.length === 0 ? "all" : "some"} mutated files after ${signal}`)
    process.exit(130)
  })
}

function withMutation<T>(m: Mutation, fn: () => T): T {
  const files = [{ file: m.file, find: m.find, replace: m.replace }, ...(m.extra ? [m.extra] : [])].map((edit) => {
    const abs = path.join(ROOT, edit.file)
    return { abs, original: readFileSync(abs, "utf8"), edit }
  })
  activeEdits = files.map((f) => ({ abs: f.abs, original: f.original }))
  try {
    for (const f of files) {
      if (!f.original.includes(f.edit.find)) throw new Error(`mutation anchor not found in ${f.edit.file}`)
      writeFileSync(f.abs, f.original.replace(f.edit.find, f.edit.replace))
    }
    return fn()
  } finally {
    const restoreFailures = restoreActive()
    if (restoreFailures.length) throw new Error(`restore failed: ${restoreFailures.join(", ")}`)
  }
}

console.log("M50.G2 gate self-test — control + mutation for every registered non-infra gate")

// ── residue precheck: a killed run must never be silently inherited ────────
{
  const residue: string[] = []
  for (const m of MUTATIONS) {
    const abs = path.join(ROOT, m.file)
    if (readFileSync(abs, "utf8").includes("MUTANT")) residue.push(m.file)
  }
  if (residue.length) {
    console.error(`REFUSING TO RUN: ${residue.join(", ")} still contains a MUTANT marker from a killed run. Restore those files before re-running.`)
    process.exit(1)
  }
}

for (const m of MUTATIONS) {
  const hashBefore = createHash("sha1").update(readFileSync(path.join(ROOT, m.file), "utf8")).digest("hex")

  // control: the clean world must pass
  const control = runGate(m.script)
  check(`control ${m.gate} passes on the clean world`, control.ok, control.tail)

  // mutation: the corrupted world must fail
  let mutationRun: { ok: boolean; tail: string } | null = null
  let mutationError = ""
  try {
    mutationRun = withMutation(m, () => runGate(m.script))
  } catch (e: any) {
    mutationError = e?.message ?? String(e)
  }
  check(`mutation ${m.gate} FAILS when ${m.file} is corrupted`, mutationError === "" && mutationRun !== null && !mutationRun.ok, mutationError || mutationRun?.tail)

  // restore proof: the governed file is byte-identical to before
  const hashAfter = createHash("sha1").update(readFileSync(path.join(ROOT, m.file), "utf8")).digest("hex")
  check(`restore ${m.gate}: ${m.file} byte-identical after the mutation run`, hashBefore === hashAfter)
}

// Coverage contract: every non-infra gate in the registry must appear above.
{
  const registry = JSON.parse(readFileSync(path.join(ROOT, "script/m50/gates.json"), "utf8"))
  const nonInfra = (registry.gates as Array<{ code: string; script: string; infra: boolean }>).filter((g) => !g.infra)
  const covered = new Set(MUTATIONS.map((m) => m.script))
  const missing = nonInfra.filter((g) => !covered.has(g.script)).map((g) => g.code)
  check(`every non-infra gate carries a mutation (${nonInfra.length} gates)`, missing.length === 0, `uncovered: ${missing.join(", ")}`)
}

console.log(`\nM50.G2 GATE SELF-TEST: ${failed === 0 ? "PASS" : "FAIL"} (${pass} passed, ${failed} failed)`)
if (failed > 0) process.exit(1)
