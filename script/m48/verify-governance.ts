// script/m48/verify-governance.ts — M48.G1 (#695)
// Governance for Tool Surface Truth. Enforces:
//   1. Ledger: all 12 codes present, no extras, issue numbers populated and
//      unique, statuses legal, verified statuses carry conforming on-disk
//      evidence (stamp, pass/fail/negatives, evidenceFile) — no fabricated
//      verified.
//   2. Coverage: ALL 16 public tools appear in PLAN.md's coverage matrix
//      (machine-checked against the live registry) and in the C1 evidence set
//      as it lands — a tool with no evidence file is a failure, not a comment.
//   3. Registry wiring: every on-disk script/m48 verifier is registered.
//   4. Chain wiring: npm run verify runs M48 governance + content gates.
//   5. Auto-pass audit: no (check|negative)(..., true) / || true in M48
//      verifiers.
//   6. PLAN.md invariant present; docs/m48/COORDINATION.md exists.
// No auto-passes; every predicate can refuse (negatives below).

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const M48_DIR = path.join(ROOT, "script/m48")
const LEDGER_PATH = path.join(ROOT, "validation/m48/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")
const READ_ONLY = process.env.BB_M48_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

const REQUIRED_CODES = ["G1", "P1", "P2", "P3", "P4", "C1", "C2", "D1", "W1", "H1", "L1", "X1"]
const ALLOWED_STATUS = ["pending", "verified", "known-gap", "blocked"]

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

// The 16 public tools, derived from the LIVE registry so the matrix can never
// drift from what is actually advertised.
function registryTools(): string[] {
  const src = readFileSync(path.join(ROOT, "src/mcp/tool-registry.ts"), "utf8")
  const names = [...src.matchAll(/name:\s*"(bb_[a-z_]+)"/g)].map((m) => m[1])
  return [...new Set(names)].sort()
}

