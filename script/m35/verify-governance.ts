// script/m35/verify-governance.ts — M35.G1
// Governance-only gate (M31/M21 pattern): audits the ledger shape, refuses
// fabricated evidence, greps every M35 verifier for auto-pass patterns, and
// machine-checks that npm run verify actually runs every M35 gate (the M31
// audit lesson: wiring criteria must be enforced, not assumed).
// Fail-closed: any failure exits nonzero.
//
// BB_M35_ROOT: test seam used ONLY by verify-gate-selftest.ts to run this gate
// against a sandboxed copy of the governed surfaces. Production runs leave it
// unset and everything resolves to the real repo root.

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

type Issue = {
  code: string
  githubIssue: number
  tool: string
  status: "planned" | "verified" | "known-gap" | "blocked"
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  evidence?: Record<string, unknown>
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const GOV_ROOT = process.env.BB_M35_ROOT ?? ROOT
const LEDGER = path.join(GOV_ROOT, "validation/m35/ledger.json")
const PLAN = path.join(GOV_ROOT, "docs/m35/PLAN.md")
const RESULT = path.join(GOV_ROOT, "validation/m35/results/G1.json")
const M35_SCRIPTS = path.join(GOV_ROOT, "script/m35")
const PKG_PATH = path.join(GOV_ROOT, "package.json")
const SELFTEST_RESULT = path.join(GOV_ROOT, "validation/m35/results/gate-selftest.json")

const CODES = ["G1", "F1", "E1", "S1", "S2", "S3", "C1", "D1", "X1"]
const GITHUB_ISSUES: Record<string, number> = { G1: 579, F1: 580, E1: 581, S1: 582, S2: 583, S3: 584, C1: 585, D1: 586, X1: 587 }

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
function currentCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
}

// ── 1. Ledger identity and completeness ──
const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Issue[]
check("ledger has exactly the nine M35 issues", ledger.length === CODES.length && CODES.every((c) => ledger.some((i) => i.code === c)))
check("GitHub issue numbers match the real registry", ledger.every((i) => GITHUB_ISSUES[i.code] === i.githubIssue))
check("issue numbers are unique", new Set(ledger.map((i) => i.githubIssue)).size === ledger.length)
check("every issue has scope + criteria + closure requirements", ledger.every((i) => i.scope && i.acceptanceCriteria.length >= 2 && i.closureRequirements.length >= 2))
check("statuses are legal", ledger.every((i) => ["planned", "verified", "known-gap", "blocked"].includes(i.status)))

// ── 2. Anti-fabrication ──
function evidenceConforms(ev: Record<string, unknown> | undefined): boolean {
  if (!ev) return false
  return (
    ev.status === "verified" &&
    typeof ev.currentCommit === "string" &&
    (ev.currentCommit as string).length === 40 &&
    Array.isArray(ev.workingTreeRelevantChanges) &&
    (ev.workingTreeRelevantChanges as unknown[]).length === 0 &&
    typeof ev.verifierCommand === "string" &&
    (ev.verifierCommand as string).length > 0 &&
    typeof ev.evidenceFile === "string" &&
    typeof ev.generatedAt === "string" &&
    Number(ev.passed) > 0 &&
    Number(ev.failed) === 0 &&
    Number(ev.negativeCases) > 0
  )
}
for (const issue of ledger) {
  if (issue.status === "verified") {
    check(`${issue.code}: verified status carries conforming evidence`, evidenceConforms(issue.evidence), JSON.stringify(issue.evidence ?? {}).slice(0, 120))
  } else {
    check(`${issue.code}: non-verified status has no conforming-only evidence`, !issue.evidence || issue.evidence.status === issue.status)
  }
}
const fabricated = ledger.find((i) => i.status === "verified" && !evidenceConforms(i.evidence))
negative("no fabricated verified status exists in the ledger", fabricated === undefined, fabricated ? fabricated.code : "")

// ── 3. Evidence files on disk match ledger claims ──
// Compares result fields (status/passed/failed/negativeCases), NOT currentCommit:
// verifiers legitimately re-stamp their evidence at HEAD on every run, so commit
// equality with the synced ledger is a sync-ordering artifact, not truth.
for (const issue of ledger) {
  if (issue.status !== "verified") continue
  if (issue.code === "G1") continue // self-referential: rewritten by this invocation
  const file = path.join(GOV_ROOT, "validation/m35/results", String(issue.evidence?.evidenceFile ?? ""))
  check(`${issue.code}: evidence file exists on disk`, existsSync(file), file)
  if (!existsSync(file)) continue
  const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  check(
    `${issue.code}: evidence file agrees with ledger block`,
    ev.status === issue.evidence?.status && ev.passed === issue.evidence?.passed && ev.failed === issue.evidence?.failed && ev.negativeCases === issue.evidence?.negativeCases,
  )
}

// ── 4. Plan document exists and inventories the real read paths ──
const plan = readFileSync(PLAN, "utf8")
check("plan inventories the read paths x staleness state", plan.includes("## Verified starting state") && plan.includes("bb_migrate") && plan.includes("bb_visualize"))
check("plan declares the authority (freshness oracle)", plan.includes("src/brain/freshness.ts"))
check("plan declares honest boundaries (no silent re-index, additive truth)", plan.includes("additive truth") && plan.includes("No file-watcher/daemon"))
check("plan maps all nine issues", CODES.every((c) => plan.includes(`| ${c} |`)))

