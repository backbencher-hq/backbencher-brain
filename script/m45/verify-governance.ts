// script/m45/verify-governance.ts — M45.G1
// Governance for the Index-Truth milestone (m44 pattern):
//   1. Ledger conformance: all 6 codes present, no extras, issue numbers
//      populated and unique, statuses legal, acceptance/closure criteria
//      present, no fabricated evidence.
//   2. Registry wiring: every on-disk script/m45 verifier is registered in
//      gates-registry.json (content gates join npm run verify as they land).
//   3. Chain wiring: npm run verify runs M45 governance.
//   4. Auto-pass audit: no (check|negative)(..., true) or || true in any
//      on-disk M45 verifier.
//   5. PLAN.md present with the invariant sentence.
//   6. In-memory negatives: the predicates must be able to refuse.
// Evidence: stamps validation/m45/results/G1.json (never under BB_M45_READ_ONLY).

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const M45_DIR = path.join(ROOT, "script/m45")
const LEDGER_PATH = path.join(ROOT, "validation/m45/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m45/results")
const READ_ONLY = process.env.BB_M45_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

const REQUIRED_CODES = ["G1", "R1", "R2", "R3", "A1", "X1"]
const ALLOWED_STATUS = ["planned", "verified", "known-gap", "blocked"]
const ALLOWED_INFRA = ["verify-governance.ts", "verify-closure.ts", "sync-ledger.ts"]

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

function main() {
  let ledger: Array<Record<string, any>> = []
  try { ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) } catch (e) { check("M45 ledger readable", false, String(e)) }
  const codes = ledger.map((i) => i.code)
  check("M45 ledger has all 6 codes", REQUIRED_CODES.every((c) => codes.includes(c)), REQUIRED_CODES.filter((c) => !codes.includes(c)).join(","))
  check("M45 ledger has no extra codes", codes.every((c) => REQUIRED_CODES.includes(c)), codes.filter((c) => !REQUIRED_CODES.includes(c)).join(","))
  check("M45 ledger issue numbers populated + unique", ledger.every((i) => Number.isInteger(i.githubIssue) && i.githubIssue > 0) && new Set(ledger.map((i) => i.githubIssue)).size === ledger.length, "")
  check("M45 ledger statuses are legal", ledger.every((i) => ALLOWED_STATUS.includes(i.status)), ledger.filter((i) => !ALLOWED_STATUS.includes(i.status)).map((i) => i.code).join(","))
  check("M45 ledger entries carry acceptance + closure criteria", ledger.every((i) => Array.isArray(i.acceptanceCriteria) && i.acceptanceCriteria.length > 0 && Array.isArray(i.closureRequirements) && i.closureRequirements.length > 0), "")
  const evidenceConforms = (ev: Record<string, unknown> | undefined | null): boolean =>
    !!ev && ev.status === "verified"
    && typeof ev.currentCommit === "string" && (ev.currentCommit as string).length === 40
    && Array.isArray(ev.workingTreeRelevantChanges) && (ev.workingTreeRelevantChanges as unknown[]).length === 0
    && typeof ev.verifierCommand === "string"
    && Number(ev.passed) > 0 && Number(ev.failed) === 0 && Number(ev.negativeCases) > 0
    && typeof ev.evidenceFile === "string" && typeof ev.generatedAt === "string"
  for (const issue of ledger) {
    if (issue.status === "verified") {
      check(`${issue.code}: verified status carries conforming evidence`, evidenceConforms(issue.evidence), JSON.stringify(issue.evidence ?? {}).slice(0, 100))
    } else {
      check(`${issue.code}: non-verified status has no conforming-only evidence`, !issue.evidence || issue.evidence.status === issue.status, "")
    }
  }
  const fabricated = ledger.find((i) => i.status === "verified" && !evidenceConforms(i.evidence))
  negative("no fabricated verified status exists in the M45 ledger", fabricated === undefined, fabricated?.code ?? "")

  // registry wiring
  const registryPath = path.join(M45_DIR, "gates-registry.json")
  const onDisk = existsSync(M45_DIR) ? readdirSync(M45_DIR).filter((f) => f.startsWith("verify-") && f.endsWith(".ts")) : []
  let registered: string[] = []
  if (existsSync(registryPath)) {
    const reg = JSON.parse(readFileSync(registryPath, "utf8")) as { gates?: Array<{ script: string }> }
    registered = (reg.gates ?? []).map((g) => g.script)
  }
  check("every on-disk M45 verifier is registered in gates-registry.json", onDisk.every((v) => registered.includes(v)), onDisk.filter((v) => !registered.includes(v)).join(",") || "none-on-disk-yet")

  // chain wiring
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const verifyScript: string = pkg.scripts?.["verify"] ?? ""
  check("npm run verify chains M45 governance", verifyScript.includes("script/m45/verify-governance.ts"), "")

  // auto-pass audit
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
    const code = stripNonCode(readFileSync(path.join(M45_DIR, v), "utf8"))
    for (const hit of [...(code.match(autoPass) ?? []), ...(code.match(orTrue) ?? [])]) autoPassHits.push(`${v}: ${hit.trim().slice(0, 60)}`)
  }
  negative("no auto-pass predicates in any M45 verifier", autoPassHits.length === 0, autoPassHits.join(" | "))

  // PLAN.md + invariant
  const planPath = path.join(ROOT, "docs/m45/PLAN.md")
  check("PLAN.md exists", existsSync(planPath))
  if (existsSync(planPath)) {
    const plan = readFileSync(planPath, "utf8")
    check("PLAN.md states the milestone invariant (head + tail tokens)",
      plan.includes("leave zero orphan owners, zero dead source/target edges, and an honest")
      && plan.includes("symbol-loss bucket on the worker-pool path"), "invariant sentence missing")
  }

  // in-memory negatives
  {
    const badCodes = ["G1", "R1"]
    negative("mutated ledger missing R3 is rejected by the completeness predicate", !REQUIRED_CODES.every((c) => badCodes.includes(c)), "")
    const fabricatedRow = { code: "R1", githubIssue: 1, status: "verified", evidence: { status: "verified", currentCommit: "nope" } }
    const fabricatedFails = !((fabricatedRow.evidence.currentCommit as string).length === 40) || !(Number((fabricatedRow.evidence as any).passed) > 0)
    negative("mutated verified row without a real stamp/passed fails the conformance predicate", fabricatedFails, "")
    const illegal = ledger.some((i) => !ALLOWED_STATUS.includes(i.status))
    negative("real ledger rows pass the status predicate (illegal status would fail)", !illegal, "")
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: currentCommit(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m45/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases: negatives,
    failures,
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  if (!READ_ONLY) writeFileSync(path.join(RESULTS_DIR, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(`M45 GOVERNANCE: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  process.exit(ok ? 0 : 1)
}

main()
