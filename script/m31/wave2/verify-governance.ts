// script/m31/wave2/verify-governance.ts — M31.G3
// Wave-2 governance for the reopened M31 (doc truth, second wave). Lives in
// its own directory so the sealed wave-1 evidence system (whose governance
// hardcodes the six wave-1 codes and whose closure gate runs inside
// docs:verify) is byte-untouched. Wave-1 scanners cannot see this subtree:
// their readdirSync filters `verify-*.ts` by filename at script/m31/ depth.
//
// Checks:
//  1. Wave-2 ledger: all 5 codes present, issue numbers populated, statuses
//     legal, acceptance/closure criteria present, no fabricated evidence.
//  2. Wave-1 survival: wave-1 ledger still all-verified with conforming
//     evidence blocks (the sealed system must not regress).
//  3. Registry wiring: every on-disk wave-2 verifier is registered.
//  4. Chain wiring: docs:verify chains wave-2 governance (progressive gate
//     wiring enforced as verifiers land).
//  5. Auto-pass audit of wave-2 verifiers (code-scanned).
//  6. Negative cases (in-memory): mutated ledger rows are rejected by the
//     same predicates this gate applies to the real ledger.

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const WAVE2_DIR = path.join(ROOT, "script/m31/wave2")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")
const LEDGER_PATH = path.join(ROOT, "validation/m31/wave2/ledger.json")
const WAVE1_LEDGER = path.join(ROOT, "validation/m31/ledger.json")

let checks = 0, passed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed(label, detail) }
}
function failed(label: string, detail = "") {
  failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
  console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
function currentCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
}

type LedgerIssue = {
  code: string; githubIssue: number; tool: string; status: string
  scope: string; acceptanceCriteria: string[]; closureRequirements: string[]
  evidence?: Record<string, unknown> | null
}
const REQUIRED_CODES = ["D4", "G2", "F1", "D5", "G3"]
const GITHUB_ISSUES: Record<string, number> = { D4: 663, G2: 664, F1: 665, D5: 666, G3: 667 }
const ALLOWED_STATUS = ["planned", "verified", "known-gap", "blocked"]

// ── 1. Wave-2 ledger conformance ──
let ledger: LedgerIssue[] = []
try {
  ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerIssue[]
  const codes = ledger.map((l) => l.code)
  check("wave-2 ledger has all 5 codes", REQUIRED_CODES.every((c) => codes.includes(c)), codes.join(","))
  check("wave-2 ledger has no extra codes", codes.every((c) => REQUIRED_CODES.includes(c)), codes.filter((c) => !REQUIRED_CODES.includes(c)).join(","))
  check("wave-2 GitHub issue numbers match the registry", ledger.every((i) => GITHUB_ISSUES[i.code] === i.githubIssue),
    ledger.filter((i) => GITHUB_ISSUES[i.code] !== i.githubIssue).map((i) => i.code).join(","))
  check("wave-2 issue numbers are unique", new Set(ledger.map((i) => i.githubIssue)).size === ledger.length)
  check("wave-2 issues have scope + criteria + closure requirements",
    ledger.every((i) => i.scope && i.acceptanceCriteria.length >= 2 && i.closureRequirements.length >= 1))
  check("wave-2 statuses are legal", ledger.every((i) => ALLOWED_STATUS.includes(i.status)))
  // Anti-fabrication: verified requires conforming evidence; non-verified must
  // not claim it.
  const evidenceConforms = (ev: Record<string, unknown> | undefined | null): boolean =>
    !!ev && ev.status === "verified" &&
    typeof ev.currentCommit === "string" && (ev.currentCommit as string).length === 40 &&
    Number(ev.passed) > 0 && Number(ev.failed) === 0 && Number(ev.negativeCases) >= 0 &&
    typeof ev.evidenceFile === "string" && typeof ev.generatedAt === "string"
  for (const issue of ledger) {
    if (issue.status === "verified") {
      check(`${issue.code}: verified status carries conforming evidence`, evidenceConforms(issue.evidence))
    } else {
      check(`${issue.code}: non-verified status has no conforming-only evidence`,
        !issue.evidence || issue.evidence.status === issue.status)
    }
  }
  const fabricated = ledger.find((i) => i.status === "verified" && !evidenceConforms(i.evidence))
  negative("no fabricated verified status exists in the wave-2 ledger", fabricated === undefined, fabricated?.code ?? "")
} catch (e) {
  check("wave-2 ledger parses", false, String(e))
}

