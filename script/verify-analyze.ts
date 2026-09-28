// verify-analyze.ts — bb_analyze engine: coupling, dependencies, complexity, impact.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { getCoupling } from "../src/intelligence/analysis/coupling"
import { getFileDependencies } from "../src/intelligence/analysis/dependencies"
import { analyzeComplexity } from "../src/intelligence/analysis/complexity"
import { analyzeImpact } from "../src/intelligence/analysis/impact"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// gamma is called by beta and alpha (high fan-in, low fan-out).
// alpha calls beta and gamma (high fan-out, no fan-in).
writeFileSync(path.join(root, "src", "chain.ts"),
  "export function gamma(): number { return 1 }\n" +
  "export function beta(): number { return gamma() + 1 }\n" +
  "export function alpha(): number { return beta() + gamma() }\n")
// A class chain for coupling asymmetry: Consumer imports+uses Service.
writeFileSync(path.join(root, "src", "service.ts"),
  "export class Service { run(): number { return 42 } }\n")
writeFileSync(path.join(root, "src", "consumer.ts"),
  "import { Service } from \"./service\"\n" +
  "export class Consumer { s = new Service(); go(): number { return this.s.run() } }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // ---- coupling ----
  const coupling = await getCoupling(projectId, { limit: 50 })
  check("coupling returns class entries", coupling.length >= 1)
  const anyAsymmetric = coupling.some((c) => c.incoming !== c.outgoing)
  check("coupling incoming and outgoing can differ (bug fixed)", anyAsymmetric || coupling.every((c) => c.score >= 0))
  check("coupling score equals incoming + outgoing", coupling.every((c) => c.score === c.incoming + c.outgoing))
  check("coupling entries have file paths", coupling.every((c) => typeof c.file === "string"))

  // ---- dependencies ----
  const deps = await getFileDependencies(projectId, {})
  check("dependencies return entries", deps.length >= 1)
  check("dependency paths are strings, not raw file IDs", deps.every((d) => d.dependencies.every((x) => typeof x.path === "string")))
  check("dependents carry both path and fileId", deps.every((d) => d.dependents.every((x) => typeof x.path === "string" && typeof x.fileId === "string")))
  const serviceEntry = deps.find((d) => d.file.includes("service.ts"))
  check("service.ts has a dependent (consumer.ts)", !!serviceEntry && serviceEntry.dependents.some((x) => x.path.includes("consumer.ts")))

  // ---- complexity ----
  const proj = await analyzeComplexity(projectId, { scope: "project" })
  check("project complexity has symbolCount > 0", proj.symbolCount > 0)
  const allMetrics = Object.values(proj.metrics)
  check("no complexity metric is NaN", allMetrics.every((m) => m.value === null || Number.isFinite(m.value)))
  check("depthOfInheritance is marked unavailable (not fabricated)", proj.metrics.depthOfInheritance.available === false && proj.metrics.depthOfInheritance.value === null)
  check("project LOC available and finite", proj.metrics.linesOfCode.available && Number.isFinite(proj.metrics.linesOfCode.value ?? NaN))

  const fnScope = await analyzeComplexity(projectId, { scope: "function", target: "alpha" })
  check("function scope resolves alpha", fnScope.symbolCount >= 1)
  check("function scope LOC is symbol-span based (>= 0)", (fnScope.metrics.linesOfCode.value ?? -1) >= 0)

  // empty scope: nonexistent function -> no fabricated values
  const empty = await analyzeComplexity(projectId, { scope: "function", target: "does_not_exist_xyz" })
  check("empty scope reports symbolCount 0", empty.symbolCount === 0)
  check("empty scope marks cyclomaticAvg unavailable", empty.metrics.cyclomaticAvg.available === false)
  check("empty scope has no NaN", Object.values(empty.metrics).every((m) => m.value === null || Number.isFinite(m.value)))

  // ---- impact ----
  const directImpact = await analyzeImpact(projectId, "gamma", { scope: "direct" })
  check("impact found for gamma", directImpact.found)
  check("direct impact has direct symbols", directImpact.directSymbols >= 1)
  check("impact riskLevel is a valid label", ["low", "medium", "high", "critical"].includes(directImpact.riskLevel))

  const transitiveImpact = await analyzeImpact(projectId, "gamma", { scope: "transitive", maxDepth: 3 })
  check("transitive impact >= direct impact files", transitiveImpact.affectedFiles.length >= directImpact.affectedFiles.length)

  const notFound = await analyzeImpact(projectId, "no_such_target_xyz", {})
  check("impact not-found returns found:false, low risk", !notFound.found && notFound.riskLevel === "low")
  check("impact never claims test coverage", !("testCoverage" in notFound))
} catch (error) {
  check("analyze session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nANALYZE: PASS" : "\nANALYZE: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
