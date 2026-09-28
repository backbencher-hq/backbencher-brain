// script/m35/verify-closure.ts — M35.X1 (#587)
// Closure gate: the milestone closes via THIS gate, not by hand.
//
//   1. Aggregates every M35 gate evidence file: all subordinate gates
//      verified at ONE stamp (current HEAD), zero failures, negatives > 0.
//   2. Re-runs the content gates READ-ONLY (no evidence stamping): truth is
//      the observed content at closure time, not the commit date.
//   3. Corpus baseline currency: staleness-corpus --check passes at HEAD.
//   4. Wiring: every registered M35 gate appears in `npm run verify`, and
//      every gate script on disk is registered or declared infrastructure
//      (the M31 audit lesson: hardcoded chains rot — derive, don't assume).
//   5. Ledger conformance: every non-X1 entry verified with evidence that
//      conforms to its on-disk file.
//   6. Residue: the governed surfaces are clean in git at check time.
//
// The X1 evidence file is written ONLY when everything passed (explicit
// stamping — this run is the writer, child runs never stamp).
// Mutation (registered in self-test): flip a subordinate evidence status —
// the aggregation must refuse closure.

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m35/results")
const RESULT = path.join(RESULTS, "X1.json")

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

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

function runGate(script: string): { exit: number; output: string } {
  try {
    // Child content-gate runs must be pure reads (explicit-stamping model).
    const { BB_M35_EVIDENCE: _drop, ...parentEnv } = process.env
    // script may carry CLI args ("script/m35/staleness-corpus.ts --check") —
    // split so bun receives them as separate argv entries.
    const [file, ...args] = script.split(" ")
    const out = execFileSync("bun", ["run", file, ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: parentEnv, timeout: 300_000 })
    return { exit: 0, output: out }
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number }
    return { exit: err.status ?? 1, output: String(err.stdout ?? "") + String(err.stderr ?? "") }
  }
}

// Seam (M31 pattern): BB_M35_SELFTEST_CONTROL=1 is set ONLY by the gate
// self-test when it runs this gate as its own control. G1 is PRODUCED from the
// self-test's evidence, so during that run G1's evidence is mid-flight by
// construction — requiring it green there is unsatisfiable (the flaw that made
// convergence luck-based). Only G1-dependent checks are skipped; every other
// check (subordinate evidence, content re-runs, corpus, wiring, ledger
// content-gate blocks, residue) stays enforced. Real chain and closure runs
// set no seam and enforce everything.
const SELFTEST_CONTROL = process.env.BB_M35_SELFTEST_CONTROL === "1"
const SUBORDINATE = ["G1", "F1", "E1", "S1", "S2", "S3", "C1", "D1"]
const CONTENT_GATES: Array<[string, string]> = [
  ["freshness core", "script/m35/verify-freshness-core.ts"],
  ["envelope contract", "script/m35/verify-envelope-contract.ts"],
  ["S1 read paths", "script/m35/verify-s1-read-paths.ts"],
  ["S2 derived", "script/m35/verify-s2-derived.ts"],
  ["S3 graph+migrate", "script/m35/verify-s3-graph-migrate.ts"],
  ["docs staleness", "script/m35/verify-docs-staleness.ts"],
]
const INFRA = new Set(["verify-closure.ts", "verify-governance.ts", "verify-gate-selftest.ts", "sync-ledger.ts"])

