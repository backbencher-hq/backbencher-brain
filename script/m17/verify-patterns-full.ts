// script/m17/verify-patterns-full.ts — M17.P1 (bb_patterns recordRun).
//
// Evidence for P1: "bb_patterns recordRun persists the FULL analyzed set".
//
//   1. Re-run the committed regression gate (verify-tool-history.ts) — its
//      section B uses a 30-orphan fixture with limit=20 and requires
//      recorded == found == DB rows (31/31/31). Proves the fix bites.
//   2. Real-repo e2e: index a copy of rake (Ruby), run the production CLI
//      bb_patterns with recordRun:true and limit=20, and assert:
//        - found > 20  (the repo genuinely exceeds the display limit)
//        - recorded == found  (history holds the FULL analyzed set)
//        - DB persisted count == recorded
//   3. Emit validation/m17/results/P1.json.
//
// Negative line: does not prove orphan/framework detection accuracy — only
// that what recordRun persists equals the full detected set (no truncation).

import { writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
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

async function main() {
  console.log("── P1.1  shared regression gate (verify-tool-history.ts B) ──")
  try {
    const out = execFileSync("bun", ["run", "script/verify-tool-history.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" })
    ck("P1: shared regression gate passes (31 found == 31 recorded == DB)", out.includes("TOOL HISTORY VERIFY: ALL PASS") && out.includes("patterns (31 found, 31 recorded)"), "tail=" + out.trim().slice(-80))
  } catch (e: any) {
    ck("P1: shared regression gate passes", false, String(e?.stdout || e?.message || e).slice(0, 160))
  }

  console.log("── P1.2  real-repo e2e: rake with limit=20 ──")
  const src = "$HOME/fixtures/repositories/rake"
  let found = 0, recorded = 0, persistedDb = 0
  if (!existsSync(src)) {
    ck("P1: rake corpus present", false, "MISSING " + src + " (reported, not skipped)")
  } else {
    const tmp = mkdtempSync(path.join(tmpdir(), "m17p1-"))
    let pid = ""
    try {
      cpSync(src, tmp, { recursive: true })
      pid = getProjectId(tmp)
      await indexProjectParallel(pid, tmp, {})
      await flushBackgroundEmbeddings(pid)

      const out = runCli(["tool", "bb_patterns", "--dir", tmp, "--args", JSON.stringify({ scope: "all", limit: 20, recordRun: true })])
      const m = out.match(/patterns \((\d+) found, (\d+) recorded\)/)
      ck("P1: output reports explicit found+recorded counts", !!m, out.split("\n")[0]?.slice(0, 140) ?? out.slice(0, 140))
      found = m ? Number(m[1]) : 0
      recorded = m ? Number(m[2]) : 0
      nk("P1: rake exceeds the display limit (test bites)", found > 20, "found=" + found)
      ck("P1: recorded == found (full analyzed set, not slice)", recorded === found, `recorded=${recorded} found=${found}`)

      const { BrainDatabase } = await import("../../src/brain/database")
      const raw = await BrainDatabase.getRawInstance(pid)
      persistedDb = (raw.prepare("SELECT COUNT(*) c FROM brain_analysis_finding WHERE project_id=? AND kind='patterns'").get(pid) as any).c
      ck("P1: DB persisted count == recorded", persistedDb === recorded, `db=${persistedDb} recorded=${recorded}`)
      console.log("    [rake] found=" + found + " recorded=" + recorded + " db=" + persistedDb)
    } finally {
      if (pid) { try { await flushBackgroundEmbeddings(pid) } catch {} }
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  const e = { issue: "M17.P1", code: "P1", tool: "bb_patterns", title: "recordRun persists the full analyzed set", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), measured: { found, recorded, persistedDb }, negativeLine: "Proves persistence equivalence (no truncation), not pattern-detection heuristic quality." }
  writeFileSync(path.join(RESULTS_DIR, "P1.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("P1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()