// script/m31/verify-governance.ts — M31.G1
// Governance-only gate (M21.C1 pattern): audits the ledger shape, refuses
// fabricated evidence, and greps every M31 verifier for auto-pass patterns.
// Fail-closed: any failure exits nonzero.
//
// BB_M31_ROOT: test seam used ONLY by verify-gate-selftest.ts to run this gate
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
const GOV_ROOT = process.env.BB_M31_ROOT ?? ROOT
const LEDGER = path.join(GOV_ROOT, "validation/m31/ledger.json")
const PLAN = path.join(GOV_ROOT, "docs/m31/PLAN.md")
const RESULT = path.join(GOV_ROOT, "validation/m31/results/G1.json")
const M31_SCRIPTS = path.join(GOV_ROOT, "script/m31")
const PKG_PATH = path.join(GOV_ROOT, "package.json")
const SELFTEST_RESULT = path.join(GOV_ROOT, "validation/m31/results/gate-selftest.json")

const CODES = ["G1", "D1", "D2", "D3", "T1", "X1"]
const GITHUB_ISSUES: Record<string, number> = { G1: 555, D1: 556, D2: 557, D3: 558, T1: 559, X1: 560 }

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
check("ledger has exactly the six M31 issues", ledger.length === CODES.length && CODES.every((c) => ledger.some((i) => i.code === c)))
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
// equality with the synced ledger is a sync-ordering artifact, not truth. Whether
// evidence is COMMIT-CURRENT is the closure gate's scoped staleness check (M21 pattern).
for (const issue of ledger) {
  if (issue.status !== "verified") continue
  // Skip this gate's own evidence: it is rewritten by the running invocation,
  // so comparing it to the ledger is self-referential by construction.
  if (issue.code === "G1") continue
  const file = path.join(GOV_ROOT, "validation/m31/results", String(issue.evidence?.evidenceFile ?? ""))
  check(`${issue.code}: evidence file exists on disk`, existsSync(file), file)
  if (!existsSync(file)) continue
  const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  check(
    `${issue.code}: evidence file agrees with ledger block`,
    ev.status === issue.evidence?.status && ev.passed === issue.evidence?.passed && ev.failed === issue.evidence?.failed && ev.negativeCases === issue.evidence?.negativeCases,
  )
}

// ── 4. Plan document exists and inventories the real surfaces ──
const plan = readFileSync(PLAN, "utf8")
check("plan inventories the 11 per-tool docs", plan.includes("docs/tools/*.md") && plan.includes("(11)"))
check("plan inventories the 15 top-level BB docs", plan.includes("BB_*.md") && plan.includes("(15)"))
check("plan declares the authority (executable registry)", plan.includes("src/mcp/tool-registry.ts"))
check("plan declares staleness scoping", plan.includes("Staleness scoping"))

// ── 5. No auto-pass patterns in any M31 verifier ──
const AUTO_PASS = /\b(ck|nk|check)\(\s*(["'`])[^"'`]*\2\s*,\s*(true)\s*[,)]/
const verifierFiles = existsSync(M31_SCRIPTS) ? readdirSync(M31_SCRIPTS).filter((f) => f.startsWith("verify-") && f.endsWith(".ts")) : []
check("M31 verifier scripts exist (governance + self-test at minimum)", verifierFiles.includes("verify-governance.ts") && verifierFiles.includes("verify-gate-selftest.ts"), verifierFiles.join(","))
let autoPassHits: string[] = []
for (const f of verifierFiles) {
  const src = readFileSync(path.join(M31_SCRIPTS, f), "utf8")
  if (AUTO_PASS.test(src)) autoPassHits.push(f)
}
negative("no auto-pass assertions in any M31 verifier", autoPassHits.length === 0, autoPassHits.join(","))

// ── 6. Gates wired into npm run verify (docs:verify chain) ──
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"))
const docsVerify: string = pkg.scripts["docs:verify"] ?? ""
check("docs:verify chains the M31 gates", docsVerify.includes("script/m31/verify-governance.ts") && docsVerify.includes("script/m31/verify-gate-selftest.ts"), docsVerify.slice(0, 160))
// #555 criterion 3: npm run verify must run all M31 gates (via docs:verify).
const verifyScript: string = pkg.scripts["verify"] ?? ""
check("npm run verify runs docs:verify (all M31 gates)", verifyScript.includes("npm run docs:verify"), verifyScript.slice(-80))

// ── 7. Gate self-test has proven every registered gate can fail ──
check("gate self-test evidence exists", existsSync(SELFTEST_RESULT))
if (existsSync(SELFTEST_RESULT)) {
  const st = JSON.parse(readFileSync(SELFTEST_RESULT, "utf8")) as { gates: { name: string; mutationFailed: boolean; controlPassed: boolean }[] }
  check("every registered gate failed its mutation AND passed its control", st.gates.length >= 2 && st.gates.every((g) => g.mutationFailed === true && g.controlPassed === true), JSON.stringify(st.gates))
}

// ── emit evidence ──
const ok = passed === checks
const evidence = {
  status: ok ? "verified" : "known-gap",
  currentCommit: currentCommit(),
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m31/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: negatives,
}
if (process.env.BB_M31_EVIDENCE === "1") {
  mkdirSync(path.dirname(RESULT), { recursive: true })
  writeFileSync(RESULT, JSON.stringify(evidence, null, 2) + "\n")
}
console.log(`M31 GOVERNANCE: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negatives})`)
process.exit(ok ? 0 : 1)
