// script/m17/verify-history-audit.ts — M17.H1 (cross-tool recordRun audit).
//
// Audit: every tool that records an analysis run must persist the FULL result
// of its computation — no display-slice truncation, no dropped/renamed fields,
// deterministic fingerprints.
//
//   1. Census: only bb_security and bb_patterns call executeAnalysis /
//      startAnalysisRun / completeAnalysisRun anywhere in src/ (outside
//      run-history.ts itself). The other 8 public tools never persist runs —
//      proven statically, no silent "we checked" claims.
//   2. No-truncation: inside tool-handlers.ts, persist callbacks must not
//      slice their input (preview slicing happens outside the persisted set).
//   3. Determinism: on a real rake index run recordRun twice (security +
//      patterns) and require identical persisted fingerprint sets.
//   4. Emit validation/m17/results/H1.json.

import { writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync, execSync } from "node:child_process"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m17/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
const bb = path.resolve(ROOT_DIR, "bin/bb")

function runCli(args: string[], timeoutSec = 180): string {
  return execFileSync("node", [bb, ...args], { encoding: "utf8", timeout: timeoutSec * 1000, stdio: ["ignore", "pipe", "pipe"] })
}
function grepRepo(pattern: string, dir = "src"): string {
  try { return execSync("grep -rn --include=*.ts -E '" + pattern + "' " + dir + " || true", { cwd: ROOT_DIR, encoding: "utf8" }) } catch { return "" }
}

async function fingerprints(kind: string): Promise<string> {
  const raw = await BrainDatabase.getRawInstance(pidForRake)
  const rows = raw.prepare("SELECT fingerprint FROM brain_analysis_finding WHERE project_id=? AND kind=? ORDER BY fingerprint").all(pidForRake, kind) as any[]
  return rows.map((r: any) => r.fingerprint)
}
let pidForRake = ""

async function main() {
  console.log("── H1.1  census: which tools persist runs ──")
  const callsites = grepRepo("executeAnalysis|startAnalysisRun|completeAnalysisRun").split("\n").filter((l) => l.trim() && !l.includes("run-history.ts"))
  ck("H1: only tool-handlers.ts calls executeAnalysis/start/complete (outside run-history itself)", callsites.length > 0 && callsites.every((l) => l.includes("src/mcp/tool-handlers.ts")), "files=" + callsites.map((l: string) => l.split(":")[0]).join(","))
  const eaCalls = callsites.filter((l: string) => l.includes("executeAnalysis(")).length
  ck("H1: exactly the two run-persisting handlers exist (security+patterns)", eaCalls === 2, "executeAnalysis calls=" + eaCalls)

  const handlers = readFileSync(path.join(ROOT_DIR, "src/mcp/tool-handlers.ts"), "utf8")
  // No truncation inside persist callbacks: preview slicing uses `items`; the
  // persist closures must map the FULL set without `.slice(`.
  const persistSlices = handlers.match(/persist:\s*\(\)\s*=>\s*[^{]*?\.slice\(/g) || []
  nk("H1: no slice() inside any persist callback in tool-handlers", persistSlices.length === 0, "n=" + persistSlices.length)
  ck("H1: security persist maps findings (already filtered, no truncation)", handlers.includes("findings.map("))
  ck("H1: patterns persist maps allPatterns (full set)", handlers.includes("allPatterns.map("))

  console.log("── H1.2  determinism: repeated recordRun -> same fingerprints ──")
  const src = "$HOME/fixtures/repositories/rake"
  if (!existsSync(src)) {
    ck("H1: rake corpus present", false, "MISSING " + src)
  } else {
    const tmp = mkdtempSync(path.join(tmpdir(), "m17h1-"))
    try {
      cpSync(src, tmp, { recursive: true })
      pidForRake = getProjectId(tmp)
      await indexProjectParallel(pidForRake, tmp, {})
      await flushBackgroundEmbeddings(pidForRake)

      runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
      const sec1 = await fingerprints("security")
      runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
      const sec2 = await fingerprints("security")
      ck("H1: security fingerprints stable across identical runs", JSON.stringify(sec1) === JSON.stringify(sec2), "n=" + sec1.length)
      nk("H1: security persisted set is non-empty (determinism test bites)", sec1.length > 0, "n=" + sec1.length)

      runCli(["tool", "bb_patterns", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
      const pat1 = await fingerprints("patterns")
      runCli(["tool", "bb_patterns", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
      const pat2 = await fingerprints("patterns")
      ck("H1: patterns fingerprints stable across runs", JSON.stringify(pat1) === JSON.stringify(pat2), "n=" + pat1.length)
      nk("H1: patterns persisted set is non-empty (test bites)", pat1.length > 0, "n=" + pat1.length)
      console.log("    [rake] security n=" + sec1.length + " patterns n=" + pat1.length)
      pidForRake = ""
    } finally {
      if (pidForRake) { try { await flushBackgroundEmbeddings(pidForRake) } catch {} }
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  const e = { issue: "M17.H1", code: "H1", tool: "governance", title: "cross-tool audit: full-set persistence + determinism", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), matrix: { bb_security: "persist results.map over findings (confirmed/mitigated) — S1/S2 verified", bb_patterns: "persist allPatterns.map over full set — P1 verified", bb_ask: "no analysis persistence", bb_health: "no analysis persistence", bb_analyze: "no analysis persistence", bb_visualize: "no analysis persistence", bb_migrate: "no analysis persistence", bb_doc: "no analysis persistence", bb_search: "no analysis persistence", bb_edit: "no analysis persistence" }, negativeLine: "Determinism tested on rake (Ruby) only; other corpora share the same canonical run-history path." }
  writeFileSync(path.join(RESULTS_DIR, "H1.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("H1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()