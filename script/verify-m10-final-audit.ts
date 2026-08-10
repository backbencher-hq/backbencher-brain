import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const auditPath = resolve(root, "docs/data/m10-final-audit.json")
const auditDocPath = resolve(root, "docs/M10-FINAL-AUDIT.md")
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
check("audit identifies M10 issue 115", audit.milestone === "M10" && audit.issue === 115)
check("release decision is ready", audit.releaseDecision === "ready")
check("release version matches package", audit.releaseVersion === "0.3.0")
check("narrative final audit exists", existsSync(auditDocPath))

check("audit contains exactly eight ordered issues", audit.issues.length === 8)
check("issue order is contiguous", audit.issues.every((issue: any, index: number) => issue.order === index + 1))
check("issue numbers match M10 order",
  JSON.stringify(audit.issues.map((issue: any) => issue.issue)) === JSON.stringify([116, 118, 113, 117, 114, 121, 120, 115]))
check("M10.01-M10.07 are closed", audit.issues.slice(0, 7).every((issue: any) => issue.status === "closed"))
check("M10.08 is ready to close", audit.issues[7].status === "ready_to_close")
check("M10.08 uses reproducible self-commit marker",
  audit.issues[7].commit === "audit-commit-containing-this-artifact")

for (const issue of audit.issues) {
  check(`issue #${issue.issue} has commit evidence`, typeof issue.commit === "string" && issue.commit.length >= 7)
  check(`issue #${issue.issue} has artifacts`, Array.isArray(issue.artifacts) && issue.artifacts.length > 0)
  check(`issue #${issue.issue} has verifiers`, Array.isArray(issue.verifiers) && issue.verifiers.length > 0)
  for (const artifact of issue.artifacts) check(`artifact exists: ${artifact}`, existsSync(resolve(root, artifact)))
  for (const verifier of issue.verifiers) check(`verifier exists: ${verifier}`, existsSync(resolve(root, verifier)))
}

check("public contract baseline unchanged", audit.publicContract.changed === false)
check("audit declares ten tools", audit.publicContract.toolCount === 10)
check("runtime exposes ten tools", PUBLIC_TOOL_DESCRIPTORS.length === 10)
check("runtime exposes no aliases", PUBLIC_TOOL_DESCRIPTORS.every((tool) => tool.aliases.length === 0))
check("runtime exposes no deprecated descriptors", PUBLIC_TOOL_DESCRIPTORS.every((tool) => !tool.deprecated))
check("audit and runtime tool count agree", audit.publicContract.toolCount === PUBLIC_TOOL_DESCRIPTORS.length)

check("correctness result passes", audit.correctness.result === "pass" && audit.correctness.regressions === 0)
check("performance result passes", audit.performance.result === "pass")
check("all 16 benchmark measurements pass", audit.performance.measurementCount === 16 && audit.performance.passed === 16)
check("benchmark has no violations", audit.performance.violations === 0)
check("deletion result passes", audit.deletion.result === "pass")
check("runtime evidence passes", audit.runtimeEvidence.result === "pass")

for (const path of [
  audit.publicContract.baseline,
  audit.correctness.fixture,
  audit.correctness.verifier,
  audit.performance.baseline,
  audit.performance.lastRun,
  audit.deletion.ledger,
  ...audit.runtimeEvidence.bunSource,
  ...audit.runtimeEvidence.compiledNode.filter((item: string) => item.includes("/")),
]) check(`referenced evidence exists: ${path}`, existsSync(resolve(root, path)))

check("all residual risks explicitly accepted",
  audit.residualRisks.length > 0 && audit.residualRisks.every((risk: any) => risk.status === "accepted"))
check("unsupported claims are not presented as proven",
  audit.claimsPolicy.unsupportedClaimsPresentedAsProven === false)
check("claims policy has explicit statement",
  /Unsupported claims are not presented as proven/.test(audit.claimsPolicy.statement))

for (const verifier of audit.m10Verifiers) {
  const filename = verifier.split("/").pop()!
  check(`${filename} exists`, existsSync(resolve(root, verifier)))
  check(`${filename} wired into npm run verify`, packageJson.scripts.verify.includes(verifier))
  check(`${filename} wired into quality gate`, qualityGate.includes(filename))
}

const narrative = existsSync(auditDocPath) ? readFileSync(auditDocPath, "utf8") : ""
for (const section of [
  "Issue And Dependency Audit",
  "Artifact Matrix",
  "Public Contract Comparison",
  "Correctness And Performance",
  "Deletion And Quarantine",
  "Runtime Evidence",
  "Limitations And Deferred Work",
  "Claims Policy",
  "Release Decision",
  "Reproduction",
  "Worktree And Commit Evidence",
]) check(`narrative contains ${section}`, narrative.includes(`## ${section}`))

if (failures > 0) {
  console.error(`\nM10 FINAL AUDIT: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM10 FINAL AUDIT: PASS")
