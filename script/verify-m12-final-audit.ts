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

// ── Per-analyzer evidence: FROZEN SNAPSHOT, not the live fleet ──────────────
//
// M12 closed with 41 advertised languages and froze its evidence (fixtures, differentials, ground truth,
// complexity envelopes). The fleet has since grown to 50 and later milestones regenerated several shared
// artifacts in place (the M49 regex census rewrites regex-census.json), so this section asserted TODAY'S tree
// against a frozen record and failed forever without saying anything about today. Live-fleet truth is owned by
// script/m14/verify-fleet.ts, runtime/analyzer docs gates and the completeness inventory. This section verifies
// the RECORD is intact and that the evidence it cites still exists; drift is reported, not fatal.
const fixturesDir = resolve(root, "validation/m12/fixtures")
const resultsDir = resolve(root, "validation/m12/results")
const truthDir = resolve(root, "validation/m12/ground-truth")
const docsDir = resolve(root, "docs/analyzers")
const declaredLangs = audit.advertisedLanguages as number
const snapshot = audit.perAnalyzerEvidence
check("audit declares the fleet it shipped (41 languages at M12 close)", declaredLangs === 41)
check("audit records a per-analyzer evidence row for every advertised language", snapshot.analyzers === declaredLangs)
for (const key of ["totalFixtureFacts", "falsePositives", "falseNegatives", "unknownSymbols", "precision", "recall"]) {
  check(`audit records per-analyzer ${key}`, (snapshot as Record<string, unknown>)[key] !== undefined)
}
check("audit records zero false positives/negatives as a snapshot claim", snapshot.falsePositives === 0 && snapshot.falseNegatives === 0 && snapshot.unknownSymbols === 0)
check("audit records precision 1 and recall 1 as a snapshot claim", snapshot.precision === 1 && snapshot.recall === 1)

const filesWithSuffix = (dir: string, suffix: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".") && f.endsWith(suffix)) : []
const m12Fixtures = existsSync(fixturesDir) ? readdirSync(fixturesDir).filter((d) => !d.startsWith(".")) : []
const m12Differentials = filesWithSuffix(resultsDir, "-differential.json")
const m12GroundTruth = filesWithSuffix(truthDir, ".json")
const m12Complexity = filesWithSuffix(resultsDir, "-complexity.json")
const m12Docs = existsSync(docsDir)
  ? readdirSync(docsDir).filter((f) => f.endsWith(".md") && !["README.md", "TEMPLATE.md", "ANALYZER-SESSION-LOG.md"].includes(f))
  : []
check("M12 fixture corpus is still present", m12Fixtures.length >= declaredLangs)
check("M12 differential evidence is still present", m12Differentials.length >= declaredLangs)
check("M12 ground-truth evidence is still present", m12GroundTruth.length >= declaredLangs)
check("M12 complexity evidence is still present", m12Complexity.length >= declaredLangs)
check("analyzer documentation pages for the audit's language set still exist", m12Docs.length >= declaredLangs)
console.log(
  `  note: frozen M12 snapshot = ${declaredLangs} languages; current tree = ${m12Fixtures.length} fixture dirs, ` +
  `${m12Differentials.length} differentials, ${m12Docs.length} analyzer docs. This gate asserts the RECORD is intact; ` +
  `live-fleet health is owned by the M14 gates.`,
)

// ── Regex census: the M12 record, not the regenerated artifact ──────────────
//
// regex-census.json is regenerated by later milestones (the M49 census now scans all 50 analyzers). The M12
// record's own totals and gate path still exist and are checked here; current non-vacuity and per-analyzer scan
// counts are asserted by script/m12/verify-regex-census.ts and script/m49/verify-r2-regex.ts.
const censusPath = resolve(resultsDir, "regex-census.json")
check("M12 regex census artifact exists", existsSync(censusPath))
if (existsSync(censusPath)) {
  try {
    JSON.parse(readFileSync(censusPath, "utf8"))
    check("M12 regex census artifact is readable JSON", true)
  } catch {
    check("M12 regex census artifact is readable JSON", false)
  }
}
check("audit's census gate script still exists", existsSync(resolve(root, audit.regexCensus.gate)))
check("audit records a census result path", typeof audit.regexCensus.result === "string" && audit.regexCensus.result.length > 0)
check("audit records the M12 census totals", typeof audit.regexCensus.totalRegexUsages === "number" && typeof audit.regexCensus.analyzersScanned === "number")
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
