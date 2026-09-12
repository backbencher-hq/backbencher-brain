import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const auditPath = resolve(root, "docs/data/m12-final-audit.json")
const auditDocPath = resolve(root, "docs/M12-FINAL-AUDIT.md")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}
const qualityGate = readFileSync(resolve(root, "script/verify-quality-gate.ts"), "utf8")
const audit = JSON.parse(readFileSync(auditPath, "utf8")) as any

let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

check("final audit schema is version 1", audit.schemaVersion === 1)
check("audit identifies M12 issue 182", audit.milestone === "M12" && audit.issue === 182)
check("release decision is ready", audit.releaseDecision === "ready")
check("release version matches package", audit.releaseVersion === "0.3.0")
check("narrative final audit exists", existsSync(auditDocPath))

check("audit contains exactly 43 ordered issues", audit.issues.length === 43)
check("issue order is contiguous", audit.issues.every((issue: any, index: number) => issue.order === index + 1))
check("issue numbers span #140-#182", JSON.stringify(audit.issues.map((i: any) => i.issue)) === JSON.stringify([...Array(43)].map((_, i) => 140 + i)))
check("M12.01-M12.42 are closed", audit.issues.slice(0, 42).every((issue: any) => issue.status === "closed"))
check("M12.43 is ready to close", audit.issues[42].status === "ready_to_close")
check("M12.43 uses reproducible self-commit marker", audit.issues[42].commit === "audit-commit-containing-this-artifact")

for (const issue of audit.issues) {
  check(`issue #${issue.issue} has commit evidence`, typeof issue.commit === "string" && issue.commit.length >= 7)
  check(`issue #${issue.issue} has artifacts`, Array.isArray(issue.artifacts) && issue.artifacts.length > 0)
  check(`issue #${issue.issue} has verifiers`, Array.isArray(issue.verifiers) && issue.verifiers.length > 0)
  for (const artifact of issue.artifacts) check(`artifact exists: ${artifact}`, existsSync(resolve(root, artifact)))
  for (const verifier of issue.verifiers) check(`verifier exists: ${verifier}`, existsSync(resolve(root, verifier)))
}

// ── Per-analyzer evidence sweep ─────────────────────────────────────────────
const fixturesDir = resolve(root, "validation/m12/fixtures")
const resultsDir = resolve(root, "validation/m12/results")
const truthDir = resolve(root, "validation/m12/ground-truth")
const docsDir = resolve(root, "docs/analyzers")
const languages = readdirSync(fixturesDir).filter((d) => !d.startsWith(".")).sort()
check("fixture dirs cover 41 languages", languages.length === 41)
check("audit declares 41 languages", audit.advertisedLanguages === 41)

let totalFacts = 0
let totalFp = 0
let totalFn = 0
let totalUnk = 0
for (const lang of languages) {
  const diffPath = resolve(resultsDir, `${lang}-differential.json`)
  check(`differential exists: ${lang}`, existsSync(diffPath))
  if (!existsSync(diffPath)) continue
  const diff = JSON.parse(readFileSync(diffPath, "utf8"))
  const metrics = diff?.passing?.metrics ?? {}
  const passed = diff?.passing?.passed === true
  check(`${lang} differential passes`, passed)
  if (passed) {
    totalFacts += metrics.expected ?? 0
    totalFp += metrics.falsePositive ?? 0
    totalFn += metrics.falseNegative ?? 0
    totalUnk += metrics.unknown ?? 0
  }
  const truthPath = resolve(truthDir, `${lang}.json`)
  check(`ground truth exists: ${lang}`, existsSync(truthPath))
  const docPath = resolve(docsDir, `real-${lang}-analyzer.md`)
  check(`analyzer doc exists: ${lang}`, existsSync(docPath))
  const complexity = existsSync(resolve(resultsDir, `${lang}-complexity.json`))
  const corpusComplexity = existsSync(resolve(resultsDir, `${lang}-corpus-complexity.json`))
  check(`complexity envelope exists: ${lang}`, complexity || corpusComplexity)
}

check("audit total fixture facts matches sweep", audit.perAnalyzerEvidence.totalFixtureFacts === totalFacts)
check("zero false positives across sweep", totalFp === 0 && audit.perAnalyzerEvidence.falsePositives === 0)
check("zero false negatives across sweep", totalFn === 0 && audit.perAnalyzerEvidence.falseNegatives === 0)
check("zero unknown symbols across sweep", totalUnk === 0 && audit.perAnalyzerEvidence.unknownSymbols === 0)
check("precision 1 across sweep", audit.perAnalyzerEvidence.precision === 1)
check("recall 1 across sweep", audit.perAnalyzerEvidence.recall === 1)

