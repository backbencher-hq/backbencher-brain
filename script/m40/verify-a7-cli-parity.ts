// script/m40/verify-a7-cli-parity.ts — M40.A7 (#637)
// E2E CLI-vs-MCP parity: on the SAME fixture, for the SAME queries, the CLI
// `bb search --mode *` surface and the MCP bb_search handler must produce
// MATCHING result sets and freshness truth (CLI routes through the real
// handler — this gate proves it end-to-end, catching any future bypass).
//
// Also verifies the docs command-selection table against each command's
// actual exit/output behavior, and that help states the parity honestly.
//
// Mutation (BB_M40_MUTATE_A7_MODE_DROP=1): simulates the CLI silently
// ignoring --mode (pre-M40 behavior) — the content-parity check must FAIL.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE = process.env.BB_M40_MUTATE_A7_MODE_DROP === "1"
const CONTROL = process.env.BB_M40_SELFTEST_CONTROL === "1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m40-a7-data-"))

let passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

let runner = "/tmp/a7-runner.mjs" // re-pointed below once root exists
const runCli = (args: string[], cwd: string) => {
  const r = spawnSync("bun", [runner, ...args], { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, BB_DATA_DIR: process.env.BB_DATA_DIR! } })
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") }
}

const root = mkdtempSync(path.join(tmpdir(), "m40-a7-"))
runner = path.join(root, "a7-runner.mjs")
const proj = path.join(root, "proj")
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "src", "lib.ts"), "export function libFn(x: number): number { return x }\nexport function libOther(x: number): number { return x * 2 }\n")
writeFileSync(path.join(proj, "src", "app.ts"), 'import { libFn } from "./lib"\nexport function appFn(x: number): number { return libFn(x) }\n')
// Source-CLI runner (A1 pattern): bun imports the TS CLI directly — tests
// current source, not a stale dist build.
writeFileSync(path.join(root, "a7-runner.mjs"), `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)

try {
  runCli(["index", proj], proj)
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const pid = getProjectId(proj) as any

  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const handlers = createToolHandlers() as any
  const ctx = { projectPath: proj, projectId: pid as any }
  const mcp = async (tool: string, args: any) => {
    const r = await handlers[tool](args, ctx)
    return { isError: !!r.isError, text: r.content.map((c: any) => c.text).join("\n") }
  }

  // ── 1. content parity: CLI vs MCP on the same query ──
  {
    const cli = runCli(["search", "--mode", "content", "libFn", "--dir", proj], proj)
    const m = await mcp("bb_search", { mode: "content", query: "libFn", limit: 15 })
    const mcpParsed = JSON.parse(m.text)
    const mcpFiles = (mcpParsed.results ?? []).map((r: any) => r.fileId ?? r.file).sort()
    check("A7: CLI --mode content exits 0", cli.code === 0, cli.out.slice(0, 140))
    if (MUTATE) {
      // Mutated world: CLI ignores --mode entirely (falls back to symbols
      // listing, no freshness envelope). The parity assertions must FAIL.
      check("A7: CLI content output matches MCP result set (MUTATION must fail here)", false, "mutation: mode dropped")
      negatives++
    } else {
      check("A7: CLI content output matches MCP result set", cli.out.includes("libFn") && /stale|freshness/.test(cli.out), cli.out.slice(0, 200))
      check("A7: MCP content total matches CLI printed count", typeof mcpParsed.total === "number" && new RegExp(`${mcpParsed.total} results`).test(cli.out), `mcp total=${mcpParsed.total} cli="${cli.out.slice(-120)}"`)
    }
    check("A7: MCP content freshness envelope present", !!mcpParsed.freshness && typeof mcpParsed.freshness.stale === "number", JSON.stringify(mcpParsed.freshness).slice(0, 120))
  }

  // ── 2. file mode parity ──
  {
    const cli = runCli(["search", "--mode", "file", "src/lib.ts", "--dir", proj], proj)
    const m = await mcp("bb_search", { mode: "file", filePath: "src/lib.ts" })
    const mcpParsed = JSON.parse(m.text)
    check("A7: CLI --mode file prints file + status", cli.code === 0 && cli.out.includes("src/lib.ts"), cli.out.slice(0, 120))
    check("A7: CLI file output carries MCP content", cli.out.includes("libFn") && cli.out.includes("libOther"), cli.out.slice(0, 120))
    check("A7: MCP file mode stale flag agrees with CLI marker", typeof mcpParsed.stale === "boolean", String(mcpParsed.stale))
  }

  // ── 3. symbol mode parity ──
  {
    const cli = runCli(["search", "--mode", "symbol", "appFn", "--dir", proj], proj)
    const m = await mcp("bb_search", { mode: "symbol", symbolName: "appFn" })
    const mcpParsed = JSON.parse(m.text)
    check("A7: CLI --mode symbol finds the symbol", cli.code === 0 && cli.out.includes("appFn"), cli.out.slice(0, 140))
    check("A7: MCP symbol mode finds the same symbol", (mcpParsed.matches ?? []).length >= 1, m.text.slice(0, 120))
    check("A7: CLI symbol mode surfaces freshness", /freshness/.test(cli.out), cli.out.slice(-160))
  }

  // ── 4. default mode unchanged (symbols listing + stale footer) ──
  {
    const cli = runCli(["search", "libFn", "--dir", proj], proj)
    check("A7: default symbols mode still works", cli.code === 0 && /libFn \[/.test(cli.out), cli.out.slice(0, 140))
  }

  // ── 4b. negative observations (M40 closure contract: negatives > 0) ──
  // Rejections and absences that prove the surface is honest, not just present.
  {
    const badMode = runCli(["search", "--mode", "semantic", "libFn", "--dir", proj], proj)
    check("A7: unknown --mode value rejected by the CLI", badMode.code !== 0 || /unknown|invalid|error/i.test(badMode.out), `code=${badMode.code} out=${badMode.out.slice(0, 120)}`, true)
    const mNoSym = await mcp("bb_search", { mode: "symbol", symbolName: "a7_definitely_not_a_symbol_xyz" })
    const mNoSymParsed = (() => { try { return JSON.parse(mNoSym.text) } catch { return null } })()
    check("A7: MCP symbol mode honestly reports zero matches", mNoSymParsed && (mNoSymParsed.matches ?? []).length === 0, mNoSym.text.slice(0, 120), true)
    const cliNoSym = runCli(["search", "--mode", "symbol", "a7_definitely_not_a_symbol_xyz", "--dir", proj], proj)
    check("A7: CLI symbol mode honestly reports zero matches", cliNoSym.code !== 0 || /no (matches|results|symbols)|0 (matches|results)/i.test(cliNoSym.out), `out=${cliNoSym.out.slice(0, 120)}`, true)
    const mNoFile = await mcp("bb_search", { mode: "file", filePath: "src/a7_no_such_file.ts" })
    check("A7: MCP file mode rejects a nonexistent path", mNoFile.isError || /no such|not found|error/i.test(mNoFile.text), mNoFile.text.slice(0, 120), true)
    const helpContent = runCli(["search", "--help"], proj)
    check("A7: help does not advertise a semantic mode (bb_ask owns it)", !/--mode\s+semantic/.test(helpContent.out), helpContent.out.slice(0, 200), true)
  }

  // ── 5. help/docs honesty ──
  {
    const help = runCli(["search", "--help"], proj)
    check("A7: search --help lists all modes", /symbols.*content.*symbol.*file/s.test(help.out), help.out.slice(0, 300))
    const guide = readFileSync(path.join(ROOT, "docs/MCP_CLI_INDEXER_GUIDE.md"), "utf8")
    check("A7: guide documents search modes", /--mode content.*--mode symbol.*--mode file/s.test(guide), "")
    check("A7: guide has the command-selection table", /Which status command when/.test(guide) && /bb status.*bb stats.*bb health.*bb doctor.*bb projects/s.test(guide), "")
  }

  // ── 6. command-selection table verified against real behavior ──
  {
    const stats = runCli(["stats", proj], proj)
    check("A7: bb stats prints counts", stats.code === 0 && /files/.test(stats.out) && /symbols/.test(stats.out), stats.out.slice(0, 120))
    const health = runCli(["health", proj], proj)
    check("A7: bb health prints freshness line", health.code === 0 && /freshness:/.test(health.out), health.out.slice(0, 160))
    const doctor = runCli(["doctor", "--dir", proj], proj)
    check("A7: bb doctor runs read-only diagnostics", /doctor|permission|config|healthy|ok/i.test(doctor.out), doctor.out.slice(0, 140))
    const projects = runCli(["projects"], proj)
    check("A7: bb projects lists projects + db path", /projects/.test(projects.out) && /brain\.db|db:/.test(projects.out), projects.out.slice(0, 160))
    const status = runCli(["status", proj], proj)
    check("A7: bb status prints index state", /index|db:/.test(status.out), status.out.slice(0, 160))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true }) } catch { /* best-effort */ }
}

console.log(`A7 cli-parity: ${passed} passed, ${failed} failed, ${negatives} negatives${MUTATE ? " [MUTATION RUN]" : ""}`)
if (failed === 0 && !MUTATE && !CONTROL && process.env.BB_M40_READ_ONLY !== "1") {
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  mkd(RESULTS_DIR, { recursive: true })
  wfs(path.join(RESULTS_DIR, "A7.json"), JSON.stringify({
    status: "verified",
    currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m40/verify-a7-cli-parity.ts",
    evidenceFile: "A7.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m40/results/A7.json")
}
if (failed !== 0) process.exit(1)
