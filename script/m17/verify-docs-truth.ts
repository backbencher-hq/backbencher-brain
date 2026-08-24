// script/m17/verify-docs-truth.ts — M17.D6 (docs truth, website-facing).
//
//   1. Generated docs (docs/tools/*.md) are byte-fresh: run the generator
//      verifier (script/verify-tool-docs.ts) and require PASS.
//   2. BB_*.md document the recordRun/history contract exactly as implemented:
//        - BB_SECURITY.md: source_only/unresolved semantics + recordRun
//          persists only confirmed/mitigated
//        - BB_PATTERNS.md: recordRun persists the FULL analyzed set
//        - BB_ANALYSIS_HISTORY.md: full-set invariant + auto-resolve note
//   3. Absence checks (docs must not claim more than the tool does):
//        - BB_SECURITY.md must NOT claim source-only rows are persisted
//        - docs/tools/bb_security.md still marks flow/summary/hotspots as
//          planned (not executable)
//   4. Emit validation/m17/results/D6.json.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m17/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function readDoc(name: string): string {
  return readFileSync(path.join(ROOT_DIR, "docs", name), "utf8")
}

async function main() {
  console.log("── D6.1  generated docs byte-fresh ──")
  try {
    const out = execFileSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" })
    ck("D6: generated tool docs byte-fresh (verify-tool-docs PASS)", out.includes("TOOL DOCS: PASS"), "tail=" + out.trim().slice(-80))
  } catch (e: any) {
    ck("D6: generated tool docs byte-fresh", false, String(e?.stdout || e?.message || e).slice(-120))
  }

  console.log("── D6.2  BB_*.md recordRun/history contract matches implementation ──")
  const sec = readDoc("BB_SECURITY.md")
  const pat = readDoc("BB_PATTERNS.md")
  const hist = readDoc("BB_ANALYSIS_HISTORY.md")

  ck("D6: BB_SECURITY.md documents source_only semantics (no sink endpoint)",
    sec.includes("no sink endpoint is") || sec.includes("no sink endpoint reachable"), "")
  ck("D6: BB_SECURITY.md documents recordRun persists only real findings",
    sec.includes("recordRun persists only real findings") || sec.includes("excluded from persisted history"), "")
  ck("D6: BB_PATTERNS.md documents the full analyzed set contract",
    pat.includes("full analyzed set") && pat.includes("recordRun"), "")
  ck("D6: BB_ANALYSIS_HISTORY.md documents full-set + auto-resolve honesty",
    hist.includes("full analyzed result set") && hist.includes("auto-resolve"), "")

  nk("D6: BB_SECURITY.md does NOT claim source-only rows are persisted in history",
    !/persists source_only|source_only.*persisted/i.test(sec.replace(/excluded from persisted history/i, "")), "")
  const toolSec = readDoc("tools/bb_security.md")
  nk("D6: planned modes stay 'not executable' in generated docs (website truth)",
    toolSec.includes("not executable"), "")

  const e = { issue: "M17.D6", code: "D6", tool: "docs", title: "docs truth: recordRun/history semantics for the website", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), negativeLine: "Checks doc-vs-implementation agreement; does not prove docs describe every analyzer detail." }
  writeFileSync(path.join(RESULTS_DIR, "D6.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("D6: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()