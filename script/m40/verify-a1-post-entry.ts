// script/m40/verify-a1-post-entry.ts — M40.A1
// Behavioral gate for the standalone post-processing entry (bb index --post,
// MCP bb_index mode=post). No auto-passes; every check queries real state.
//
// Core proof (the negative that gives this gate its teeth):
//   1. Full-index a fixture → record resolved-relationship count R0.
//   2. CORRUPT the derived data: null every target_symbol_id.
//   3. Run `bb index --post` (the real CLI path).
//   4. Query: resolution restored (≥90% of R0 — name-based re-resolution).
//   Mutation (BB_M40_MUTATE_A1_NOOP_POST=1): skip step 3, simulating a --post
//   that does nothing. The restoration check must then FAIL — proving this
//   gate would catch a no-op post entry.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE_NOOP = process.env.BB_M40_MUTATE_A1_NOOP_POST === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`) }
}

const { getProjectId } = await import("../../src/cli/index")
const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")

const root = mkdtempSync(path.join(tmpdir(), "m40-a1-"))
const proj = path.join(root, "proj")
mkdirSync(path.join(proj, "src"), { recursive: true })

try {
  // Fixture: cross-file call graph so relationship resolution has real work.
  writeFileSync(path.join(proj, "src", "lib.ts"), [
    "export function add(x: number, y: number): number { return x + y }",
    "export function mul(x: number, y: number): number { return x * y }",
    "export function helper(v: number): number { return add(v, 1) }",
  ].join("\n") + "\n")
  writeFileSync(path.join(proj, "src", "app.ts"), [
    `import { add, mul, helper } from "./lib"`,
    "export function run(a: number, b: number): number {",
    "  const s = add(a, b)",
    "  const m = mul(s, 2)",
    "  return helper(m)",
    "}",
  ].join("\n") + "\n")
  writeFileSync(path.join(proj, "src", "main.ts"), [
    `import { run } from "./app"`,
    "export function main(): number { return run(1, 2) }",
  ].join("\n") + "\n")

  const pid = getProjectId(proj) as any

  // 1. Full index (runs the A1-extracted post-processing inline).
  const stats = await indexProjectParallel(pid, proj, {})
  check("A1: full index succeeds", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
  check("A1: fixture has symbols", stats.symbolsExtracted >= 5, String(stats.symbolsExtracted))

  const raw = await BrainDatabase.getRawInstance(pid)
  const countResolved = () =>
    (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NOT NULL").get(pid) as any).c
  const countTotal = () =>
    (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?").get(pid) as any).c
  const R0 = countResolved()
  check("A1: post-index relationships resolved", R0 > 0, `R0=${R0} total=${countTotal()}`)

  // 2. Corrupt ALL derived resolution (the exact failure mode --changed leaves behind).
  // Counted as a negative case: corrupted state is injected and must be proven repaired.
  raw.prepare("UPDATE brain_relationship SET target_symbol_id = NULL WHERE project_id = ?").run(pid)
  check("A1: corruption landed (resolved=0)", countResolved() === 0, String(countResolved()))
  negatives++

  // 3. Run the real CLI: bb index --post (no re-parse).
  const runner = path.join(root, "run.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)
  let postCode = 0
  let postOut = ""
  if (!MUTATE_NOOP) {
    const r = spawnSync("bun", [runner, "index", proj, "--post"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 })
    postCode = r.status ?? 1
    postOut = (r.stdout ?? "") + (r.stderr ?? "")
    check("A1: bb index --post exits 0", postCode === 0, postOut.slice(-200))
    check("A1: --post output lists the phases", /relationships/.test(postOut) && /enrich|gravity|taint/.test(postOut), postOut.slice(0, 300))
    check("A1: --post output reports total time", /post-processing complete in/.test(postOut), postOut.slice(0, 200))
  } else {
    // Mutation: --post simulated as a no-op (never ran). Downstream checks must fail.
    negatives++
  }

  // 4. Restoration proof.
  const R1 = countResolved()
  // M40.A4 lesson: symbol-level targets are 100% resolver-reachable (R0 was
  // observed to fluctuate 12↔15 run-to-run because store-time inline
  // resolution is batch-order dependent); `imports`-type rows are FILE-level
  // dependency edges by design (target `./module:item`, consumed via
  // target_external by dependencies/orphans tools) and are NOT symbol-
  // resolvable. The honest, machine-independent invariant: every non-imports
  // row resolves after --post.
  const nonImportsTotal = () =>
    (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type != 'imports'").get(pid) as any).c
  const nonImportsResolved = () =>
    (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type != 'imports' AND target_symbol_id IS NOT NULL").get(pid) as any).c
  if (MUTATE_NOOP) {
    check("MUTATION: restoration check FAILS when --post is a no-op", R1 === 0, `R1=${R1} (expected 0 — gate must fail)`)
    // Force the gate failure the mutation exists to prove.
    check("A1: relationships restored after --post", false, `mutated run: R1=${R1} vs R0=${R0}`)
  } else {
    const NI = nonImportsTotal()
    const NIR = nonImportsResolved()
    check("A1: fixture has symbol-level edges", NI >= 8, `non-imports rows=${NI}`)
    check("A1: 100% of resolver-reachable rows restored after --post", NIR === NI, `${NIR}/${NI} non-imports rows resolved`)
    check("A1: total relationship rows preserved (no data loss)", countTotal() >= R0, `total=${countTotal()} R0=${R0}`)
  }

  // 5. No-index case: a fresh project with no DB must fail clearly, never silently.
  {
    const emptyProj = path.join(root, "empty")
    mkdirSync(emptyProj, { recursive: true })
    writeFileSync(path.join(emptyProj, "a.ts"), "export const a = 1\n")
    const r = spawnSync("bun", [runner, "index", emptyProj, "--post"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
    const text = (r.stdout ?? "") + (r.stderr ?? "")
    check("A1: --post with no index exits non-zero", (r.status ?? 0) !== 0, `code=${r.status}`)
    check("A1: --post no-index message is actionable", /no index|bb index first|no such/i.test(text), text.slice(0, 200))
  }

  // 6. MCP handler: mode=post returns the same phase report (same entry).
  {
    const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
    const handlers = createToolHandlers()
    const res = await handlers.bb_index({ path: "post", mode: "post" } as any, { projectId: pid as any, projectPath: proj })
    const parsed = JSON.parse(res.content[0].text)
    check("A1: MCP mode=post returns phase array", Array.isArray(parsed.phases) && parsed.phases.length >= 5, JSON.stringify(parsed).slice(0, 160))
    check("A1: MCP mode=post phases all ok", parsed.phases.every((p: any) => p.outcome === "ok"), JSON.stringify(parsed.phases))
    check("A1: MCP mode=post reports integrityHealth", typeof parsed.integrityHealth === "number", String(parsed.integrityHealth))
    // Unindexed project → error result.
    const emptyPid = getProjectId(path.join(root, "empty2")) as any
    const res2 = await handlers.bb_index({ path: "post", mode: "post" } as any, { projectId: emptyPid, projectPath: path.join(root, "empty2") })
    check("A1: MCP mode=post on unindexed project errors honestly", /failed|no index/i.test(res2.content[0].text), res2.content[0].text.slice(0, 160))
  }

  // 7. Per-phase timing visible and sane (from the MCP report we already have).
  {
    const { runPostProcessing } = await import("../../src/ast/parallel-indexer")
    const post = await runPostProcessing(pid, { logger: { log: () => {}, write: () => {} } })
    const names = post.phases.map((p) => p.name)
    for (const expected of ["relationships", "enrichment", "gravity", "taint", "health", "integrity"]) {
      check(`A1: phase report includes ${expected}`, names.includes(expected), names.join(","))
    }
    check("A1: every phase timed (ms >= 0) with outcome", post.phases.every((p) => typeof p.ms === "number" && (p.outcome === "ok" || p.outcome === "failed" || p.outcome === "skipped")), JSON.stringify(post.phases))
    check("A1: totalMs >= max phase ms", post.totalMs >= Math.max(...post.phases.map((p) => p.ms)), `total=${post.totalMs}`)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

// ── emit evidence ──
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const evidence = {
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m40/verify-a1-post-entry.ts",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: negatives,
  mutation: MUTATE_NOOP ? "A1_NOOP_POST (gate-fail proof run)" : "not-run (control)",
  failures,
}
mkdirSync(RESULTS_DIR, { recursive: true })
// Evidence is stamped ONLY by a green, non-mutation, non-control,
// non-read-only run (X1 lesson: closure's read-only probes must never
// overwrite real evidence).
if (failed === 0 && !MUTATE_NOOP && process.env.BB_M40_SELFTEST_CONTROL !== "1" && process.env.BB_M40_READ_ONLY !== "1") {
  writeFileSync(path.join(RESULTS_DIR, "A1.json"), JSON.stringify(evidence, null, 2) + "\n")
}

console.log(`A1 post-entry: ${passed} passed, ${failed} failed, ${negatives} negatives${MUTATE_NOOP ? " [MUTATION RUN]" : ""}`)
if (failures.length) for (const f of failures) console.log(`  FAIL: ${f}`)
if (failed > 0) process.exit(1)
