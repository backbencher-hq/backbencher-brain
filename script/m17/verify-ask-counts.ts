// script/m17/verify-ask-counts.ts — M17.A8 (bb_ask counts vs DB).
//
// Permanent regression for the M16 defect ("how many functions" returned 0
// when methods were stored as method, not function).
//
//   1. Re-run the committed M16 ask verifier (A1-A4) and require ALL pass —
//      that verifier fails if counts do not match the DB and asserts no-index
//      honesty.
//   2. Real-repo parity: on a copied rake index, ask "how many functions"
//      through quickAnswer and require the answer's number equals the DB
//      function+method count.
//   3. No-index honesty: quickAnswer on an unindexed directory must say
//      no-index/unknown explicitly, never a fabricated 0.
//   4. Emit validation/m17/results/A8.json.

import { writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m17/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

async function main() {
  console.log("── A8.1  committed M16 ask regression gate (A1-A4) ──")
  try {
    const out = execFileSync("bun", ["run", "script/m16/verify-ask-stats.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" })
    const m = out.match(/A4: (VERIFIED|KNOWN-GAP)/)
    ck("A8: M16 ask verifier green (function==method fix)", m?.[1] === "VERIFIED", "status=" + (m?.[1] ?? out.trim().slice(-120)))
  } catch (e: any) {
    ck("A8: M16 ask verifier green", false, String(e?.stdout || e?.message || e).slice(-160))
  }

  console.log("── A8.2  real-repo parity: rake ──")
  const src = "$HOME/fixtures/repositories/rake"
  let real = -1, dbN = -1
  if (!existsSync(src)) {
    ck("A8: rake corpus present", false, "MISSING " + src)
  } else {
    const tmp = mkdtempSync(path.join(tmpdir(), "m17a8-"))
    let pid = ""
    try {
      cpSync(src, tmp, { recursive: true })
      pid = getProjectId(tmp)
      await indexProjectParallel(pid, tmp, {})
      await flushBackgroundEmbeddings(pid)
      const raw = await BrainDatabase.getRawInstance(pid)
      dbN = (raw.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=? AND symbol_type IN ('function','method')").get(pid) as any).c
      const answer = await quickAnswer(pid, "how many functions")
      const text = String(answer?.answer ?? "")
      const num = text.match(/\d+/)?.[0]
      real = num ? Number(num) : -1
      ck("A8: ask function count == DB function+method count", real === dbN, "ask=" + real + " db=" + dbN)
      nk("A8: DB count is non-zero (parity test bites)", dbN > 0, "db=" + dbN)
      console.log("    [rake] ask=" + real + " db=" + dbN)
    } finally {
      if (pid) { try { await flushBackgroundEmbeddings(pid) } catch {} }
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  console.log("── A8.3  no-index honesty ──")
  const empty = mkdtempSync(path.join(tmpdir(), "m17a8-empty-"))
  try {
    const answer = await quickAnswer(`ask:${empty}`, "how many functions")
    const text = String(answer?.answer ?? "")
    nk("A8: no-index answer never fabricates a number", !/\d+/.test(text) || /no index|not indexed|unindexed/i.test(text), text.slice(0, 120))
    ck("A8: no-index produces an honest message (not a fake 0)", text.length > 0 && !/^\s*0\b/.test(text), text.slice(0, 120))
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }

  const e = { issue: "M17.A8", code: "A8", tool: "bb_ask", title: "ask counts match DB (permanent regression) + no-index honesty", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), measured: { askFunctions: real, dbFunctions: dbN }, negativeLine: "Parity proven on rake (Ruby); cross-language union already covered by M16 A1-A4." }
  writeFileSync(path.join(RESULTS_DIR, "A8.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("A8: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()