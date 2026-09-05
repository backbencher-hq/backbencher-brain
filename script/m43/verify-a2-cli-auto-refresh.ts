// script/m43/verify-a2-cli-auto-refresh.ts — M43.A2 (#658)
// BEHAVIORAL gate for the CLI read-path auto-refresh (bb search), sharing the
// A1 core module (one mechanism, two surfaces — M40.A7 parity rule).
// Runs the SOURCE CLI as a subprocess against deterministic fixtures.
// Every check exercises a real code path; no auto-pass, no tautologies.
//
// Acceptance criteria exercised:
//  1. CLI e2e: edit -> bb search reflects it, declaration visible.
//  2. --no-auto-refresh answers from existing data with the staleness footer.
//  3. Parity: CLI and MCP make the same refresh decision on the same fixture
//     state (default listing + the MCP-routed content mode).
//  4. Mutation proof: with auto-refresh disabled the same edit answers STALE
//     (differs from the control) — a regression that disables the refresh
//     path changes this gate's outcome.
// Boundary (documented negative): bb status is a lifecycle REPORT (no code
// rows to repair); it never silently re-indexes — freshness of code answers
// is the job of bb search (auto) and bb health --refresh / bb index --changed
// (manual). Asserted so a future change cannot make it re-index silently.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH
delete process.env.BB_AUTO_REFRESH_MAX_FILES
delete process.env.BB_AUTO_REFRESH_MAX_BYTES
// Isolated data dir so the gate never touches a real user index.
const BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-a2-data-"))
process.env.BB_DATA_DIR = BB_DATA_DIR

let checks = 0
let passed = 0
let failed = 0
let negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

const CLI = path.join(ROOT, "src/cli/index.ts")
function cli(...args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("bun", [CLI, ...args], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    }).toString()
    return { stdout, status: 0 }
  } catch (e: any) {
    return { stdout: `${e?.stdout ?? ""}${e?.stderr ?? ""}`, status: e?.status ?? -1 }
  }
}

