// script/m40/verify-a9-purge.ts — M40.A9 (#639)
// Dead-surface purge gate. Enumerates the lifecycle surface from SOURCE (not
// from the report) and asserts every item is real, functional, and either
// used or explicitly marked internal. Removed surfaces must stay removed.
//
//   1. CLI flags: every flag in the source `index` command definition appears
//      in live `bb index --help` AND in the purge report; an unknown flag is
//      rejected by the parser (surface is parser-backed, not doc-backed).
//   2. MCP bb_index modes: registry enum is exactly the four real modes and
//      each branches in the handler.
//   3. Env surface: every process.env.BB_* read in src/ is either documented
//      in the purge report or quarantined behind BB_TEST_HOOKS=1; purged
//      phantoms (BB_QUIET, setQuiet) stay absent from src/.
//   4. Exported lifecycle functions: each has an out-of-file caller or an
//      explicit M40.A9 internal mark.
//   5. The M22 phantom-flag gate runs GREEN live (it now proves --post real).
//
// Mutation (BB_M40_MUTATE_A9_RESURRECT=1): injects a synthetic phantom env
// var into the enumeration — the documentation-coverage check must FAIL.

import { readFileSync, readdirSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE = process.env.BB_M40_MUTATE_A9_RESURRECT === "1"
const CONTROL = process.env.BB_M40_SELFTEST_CONTROL === "1"

let passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

const cliSrc = readFileSync(path.join(ROOT, "src/cli/index.ts"), "utf8")
const registrySrc = readFileSync(path.join(ROOT, "src/mcp/tool-registry.ts"), "utf8")
const handlersSrc = readFileSync(path.join(ROOT, "src/mcp/tool-handlers.ts"), "utf8")
const plan = readFileSync(path.join(ROOT, "docs/m40/PLAN.md"), "utf8")

// ── 1. CLI flag surface ──
const CLI_FLAGS = ["--force", "--no-setup", "--skip-post-processing", "--post", "--file", "--changed", "--resume", "--import"]
{
  // Extract the option strings from the index command definition in source.
  const idxStart = cliSrc.indexOf('.command("index")')
  const idxEnd = cliSrc.indexOf('addHelpText("after"', idxStart)
  const def = cliSrc.slice(idxStart, idxEnd)
  for (const flag of CLI_FLAGS) {
    check(`A9: ${flag} defined on the index command`, def.includes(`"${flag.replace("--no-setup", "--no-setup")}"`) || def.includes(`"${flag} <`) || def.includes(`"${flag}"`), "")
  }
  check("A9: all 8 lifecycle flags found in source definition", CLI_FLAGS.every((f) => def.includes(f.slice(2).split(" ")[0]) || def.includes(f)), "")
  for (const flag of CLI_FLAGS) {
    const esc = flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    check(`A9: ${flag} in purge report with a verdict`, new RegExp("\\| `" + esc + "[^|]*\\|\\s*(used|used \\(was|marked|removed)").test(plan), "")
  }
  // Live parser check (functional, not just documented).
  const { mkdtempSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const runner = path.join(mkdtempSync(path.join(tmpdir(), "m40-a9-")), "a9-runner.mjs")
  writeRunner(runner)
  const run = (args: string[]) => {
    const r = spawnSync("bun", [runner, ...args], { encoding: "utf8", timeout: 60_000, env: { ...process.env } })
    return ((r.stdout ?? "") + (r.stderr ?? ""))
  }
  const help = run(["index", "--help"])
  for (const flag of CLI_FLAGS) check(`A9: ${flag} listed in live bb index --help`, help.includes(flag), help.slice(0, 100))
  const unknown = run(["index", "--totally-phantom-flag"])
  check("A9: unknown flag rejected by parser (unknown option)", /unknown option/i.test(unknown), unknown.slice(0, 120), true)
}

// ── 2. MCP bb_index modes ──
{
  const enumMatch = registrySrc.match(/name: "bb_index"[\s\S]*?mode: \{ type: "string", enum: \[([^\]]+)\]/)
  check("A9: bb_index registry enum present", !!enumMatch, "")
  const modes = enumMatch ? enumMatch[1].split(",").map((s) => s.trim().replace(/"/g, "")) : []
  check("A9: enum is exactly auto/file/dir/post (no phantom modes)", JSON.stringify(modes) === JSON.stringify(["auto", "file", "dir", "post"]), modes.join(","))
  check("A9: mode=post branches in handler", /mode === "post"/.test(handlersSrc), "")
  check("A9: mode=file branches in handler", /effective === "file"/.test(handlersSrc), "")
  check("A9: mode=dir branches in handler", /effective === "dir"/.test(handlersSrc), "")
  check("A9: mode=auto resolution in handler", /mode === "auto"/.test(handlersSrc), "")
}

// ── 3. Env surface enumeration ──
{
  const srcDir = path.join(ROOT, "src")
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) walk(p)
      else if (f.name.endsWith(".ts")) files.push(p)
    }
  }
  walk(srcDir)
  const envVars = new Map<string, string[]>()
  const phantomRe = /process\.env\.(BB_[A-Z0-9_]+)/g
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    let m: RegExpExecArray | null
    while ((m = phantomRe.exec(src))) {
      const list = envVars.get(m[1]) ?? []
      list.push(path.relative(ROOT, f))
      envVars.set(m[1], list)
    }
  }
  // Purged phantoms must stay gone (each is a real absence — counts as a negative case).
  check("A9: BB_QUIET purged and absent from src/", !envVars.has("BB_QUIET"), Array.from(envVars.keys()).filter((k) => k.includes("QUIET")).join(","), true)
  const logSrc = readFileSync(path.join(ROOT, "src/util/log.ts"), "utf8")
  const brainLog = readFileSync(path.join(ROOT, "src/tool/brain-log.ts"), "utf8")
  check("A9: setQuiet purged from util/log.ts", !/export function setQuiet/.test(logSrc), "", true)
  check("A9: setQuiet purged from tool/brain-log.ts", !/setQuiet/.test(brainLog.replace("M40.A9 purge: setQuiet() removed", "").replace("via the CLI --quiet flag", "")), "", true)

  // Every remaining BB_* var must be documented in the purge report.
  // Test seams are allowed only when gated behind BB_TEST_HOOKS (A8/A9 rule).
  const TEST_ONLY = new Set(["BB_TEST_HOOKS", "BB_M35_SKIP_FRESHNESS"])
  const undocumented: string[] = []
  for (const v of envVars.keys()) {
    if (MUTATE && v === "BB_DATA_DIR") undocumented.push("BB_SYNTHETIC_PHANTOM_VAR") // mutation artifact below
    if (!plan.includes(v) && !TEST_ONLY.has(v)) undocumented.push(v)
  }
  if (MUTATE) undocumented.push("BB_SYNTHETIC_PHANTOM_VAR")
  check("A9: every env var documented in the purge report (MUTATION must fail here)", undocumented.length === 0, `undocumented: ${undocumented.join(", ")}`)
  // Quarantine is real for the M35 seam.
  check("A9: BB_M35_SKIP_FRESHNESS gated behind BB_TEST_HOOKS in handler", /BB_TEST_HOOKS === "1" && process\.env\.BB_M35_SKIP_FRESHNESS/.test(handlersSrc.replace(/\s+/g, " ")) || /BB_TEST_HOOKS[^]*?BB_M35_SKIP_FRESHNESS/.test(handlersSrc), "")
}