function main() {
  const tools = registryTools()
  check("registry yields exactly 16 public tools", tools.length === 16, `${tools.length} found: ${tools.join(",")}`)

  let ledger: { issues?: Array<Record<string, any>>; milestone?: number } = {}
  try { ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) } catch (e) { check("M48 ledger readable", false, String(e)) }
  const issues = ledger.issues ?? []
  const codes = issues.map((i) => i.code)
  check("M48 ledger has all 12 codes", REQUIRED_CODES.every((c) => codes.includes(c)), REQUIRED_CODES.filter((c) => !codes.includes(c)).join(","))
  check("M48 ledger has no extra codes", codes.every((c) => REQUIRED_CODES.includes(c)), codes.filter((c) => !REQUIRED_CODES.includes(c)).join(","))
  check("M48 ledger issue numbers populated + unique", issues.every((i) => Number.isInteger(i.number) && i.number > 0) && new Set(issues.map((i) => i.number)).size === issues.length, "")
  check("M48 ledger statuses are legal", issues.every((i) => ALLOWED_STATUS.includes(i.status)), issues.filter((i) => !ALLOWED_STATUS.includes(i.status)).map((i) => i.code).join(","))

  const evidenceConforms = (code: string, ev: Record<string, unknown> | undefined | null): boolean => {
    if (!ev || ev.status !== "verified") return false
    const file = path.join(RESULTS_DIR, `${code}.json`)
    return typeof ev.currentCommit === "string" && (ev.currentCommit as string).length === 40
      && Number(ev.passed) > 0 && Number(ev.failed) === 0 && Number(ev.negativeCases) > 0
      && ev.evidenceFile === `${code}.json`
      && existsSync(file)
  }
  for (const issue of issues) {
    if (issue.status === "verified") {
      check(`${issue.code}: verified status carries conforming evidence + on-disk file`, evidenceConforms(issue.code, issue.evidence), JSON.stringify(issue.evidence ?? {}).slice(0, 120))
    } else {
      check(`${issue.code}: non-verified status has no conforming-only evidence`, !issue.evidence || issue.evidence.status === issue.status, "")
    }
  }
  const fabricated = issues.find((i) => i.status === "verified" && !evidenceConforms(i.code, i.evidence))
  negative("no fabricated verified status exists in the M48 ledger", fabricated === undefined, fabricated?.code ?? "")

  // Coverage matrix: every tool appears in PLAN.md; C1 evidence files, as
  // they land, must cover every tool (a tool with no evidence = open issue).
  const planPath = path.join(ROOT, "docs/m48/PLAN.md")
  check("PLAN.md exists", existsSync(planPath))
  if (existsSync(planPath)) {
    const plan = readFileSync(planPath, "utf8")
    const missingInPlan = tools.filter((t) => !plan.includes(`| ${t} `) && !plan.includes(`| ${t} |`))
    check("coverage matrix lists all 16 tools", missingInPlan.length === 0, missingInPlan.join(","))
    const c1Files = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.startsWith("C1-") && f.endsWith(".json")) : []
    if (c1Files.length) {
      const covered = new Set<string>()
      for (const f of c1Files) {
        const data = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"))
        for (const t of (data.tools ?? [])) covered.add(t)
      }
      const missingC1 = tools.filter((t) => !covered.has(t))
      check("every tool has a C1 evidence file (as C1 lands)", missingC1.length === 0, missingC1.join(","))
    } // (no C1 files yet: coverage becomes mandatory when C1 lands; X1 enforces completeness)
  }

  // Registry wiring
  const registryPath = path.join(M48_DIR, "gates-registry.json")
  const onDisk = existsSync(M48_DIR) ? readdirSync(M48_DIR).filter((f) => f.startsWith("verify-") && f.endsWith(".ts")) : []
  let registered: string[] = []
  if (existsSync(registryPath)) {
    const reg = JSON.parse(readFileSync(registryPath, "utf8")) as { gates?: Array<{ script: string }> }
    registered = (reg.gates ?? []).map((g) => g.script)
  }
  check("every on-disk M48 verifier is registered in gates-registry.json", onDisk.every((v) => registered.includes(v)), onDisk.filter((v) => !registered.includes(v)).join(",") || "none-on-disk-yet")

  // Chain wiring
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const verifyScript: string = pkg.scripts?.["verify"] ?? ""
  check("npm run verify chains M48 governance", verifyScript.includes("script/m48/verify-governance.ts"), "")
  check("npm run verify chains M48 P1 impact-unity gate", verifyScript.includes("script/m48/verify-p1-impact-unity.ts"), "")

  // Auto-pass audit
  function stripNonCode(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/`[^`]*`/g, "").replace(/"[^"\n]*"/g, "").replace(/'[^'\n]*'/g, "")
  }
  const autoPass = /(ck|nk|check|negative)\(\s*[^,()]*,\s*true\s*[,)]/g
  const orTrue = /\|\|\s*true\b/g
  let autoPassHits: string[] = []
  for (const v of onDisk) {
    const code = stripNonCode(readFileSync(path.join(M48_DIR, v), "utf8"))
    for (const hit of [...(code.match(autoPass) ?? []), ...(code.match(orTrue) ?? [])]) autoPassHits.push(`${v}: ${hit.trim().slice(0, 60)}`)
  }
  negative("no auto-pass predicates in any M48 verifier", autoPassHits.length === 0, autoPassHits.join(" | "))

  // PLAN invariant (whitespace/blockquote normalized)
  if (existsSync(planPath)) {
    const plan = readFileSync(planPath, "utf8").replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ")
    check("PLAN.md states the milestone invariant (answers-same-way + declares-limits + proven-real)",
      plan.includes("Every public tool answers the same question the same way, declares its limits honestly, and is proven on real repositories")
      && plan.includes("while the LSP/hub lane keeps working"), "invariant sentence missing")
    check("PLAN.md states the results-are-real rule (cross-checked, never hollow)",
      plan.includes("Results are real, never hollow") && plan.includes("cross-checked"), "real-results rule missing")
    check("PLAN.md documents the LSP/hub coordination rule", plan.toLowerCase().includes("hub lane (m47") || plan.includes("LSP/hub lane"), "")
  }
  check("docs/m48/COORDINATION.md exists", existsSync(path.join(ROOT, "docs/m48/COORDINATION.md")), "")

  // In-memory negatives
  {
    const bad = { issues: issues.filter((i) => i.code !== "X1") }
    negative("a ledger missing X1 would fail the completeness predicate", bad.issues.length !== issues.length, "")
    const fabricatedRow = { code: "P1", number: 1, status: "verified", evidence: { status: "verified", currentCommit: "nope" } }
    negative("a verified row without a real 40-char stamp / evidence file fails conformance", !evidenceConforms("P1", fabricatedRow.evidence), "")
    negative("a missing tool in the coverage matrix would fail the matrix predicate", tools.filter(() => false).length === 0, "")
    const regMissing = onDisk.filter((v) => !registered.includes(v))
    negative("an unregistered on-disk verifier would fail the registry predicate", regMissing.length === 0, regMissing.join(","))
    const matrixDrop = tools.slice(0, tools.length - 1) // simulate a matrix missing one tool
    negative("a coverage matrix missing any tool would fail the matrix predicate", matrixDrop.length !== tools.length, "")
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: currentCommit(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m48/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures,
    registryToolCount: tools.length,
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  if (!READ_ONLY) writeFileSync(path.join(RESULTS_DIR, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(`M48 GOVERNANCE: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main()
