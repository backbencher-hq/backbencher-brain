// script/m17/verify-sec-corpus.ts — M17.S2 (bb_security real-repo e2e).
//
// Runs bb_security recordRun -> history through the production CLI against
// real corpora and asserts the persistence invariants on each:
//   - live confirmed+mitigated count == persisted history findings
//   - history has NO severity=unknown / rule=unresolved rows
//   - corpora that contain source-only rows prove the exclusion (test bites)
//   - a source-only-only project persists NOTHING (history stays clean)
//
// Corpus (real, on disk, cross-language): rake (Ruby), lodash (JS), plus a
// temp source-only fixture. Missing repos are reported, not skipped.
//
// Emits validation/m17/results/S2.json. Negative line: does not prove
// analyzer-level taint-detection quality; only the persistence/history axis.

import { writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, writeFileSync as write } from "node:fs"
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

const corpora = [
  { tag: "rake (Ruby)", src: "$HOME/fixtures/repositories/rake" },
  { tag: "lodash (JS)", src: "$HOME/fixtures/repositories/lodash" },
]

async function indexAndCheck(tag: string, dir: string, expectSourceOnly: boolean) {
  const tmp = mkdtempSync(path.join(tmpdir(), "m17s2-"))
  let pid = ""
  try {
    cpSync(dir, tmp, { recursive: true })
    pid = getProjectId(tmp)
    await indexProjectParallel(pid, tmp, {})
    await flushBackgroundEmbeddings(pid)

    const { analyzeTaintFlows } = await import("../../src/intelligence/security/taint")
    const strict = await analyzeTaintFlows(pid, { maxResults: 100000 })
    const live = strict.findings.filter((f) => f.state === "confirmed" || f.state === "mitigated").length
    const unresolved = strict.findings.filter((f) => f.state === "source_only" || f.state === "unresolved").length

    runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
    const histOut = runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ history: true, limit: 50 })])
    const hist = JSON.parse(histOut)
    const bad = hist.findings.filter((f: any) => f.severity === "unknown" || f.rule === "unresolved")

    ck(tag + ": persisted findings == live confirmed+mitigated", hist.findings.length === live, `hist=${hist.findings.length} live=${live}`)
    nk(tag + ": no severity=unknown / rule=unresolved in history", bad.length === 0, `bad=${bad.length}`)
    if (expectSourceOnly) nk(tag + ": index genuinely contains source-only rows (test bites)", unresolved > 0, `unresolved=${unresolved}`)
    if (expectSourceOnly) ck(tag + ": persisted history is non-empty when flows exist (bites)", hist.findings.length > 0, `hist=${hist.findings.length}`)
    console.log("    [" + tag + "] live=" + live + " sourceOnly=" + unresolved + " hist=" + hist.findings.length + " bad=" + bad.length)
    return { live, unresolved, hist: hist.findings.length, bad: bad.length }
  } finally {
    if (pid) { try { await flushBackgroundEmbeddings(pid) } catch {} }
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  console.log("── S2  real-corpus recordRun -> history invariants ──")
  const results: Record<string, { live: number; sourceOnly: number; hist: number; bad: number }> = {}

  for (const c of corpora) {
    if (!existsSync(c.src)) {
      ck(c.tag + ": corpus present", false, "MISSING " + c.src + " (reported, not skipped)")
    } else {
      results[c.tag] = await indexAndCheck(c.tag, c.src, true)
    }
  }

  // Source-only synthetic project: 0 flows -> history must be clean/empty.
  console.log("── S2  source-only-only project ──")
  const tmp = mkdtempSync(path.join(tmpdir(), "m17s2-src-"))
  try {
    write(path.join(tmp, "package.json"), JSON.stringify({ name: "src-only" }))
    mkdirSync(path.join(tmp, "src"))
    write(path.join(tmp, "src", "app.ts"), `const token = process.env.API_TOKEN || "default"\nexport function main() { console.log(token) }\n`)
    const pid = getProjectId(tmp)
    await indexProjectParallel(pid, tmp, {})
    await flushBackgroundEmbeddings(pid)
    runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ recordRun: true })])
    const histOut = runCli(["tool", "bb_security", "--dir", tmp, "--args", JSON.stringify({ history: true, limit: 50 })])
    const hist = JSON.parse(histOut)
    ck("source-only project: persisted history has 0 findings", hist.findings.length === 0, `hist=${hist.findings.length}`)
    nk("source-only project: no unresolved/unknown persisted", hist.findings.every((f: any) => f.severity !== "unknown" && f.rule !== "unresolved"), "n=" + hist.findings.length)
    console.log("    [source-only synthetic] hist=" + hist.findings.length)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const e = { issue: "M17.S2", code: "S2", tool: "bb_security", title: "real-repo e2e: recordRun -> history invariants on real corpora", verified: failed === 0, checks, passed, failed, negatives, negativePassed, generatedAt: new Date().toISOString(), perCorpus: results, negativeLine: "Proves persistence/history equivalence only, not taint-detection accuracy (phantom sinks are an analyzer-domain gap)." }
  writeFileSync(path.join(RESULTS_DIR, "S2.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("S2: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed, " + negatives + " negatives)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()