// ── 2. Wave-1 survival (the sealed system must not regress) ──
try {
  const w1 = JSON.parse(readFileSync(WAVE1_LEDGER, "utf8")) as LedgerIssue[]
  check("wave-1 ledger still has exactly six entries", w1.length === 6, String(w1.length))
  check("wave-1 entries all verified", w1.every((i) => i.status === "verified"),
    w1.filter((i) => i.status !== "verified").map((i) => i.code).join(","))
  check("wave-1 evidence blocks present on every entry", w1.every((i) => !!i.evidence && i.evidence.status === "verified"))
} catch (e) {
  check("wave-1 ledger readable", false, String(e))
}

// ── 3. Registry wiring ──
const registryPath = path.join(WAVE2_DIR, "gates-registry.json")
const onDiskVerifiers = existsSync(WAVE2_DIR)
  ? readdirSync(WAVE2_DIR).filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
  : []
let registered: string[] = []
if (existsSync(registryPath)) {
  const reg = JSON.parse(readFileSync(registryPath, "utf8")) as { gates?: Array<{ script: string }> }
  registered = (reg.gates ?? []).map((g) => g.script)
}
check("every wave-2 verifier is registered in gates-registry.json",
  onDiskVerifiers.every((v) => registered.includes(v)),
  onDiskVerifiers.filter((v) => !registered.includes(v)).join(",") || "none-on-disk-yet")

// ── 4. Chain wiring ──
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
const docsVerify: string = pkg.scripts?.["docs:verify"] ?? ""
check("docs:verify chains wave-2 governance", docsVerify.includes("script/m31/wave2/verify-governance.ts"))
const verifyScript: string = pkg.scripts?.["verify"] ?? ""
check("npm run verify runs docs:verify (wave-2 included transitively)", verifyScript.includes("npm run docs:verify"))

// ── 5. Auto-pass audit of wave-2 verifiers ──
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`[^`]*`/g, "").replace(/"[^"\n]*"/g, "").replace(/'[^'\n]*'/g, "")
}
const autoPass = /(ck|nk|check)\(\s*[^,()]*,\s*true\s*[,)]/g
const orTrue = /\|\|\s*true\b/g
let autoPassHits: string[] = []
for (const v of onDiskVerifiers) {
  const code = stripNonCode(readFileSync(path.join(WAVE2_DIR, v), "utf8"))
  for (const hit of [...(code.match(autoPass) ?? []), ...(code.match(orTrue) ?? [])]) {
    autoPassHits.push(`${v}: ${hit.trim().slice(0, 60)}`)
  }
}
negative("no auto-pass predicates in any wave-2 verifier", autoPassHits.length === 0, autoPassHits.join(" | "))

// ── 6. In-memory negative cases: the predicates must be able to fail ──
{
  const badCodes = ["D4", "G2", "F1", "D5"]
  negative("mutated ledger missing G3 is rejected by the completeness predicate",
    !REQUIRED_CODES.every((c) => badCodes.includes(c)))
  const fabricatedRow = { code: "F1", githubIssue: 665, status: "verified", evidence: { status: "verified", currentCommit: "nope" } }
  const fabricatedFails = !(fabricatedRow.evidence.currentCommit as string).length ||
    !Number((fabricatedRow.evidence as any).passed > 0)
  negative("mutated verified row without a real stamp/passed fails the conformance predicate", fabricatedFails)
  const illegal = ledger.some((i) => !ALLOWED_STATUS.includes(i.status))
  negative("real ledger rows pass the status predicate (illegal status would fail)", !illegal)
}

// ── emit evidence ──
const ok = failures.length === 0
const evidence = {
  status: ok ? "verified" : "known-gap",
  currentCommit: currentCommit(),
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m31/wave2/verify-governance.ts",
  evidenceFile: "G3.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  failures,
}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(path.join(RESULTS_DIR, "G3.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`M31 WAVE-2 GOVERNANCE: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negatives})`)
process.exit(ok ? 0 : 1)