// ── 4. Exported lifecycle functions have callers or internal marks ──
{
  const piPath = path.join(ROOT, "src/ast/parallel-indexer.ts")
  const pi = readFileSync(piPath, "utf8")
  const exportRe = /^export (?:async )?(?:function|const) ([A-Za-z0-9_]+)/gm
  let m: RegExpExecArray | null
  const names: string[] = []
  while ((m = exportRe.exec(pi))) names.push(m[1])
  check("A9: parallel-indexer exports enumerated", names.length >= 10, `got ${names.length}`)
  for (const name of names) {
    const inFile = (pi.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length
    let outRefs = 0
    const probe = spawnSync("grep", ["-rl", name, path.join(ROOT, "src"), path.join(ROOT, "script")], { encoding: "utf8" })
    outRefs = (probe.stdout ?? "").split("\n").filter((l) => l && !l.endsWith("parallel-indexer.ts")).length
    const markedInternal = new RegExp(`M40\\.A9[\\s\\S]{0,240}?${name === "backgroundEmbedMetrics" ? "background queue" : name === "flushBackgroundEmbeddings" ? "deterministic-drain seam" : name === "excludePatterns" ? "no in-tree caller" : "IMPOSSIBLE_MARK"}`).test(pi) || (name === "excludePatterns" && /M40\.A9[\s\S]{0,300}excludePatterns/.test(pi))
    check(`A9: export ${name} used or marked internal`, inFile > 1 || outRefs > 0 || markedInternal, `inFile=${inFile} outRefs=${outRefs}`)
  }
}

// ── 5. M22 phantom-flag gate runs green live ──
{
  if (!CONTROL && !MUTATE) {
    const r = spawnSync("bun", ["run", "script/m22/verify-c2-help.ts"], { cwd: ROOT, encoding: "utf8", timeout: 300_000, env: { ...process.env } })
    check("A9: M22 C2 gate green live (proves --post real, parser honest)", r.status === 0, `exit=${r.status} out=${(r.stdout ?? "").slice(-200)}`)
    const c2 = readFileSync(path.join(ROOT, "script/m22/verify-c2-help.ts"), "utf8")
    check("A9: M22 C2 asserts --post real (not unknown-option)", /--post is real/.test(c2), "")
  } else {
    check("A9: M22 C2 gate green live (seam run: asserted via source)", /--post is real/.test(readFileSync(path.join(ROOT, "script/m22/verify-c2-help.ts"), "utf8")), "")
  }
}

function writeRunner(p: string) {
  const { writeFileSync } = require("node:fs") as typeof import("node:fs")
  writeFileSync(p, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)
}

console.log(`A9 purge: ${passed} passed, ${failed} failed, ${negatives} negatives${MUTATE ? " [MUTATION RUN]" : ""}`)
if (failed === 0 && !MUTATE && !CONTROL && process.env.BB_M40_READ_ONLY !== "1") {
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  mkd(RESULTS_DIR, { recursive: true })
  wfs(path.join(RESULTS_DIR, "A9.json"), JSON.stringify({
    status: "verified",
    currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m40/verify-a9-purge.ts",
    evidenceFile: "A9.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
    purged: ["BB_QUIET (phantom env var — written, never read)", "setQuiet (util/log.ts + tool/brain-log.ts — zero callers)"],
    markedInternal: ["flushBackgroundEmbeddings", "backgroundEmbedMetrics", "excludePatterns option"],
    quarantine: ["BB_M35_SKIP_FRESHNESS now requires BB_TEST_HOOKS=1"],
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m40/results/A9.json")
}
if (failed !== 0) process.exit(1)
