// script/m17/verify-sec-history.ts — M17.S1 (bb_security history cleanliness).
//
// Evidence for S1: "source-only observations never become findings or history".
//
//   1. Re-run the committed regression gate (script/verify-tool-history.ts)
//      as a subprocess and require ALL PASS (fixture + state matrix).
//   2. Real-repo e2e on rake/lib (Ruby): a real index that genuinely contains
//      source-only rows (M16 observed 23 unvalidated sources there). Run the
//      production CLI `bb_security` with recordRun, then history, and assert:
//        - live summary reports unresolvedSources > 0  (the test bites)
//        - persisted history contains NO severity "unknown" / rule "unresolved"
//        - persisted count == live confirmed+mitigated findings count
//   3. Emit validation/m17/results/S1.json (failures exit non-zero).
//
// Negative line (what this does NOT prove): analysis-level correctness of the
// taint tool (e.g. phantom `def execute` -> sql_injection is an analyzer-domain
// gap, documented in docs/BB_SECURITY.md and routed to the analyzer milestone);
// this gate only proves the persistence/history axis.

import { writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
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

function runCli(args: string[], timeoutSec = 120): string {
  return execFileSync("node", [bb, ...args], { encoding: "utf8", timeout: timeoutSec * 1000, stdio: ["ignore", "pipe", "pipe"] })
}

async function main() {
  // ── 1. Regression gate (real fixture + state matrix, committed) ──────────
  console.log("── S1.1  shared regression gate (verify-tool-history.ts) ──")
  try {
    const out = execFileSync("bun", ["run", "script/verify-tool-history.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" })
    ck("S1: shared regression gate passes", out.includes("TOOL HISTORY VERIFY: ALL PASS"), "tail=" + out.trim().slice(-60))
  } catch (e: any) {
    ck("S1: shared regression gate passes", false, String(e?.stdout || e?.message || e).slice(0, 160))
  }

  // ── 2. Real-repo e2e (rake, Ruby) ───────────────────────────────────────
  const src = "$HOME/fixtures/repositories/rake"
  let liveFindings = 0, unresolvedSources = 0, histFindings = 0, badHistory = -1
  console.log("── S1.2  real-repo e2e: " + src + " ──")
  if (!existsSync(src)) {
    ck("S1: rake repo present", false, "missing " + src + " (reported, not skipped)")
  } else {
    const tmp = mkdtempSync(path.join(tmpdir(), "m17s1-"))
    let pid = ""
    try {
      cpSync(src, tmp, { recursive: true })
      pid = getProjectId(tmp)
      await indexProjectParallel(pid, tmp, {})
      await flushBackgroundEmbeddings(pid)

      const { analyzeTaintFlows } = await import("../../src/intelligence/security/taint")
      const strict = await analyzeTaintFlows(pid, { maxResults: 100000 })
      liveFindings = strict.findings.filter((f) => f.state === "confirmed" || f.state === "mitigated").length
      unresolvedSources = strict.findings.filter((f) => f.state === "source_only" || f.state === "unresolved").length
      nk("S1: rake index contains source-only rows (test bites)", unresolvedSources > 0, "unresolvedSources=" + unresolvedSources)

      runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
      const histOut = runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ history: true, limit: 50 })])
      const hist = JSON.parse(histOut)

      const bad = hist.findings.filter((f: any) => f.severity === "unknown" || f.rule === "unresolved")
      badHistory = bad.length
      histFindings = hist.findings.length
      nk("S1: history contains no severity=unknown / rule=unresolved", bad.length === 0, "bad=" + bad.length)
      ck("S1: history reports a recorded run", (hist.runs || []).length > 0, "runs=" + (hist.runs || []).length)
      ck("S1: persisted history findings count equals live confirmed+mitigated count", hist.findings.length === liveFindings, "hist=" + hist.findings.length + " live=" + liveFindings)
    } finally {
      if (pid) { try { await flushBackgroundEmbeddings(pid) } catch {} }
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ── 3. Evidence emission ────────────────────────────────────────────────
  const e = { issue: "M17.S1", code: "S1", tool: "bb_security", title: "source-only observations never become findings or history", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), negativeLine: "Does NOT prove taint-detection correctness (phantom sinks are an analyzer-domain gap routed to the analyzer milestone); proves only the history/persistence axis.", measured: { liveFindings: liveFindings ?? null, unresolvedSources: unresolvedSources ?? null, histFindings: histFindings ?? null, badHistory: badHistory ?? null } }
  writeFileSync(path.join(RESULTS_DIR, "S1.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("S1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()