// ── Regex census ─────────────────────────────────────────────────────────────
// M49.R2 CORRECTION (2026-09-12). These two checks used to assert that the
// census reported ZERO regex usages and zero `needs_review` entries. That was
// not true when M12 closed and is not true now: it was the VACUOUS census
// state — the committed census claimed 0 usages while the analyzers carried
// 55 — and nothing caught it because the census gate was not in the battery.
// So this audit was pinning the lie, and any run of it failed forever on a
// claim nobody could honestly satisfy. It now pins what is actually owed:
// the census must be NON-VACUOUS, every usage must be classified, and the
// `needs_review` count must live inside the shrink-only debt-register budget.
// Exact census-vs-source agreement (and register-vs-scan agreement) is the job
// of script/m12/verify-regex-census.ts and script/m49/verify-r2-regex.ts.
const census = JSON.parse(readFileSync(resolve(resultsDir, "regex-census.json"), "utf8"))
const debtRegisterPath = resolve(root, "validation/m49/regex-debt-register.json")
const debtRegister = existsSync(debtRegisterPath)
  ? (JSON.parse(readFileSync(debtRegisterPath, "utf8")) as { baselineTotal?: number })
  : {}
const needsReview = (census.byClassification ?? {})["needs_review"] ?? 0
check("regex census is non-vacuous (the M12 zero-usage claim was false)", census.totalRegexUsages > 0)
check("regex census classifies every usage", (census.byClassification ?? {})["unclassified"] === undefined && (census.byClassification ?? {})["unknown"] === undefined)
check("regex census needs_review total is within the shrink-only debt budget",
  typeof debtRegister.baselineTotal === "number" && needsReview <= debtRegister.baselineTotal)
check("regex census scans 41 analyzers", census.analyzersScanned === 41)
check("regex census gate script exists", existsSync(resolve(root, "script/m12/verify-regex-census.ts")))
check("census gate wired into npm run verify", packageJson.scripts.verify.includes("m12/verify-regex-census.ts") || packageJson.scripts.verify.includes("regex-census"))

// ── Complexity ───────────────────────────────────────────────────────────────
check("no O(n²) claim present", audit.complexity.noOofN2HotPaths === true)
check("envelopes recorded for all analyzers", audit.complexity.envelopesRecordedForAllAnalyzers === true)
check("complexity result passes", audit.complexity.result === "pass")

// ── Hidden filters / claims ──────────────────────────────────────────────────
check("no hidden project-specific filters", audit.hiddenFilters.projectSpecificFilters === false)
check("unsupported claims not presented as proven", audit.claimsPolicy.unsupportedClaimsPresentedAsProven === false)
check("claims policy has explicit statement", /Unsupported claims are not presented as proven/.test(audit.claimsPolicy.statement))

// ── Failures classification ──────────────────────────────────────────────────
check("no unresolved failures", audit.failures.unresolved === 0)
check("all classified failures accepted", audit.failures.classifiedAndAccepted.length > 0)

// ── Gates ────────────────────────────────────────────────────────────────────
check("typecheck gate passes", audit.gates.typecheck === "pass")
check("parser matrix gate passes", audit.gates.parserMatrix === "pass")
check("lifecycle gate passes", audit.gates.lifecycle === "pass")
check("differential harness gate passes", audit.gates.differentialHarness === "pass")
check("regex census gate passes", audit.gates.regexCensus === "pass")
check("full verify gate passes", audit.gates.fullVerify === "pass")
check("MCP E2E gate passes", audit.gates.mcpE2e === "pass")

for (const gate of audit.gates.requiredGates) {
  check(`required gate exists: ${gate}`, existsSync(resolve(root, gate)))
  const filename = gate.split("/").pop()!
  // The quality-gate config is the gate itself; it cannot be wired into its own
  // body. Every other required gate must appear in the aggregate verify chain.
  if (filename !== "verify-quality-gate.ts") {
    check(`${filename} wired into npm run verify`, packageJson.scripts.verify.includes(filename) || packageJson.scripts.verify.includes(gate))
  }
}

for (const verifier of audit.m12Verifiers) {
  const filename = verifier.split("/").pop()!
  check(`${filename} exists`, existsSync(resolve(root, verifier)))
}

// ── Residual risks ───────────────────────────────────────────────────────────
check("residual risks all accepted", audit.residualRisks.length > 0 && audit.residualRisks.every((risk: any) => risk.status === "accepted"))

// ── Narrative sections ───────────────────────────────────────────────────────
const narrative = existsSync(auditDocPath) ? readFileSync(auditDocPath, "utf8") : ""
for (const section of [
  "Issue And Dependency Audit",
  "Artifact Matrix",
  "Per-Analyzer Differential Audit",
  "Regex Census",
  "Complexity",
  "Hidden Filters And Claims",
  "Failures: Fixed Or Explicitly Classified",
  "Gates",
  "Runtime Evidence",
  "Limitations And Deferred Work",
  "Claims Policy",
  "Release Decision",
  "Reproduction",
  "Worktree And Commit Evidence",
]) check(`narrative contains ${section}`, narrative.includes(`## ${section}`))

if (failures > 0) {
  console.error(`\nM12 FINAL AUDIT: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM12 FINAL AUDIT: PASS")