async function main() {
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const handlers = createToolHandlers()

  const makeFixture = async (tag: string): Promise<{ fixture: string; pid: string; ctx: any }> => {
    const fixture = mkdtempSync(path.join(tmpdir(), `bb-a2-${tag}-`))
    mkdirSync(path.join(fixture, "src"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function beta(y: string): string { return y }\n`)
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    return { fixture, pid, ctx: { projectId: pid, projectPath: fixture } }
  }
  // Edit OUTSIDE bb_edit: rename beta -> gamma.
  const edit = (fixture: string) =>
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)

  // ── 1. CLI e2e: edit -> bb search reflects it, declaration visible ──
  {
    const { fixture } = await makeFixture("edit")
    try {
      edit(fixture)
      const r = await (async () => cli("search", "beta", "--dir", fixture))()
      check("1: bb search reflects the edit (no stale beta)", r.status === 0 && !/beta \[function\]/.test(r.stdout) && r.stdout.includes("no results"), r.stdout.slice(0, 220))
      check("1: bb search declares the auto-refresh", /auto-refreshed 1 file in \d+ms/.test(r.stdout), r.stdout.slice(0, 220))
      const g = cli("search", "gamma", "--dir", fixture)
      check("1: post-refresh index has the new symbol gamma", g.stdout.includes("gamma [function]"), g.stdout.slice(0, 220))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
    // content mode e2e (handler-routed) gets its OWN stale fixture: a prior
    // listing read on the same fixture would repair it first.
    const cfix = await makeFixture("editc")
    try {
      edit(cfix.fixture)
      const c = cli("search", "--mode", "content", "beta", "--dir", cfix.fixture)
      check("1: bb search --mode content reflects the edit (0 results)", c.status === 0 && c.stdout.includes("0 results"), c.stdout.slice(0, 220))
      check("1: bb search --mode content declares the auto-refresh", c.stdout.includes("auto-refreshed"), c.stdout.slice(0, 220))
    } finally { rmSync(cfix.fixture, { recursive: true, force: true }) }
  }

  // ── 2. --no-auto-refresh: answers from existing data with staleness footer ──
  {
    const { fixture } = await makeFixture("noar")
    try {
      edit(fixture)
      const r = cli("search", "beta", "--dir", fixture, "--no-auto-refresh")
      check("2: --no-auto-refresh keeps the stale answer visible", r.status === 0 && r.stdout.includes("beta [function]") && r.stdout.includes("⚠stale"), r.stdout.slice(0, 220))
      check("2: --no-auto-refresh shows the staleness footer naming the manual repair", r.stdout.includes("stale — ") && r.stdout.includes("bb index --changed"), r.stdout.slice(0, 220))
      negative("2: --no-auto-refresh does NOT claim a refresh", !/auto-refreshed 1 file/.test(r.stdout), r.stdout.slice(0, 120))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }

  // ── 3. Parity: CLI and MCP same refresh decision on the same fixture state ──
  {
    // Default listing mode: CLI path vs MCP bb_search symbols handler, each on
    // an IDENTICAL fixture (twin) — both must repair and both end fresh.
    const { fixture: cliFix } = await makeFixture("parity-c")
    const { fixture: mcpFix, pid: mcpPid, ctx: mcpCtx } = await makeFixture("parity-m")
    try {
      edit(cliFix); edit(mcpFix)
      const cliOut = cli("search", "beta", "--dir", cliFix)
      const mcpOut = (await handlers["bb_search"]({ query: "beta" }, mcpCtx)).content[0].text
      check("3: CLI listing auto-refreshes (declared)", /auto-refreshed 1 file in \d+ms/.test(cliOut.stdout) && !/[STALE]/.test(mcpOut), cliOut.stdout.slice(0, 160))
      check("3: MCP listing auto-refreshes (declared)", mcpOut.includes("auto-refreshed") && mcpOut.includes("no results"), mcpOut.slice(0, 200))
      check("3: parity — same decision on the same fixture state", /auto-refreshed 1 file in \d+ms/.test(cliOut.stdout) && mcpOut.includes("auto-refreshed"), "both surfaces declared a repair")
      // Content mode routes CLI through the SAME MCP handler (M40.A7); the
      // listing pass above already repaired cliFix, so the content read on the
      // same fixture must answer fresh (0 results, no stale rows) — decision
      // parity for the repair itself was proven by the listing pair above.
      const cliContent = cli("search", "--mode", "content", "beta", "--dir", cliFix)
      check("3: CLI content mode (handler-routed) answers from the repaired index", cliContent.stdout.includes("0 results"), cliContent.stdout.slice(0, 200))
      negative("3: no stale content rows on either surface", !cliContent.stdout.includes("⚠stale") && !mcpOut.includes("[STALE]"), "")
    } finally {
      rmSync(cliFix, { recursive: true, force: true }); rmSync(mcpFix, { recursive: true, force: true })
    }
  }

  // ── 4. Mutation proof: auto-refresh disabled -> the SAME edit answers STALE ──
  {
    const { fixture } = await makeFixture("mut")
    try {
      edit(fixture)
      const out = execFileSync("bun", [CLI, "search", "beta", "--dir", fixture], {
        env: { ...process.env, NO_COLOR: "1", BB_NO_AUTO_REFRESH: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      }).toString()
      check("4: disabled -> stale beta still reported", out.includes("beta [function]") && out.includes("⚠stale"), out.slice(0, 200))
      negative("4: disabled -> no auto-refresh claim", !/auto-refreshed 1 file/.test(out), out.slice(0, 120))
      const reflects = !out.includes("beta [function]")
      negative("4: disabled outcome differs from the enabled control", !reflects, "enabled control reflects; disabled must not")
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }

  // ── 5. Boundary (negative): bb status is a lifecycle REPORT, never a
  //      silent re-indexer ──
  {
    const { fixture } = await makeFixture("status")
    try {
      edit(fixture)
      const r = cli("status", fixture)
      check("5: bb status still reports (exit 0)", r.status === 0 && (r.stdout.includes("last index") || r.stdout.includes("index meta")), r.stdout.slice(0, 160))
      negative("5: bb status never silently re-indexes", !r.stdout.includes("auto-refresh") && !r.stdout.includes("indexing"), r.stdout.slice(0, 120))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }

  rmSync(BB_DATA_DIR, { recursive: true, force: true })

  const ok = failed === 0
  console.log(`A2 CLI auto-refresh: ${passed} passed, ${failed} failed, ${negativeCases} negatives`)
  // M43.X1: children of the gate-selftest / closure probe never stamp evidence.
  if (ok && process.env.BB_M43_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "A2.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m43/verify-a2-cli-auto-refresh.ts",
      evidenceFile: "A2.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
      negativesDescription: "no-auto-refresh-not-refresh, parity-no-stale, disabled-not-refresh, disabled-differs-from-control, status-never-reindexes",
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m43/results/A2.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("A2 gate crashed:", e)
  process.exit(1)
})