async function main() {
  const head = gitHead()

  // ── 1. aggregate subordinate evidence ──
  const stamps = new Map<string, string>()
  for (const code of SUBORDINATE) {
    if (SELFTEST_CONTROL && code === "G1") continue
    const p = path.join(RESULTS, `${code}.json`)
    check(`${code}: evidence exists`, existsSync(p), p)
    if (!existsSync(p)) continue
    const ev = JSON.parse(readFileSync(p, "utf8")) as any
    check(`${code}: verified, zero failures`, ev.status === "verified" && Number(ev.failed) === 0, JSON.stringify({ status: ev.status, failed: ev.failed }).slice(0, 80))
    negative(`${code}: negative cases recorded`, Number(ev.negativeCases ?? 0) > 0, `negativeCases=${ev.negativeCases}`)
    check(`${code}: evidence has a commit stamp`, typeof ev.currentCommit === "string" && ev.currentCommit.length >= 7, String(ev.currentCommit))
    if (typeof ev.currentCommit === "string") stamps.set(code, ev.currentCommit)
  }
  // Stamp AGREEMENT (M31 pattern), not HEAD equality: evidence-only commits
  // after stamping would otherwise invalidate every stamp forever (infinite
  // regress). Currency is proven by the live content-gate re-runs + corpus
  // --check below, not by the stamp matching this exact commit.
  const expected = SELFTEST_CONTROL ? SUBORDINATE.length - 1 : SUBORDINATE.length
  check("all subordinate evidence shares ONE stamp", stamps.size === expected && new Set(stamps.values()).size === 1, `stamps=${[...new Set(stamps.values())].map((s) => s.slice(0, 7)).join(",")}`)

  // ── 2. content gates re-run green NOW (read-only) ──
  for (const [label, script] of CONTENT_GATES) {
    const r = runGate(script)
    check(`${label}: re-runs green at closure time`, r.exit === 0, r.output.split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).join(" | ").slice(0, 200))
  }

  // ── 3. corpus baseline currency ──
  const corpus = runGate("script/m35/staleness-corpus.ts --check")
  check("staleness corpus: baseline current at HEAD", corpus.exit === 0, corpus.output.split("\n").filter((l) => l.includes("FAIL") || l.includes("drift")).slice(0, 2).join(" | ").slice(0, 200))

  // ── 4. wiring (derived, not hardcoded) ──
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
  const verifyChain = pkg.scripts.verify ?? ""
  for (const [label, script] of CONTENT_GATES) {
    check(`wiring: ${label} in npm run verify`, verifyChain.includes(script), "")
  }
  check("wiring: staleness corpus --check in npm run verify", verifyChain.includes("script/m35/staleness-corpus.ts --check"), "")
  check("wiring: self-test in npm run verify", verifyChain.includes("script/m35/verify-gate-selftest.ts"), "")
  check("wiring: governance in npm run verify", verifyChain.includes("script/m35/verify-governance.ts"), "")
  const onDisk = readdirSync(path.join(ROOT, "script/m35")).filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
  const unregistered = onDisk.filter((f) => !verifyChain.includes(`script/m35/${f}`) && !INFRA.has(f))
  negative("wiring: no unregistered gate scripts on disk", unregistered.length === 0, unregistered.join(","))

  // ── 5. ledger conformance ──
  const ledgerPath = path.join(ROOT, "validation/m35/ledger.json")
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Array<Record<string, any>>
  for (const code of SUBORDINATE) {
    if (SELFTEST_CONTROL && code === "G1") continue
    const entry = ledger.find((i) => i.code === code)
    check(`ledger ${code}: verified`, entry?.status === "verified", String(entry?.status))
    const evPath = path.join(RESULTS, `${code}.json`)
    if (entry?.evidence && existsSync(evPath)) {
      const ev = JSON.parse(readFileSync(evPath, "utf8")) as any
      check(`ledger ${code}: evidence block matches file`, entry.evidence.status === ev.status && entry.evidence.passed === ev.passed && entry.evidence.failed === ev.failed && entry.evidence.currentCommit === ev.currentCommit, JSON.stringify(entry.evidence).slice(0, 100))
    }
  }
  const x1 = ledger.find((i) => i.code === "X1")
  check("ledger X1: present with a legal status", x1 !== undefined && ["planned", "verified"].includes(x1.status), String(x1?.status))

  // ── 6. residue: governed SOURCE surfaces clean in git at check time ──
  // (Evidence files are excluded: they are legitimate write targets of stamping
  // runs and of the self-test's mutate/restore cycle — evidence currency is
  // enforced by the stamp-agreement + ledger-conformance checks above.)
  let dirty: string[] = []
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "script/m35/", "src/brain/freshness.ts", "src/mcp/tool-registry.ts", "src/mcp/tool-handlers.ts", "docs/m35/"], { cwd: ROOT, encoding: "utf8" })
    dirty = status.split("\n").filter(Boolean)
  } catch {}
  check("governed surfaces: zero working-tree residue at check time", dirty.length === 0, dirty.join(", ").slice(0, 160))

  console.log(`M35 CLOSURE GATE: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)

  if (process.env.BB_M35_EVIDENCE === "1" && failed === 0) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(RESULTS, { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-closure.ts",
      evidenceFile: "X1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
      subordinateStamps: Object.fromEntries(stamps),
    }, null, 2) + "\n")
    console.log("evidence stamped:", RESULT)
  }
  if (failed !== 0) process.exit(1)
}

main()