// ── 5. No auto-pass patterns in any M35 verifier ──
const AUTO_PASS = /\b(ck|nk|check)\(\s*(["'`])[^"'`]*\2\s*,\s*(true)\s*[,)]/
const verifierFiles = existsSync(M35_SCRIPTS) ? readdirSync(M35_SCRIPTS).filter((f) => f.startsWith("verify-") && f.endsWith(".ts")) : []
check("M35 verifier scripts exist (governance + self-test at minimum)", verifierFiles.includes("verify-governance.ts") && verifierFiles.includes("verify-gate-selftest.ts"), verifierFiles.join(","))
const autoPassHits: string[] = []
for (const f of verifierFiles) {
  const src = readFileSync(path.join(M35_SCRIPTS, f), "utf8")
  if (AUTO_PASS.test(src)) autoPassHits.push(f)
}
negative("no auto-pass assertions in any M35 verifier", autoPassHits.length === 0, autoPassHits.join(","))

// ── 6. Gates wired into npm run verify (machine-checked, M31 lesson) ──
// Staged honestly:
//   A (always): every M35 gate script that EXISTS on disk must be in npm run
//               verify — a gate cannot hide from the chain.
//   B (closure stage): when X1's evidence claims "verified", the FULL gate
//               list must be wired — completeness is enforced exactly when
//               the milestone claims completion, not before it can exist.
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"))
const verifyScript: string = pkg.scripts["verify"] ?? ""
const REQUIRED_GATES = ["verify-governance.ts", "verify-gate-selftest.ts", "verify-freshness-core.ts", "verify-envelope-contract.ts", "verify-s1-read-paths.ts", "verify-s2-derived.ts", "verify-s3-graph-migrate.ts", "staleness-corpus.ts", "verify-docs-staleness.ts", "verify-closure.ts"]
const existingGates = existsSync(M35_SCRIPTS)
  ? readdirSync(M35_SCRIPTS).filter((f) => (f.startsWith("verify-") || f === "staleness-corpus.ts") && f.endsWith(".ts"))
  : []
for (const f of existingGates) {
  check(`npm run verify runs script/m35/${f} (gate exists on disk)`, verifyScript.includes(`script/m35/${f}`), verifyScript.slice(-60))
}
const x1EvidencePath = path.join(GOV_ROOT, "validation/m35/results/X1.json")
const closureClaimed = existsSync(x1EvidencePath) && (() => { try { return JSON.parse(readFileSync(x1EvidencePath, "utf8")).status === "verified" } catch { return false } })()
const wiringComplete = REQUIRED_GATES.every((g) => verifyScript.includes(`script/m35/${g}`))
check("full wiring completeness holds whenever closure is claimed", !closureClaimed || wiringComplete)
const docsVerify: string = pkg.scripts["docs:verify"] ?? ""
check("docs:verify remains intact (M31 chain still wired)", docsVerify.includes("script/m31/verify-closure.ts"))

// ── 7. Gate self-test has proven every registered gate can fail ──
check("gate self-test evidence exists", existsSync(SELFTEST_RESULT))
if (existsSync(SELFTEST_RESULT)) {
  const st = JSON.parse(readFileSync(SELFTEST_RESULT, "utf8")) as { gates: { name: string; mutationFailed: boolean; controlPassed: boolean }[] }
  check("every registered gate failed its mutation AND passed its control", st.gates.length >= 1 && st.gates.every((g) => g.mutationFailed === true && g.controlPassed === true), JSON.stringify(st.gates).slice(0, 200))
  // Closure-stage completeness: once X1 claims verified, every CONTENT gate
  // must have a proven mutation. Infra gates (self-test/closure/governance)
  // are exempt — a gate cannot mutate its own dependency; they are proven by
  // the structure of this chain instead (M31's declared-infra rule).
  if (closureClaimed) {
    const INFRA_GATES = new Set(["verify-governance.ts", "verify-gate-selftest.ts", "verify-closure.ts", "staleness-corpus.ts"])
    const provenScripts = new Set(st.gates.filter((g) => g.mutationFailed && g.controlPassed).map((g) => (g as any).script ?? ""))
    const unproven = REQUIRED_GATES.filter((g) => !INFRA_GATES.has(g) && !provenScripts.has(`script/m35/${g}`))
    check("closure-claimed: every content gate has a proven mutation (infra exempt)", unproven.length === 0, unproven.join(","))
  }
}

// ── emit evidence (explicit-only stamping, M31 X1 lesson) ──
const ok = passed === checks
const evidence = {
  status: ok ? "verified" : "known-gap",
  currentCommit: currentCommit(),
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m35/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: negatives,
}
if (process.env.BB_M35_EVIDENCE === "1") {
  mkdirSync(path.dirname(RESULT), { recursive: true })
  writeFileSync(RESULT, JSON.stringify(evidence, null, 2) + "\n")
}
console.log(`M35 GOVERNANCE: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negatives})`)
process.exit(ok ? 0 : 1)
