import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { compareFacts, measureOperation, type ObservedFact, type ValidationFact } from "./m11/differential-harness"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const fixtureRoot = resolve(root, "validation/m11/fixtures")
const expectedArtifact = JSON.parse(readFileSync(resolve(fixtureRoot, "harness-expected.json"), "utf8")) as { facts: ValidationFact[] }
const passingArtifact = JSON.parse(readFileSync(resolve(fixtureRoot, "harness-observed-pass.json"), "utf8")) as { facts: ObservedFact[] }
const failingArtifact = JSON.parse(readFileSync(resolve(fixtureRoot, "harness-observed-fail.json"), "utf8")) as { facts: ObservedFact[] }
const schemaPaths = [
  "validation/m11/schemas/ground-truth.schema.json",
  "validation/m11/schemas/observed-facts.schema.json",
  "validation/m11/schemas/differential-result.schema.json",
]

let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

const passing = compareFacts(expectedArtifact.facts, passingArtifact.facts)
check("passing fixture passes", passing.passed)
check("passing fixture has perfect precision", passing.metrics.precision === 1)
check("passing fixture has perfect recall", passing.metrics.recall === 1)
check("passing fixture has no false positives", passing.metrics.falsePositive === 0)
check("passing fixture has no false negatives", passing.metrics.falseNegative === 0)
check("passing fixture classifies one honest unknown", passing.metrics.correctlyClassifiedUnknown === 1)
check("passing fixture reports one unknown observation", passing.metrics.unknown === 1)
check("passing fixture has no failing layer", passing.earliestFailingLayer === null)
check("passing fixture has no minimized failure", passing.minimizedFailure === null)

const failing = compareFacts(expectedArtifact.facts, failingArtifact.facts)
check("negative fixture fails", !failing.passed)
check("negative fixture detects phantom and invented dynamic certainty", failing.metrics.falsePositive === 2)
check("negative fixture detects missing resolvable facts", failing.metrics.falseNegative === 3)
check("negative fixture reports unknown observation", failing.metrics.unknown === 1)
check("negative fixture attributes earliest failure to AST extraction", failing.earliestFailingLayer === "ast_extraction")
check("negative fixture emits one minimized expected fact", failing.minimizedFailure?.expected.length === 1)
check("negative fixture emits one minimized observed fact", failing.minimizedFailure?.observed.length === 1)
check("negative fixture precision is below one", failing.metrics.precision !== null && failing.metrics.precision < 1)
check("negative fixture recall is below one", failing.metrics.recall !== null && failing.metrics.recall < 1)
check("negative fixture has non-zero unknown rate", failing.metrics.unknownRate !== null && failing.metrics.unknownRate > 0)

let duplicateRejected = false
try { compareFacts([...expectedArtifact.facts, expectedArtifact.facts[0]!], passingArtifact.facts) } catch (error) {
  duplicateRejected = /duplicate comparison keys/.test((error as Error).message)
}
check("duplicate expected facts are rejected", duplicateRejected)
for (const schemaPath of schemaPaths) {
  const schema = JSON.parse(readFileSync(resolve(root, schemaPath), "utf8")) as { $id?: string; schemaVersion?: unknown }
  check(`${schemaPath} is valid JSON schema metadata`, typeof schema.$id === "string" && schema.$id.length > 0)
}
check("expected facts have independent evidence authority", expectedArtifact.facts.every((fact) => ["source", "compiler", "language_service", "ide_index", "manual_audit"].includes(fact.evidence.authority)))
check("expected facts are not analyzer-produced", !expectedArtifact.facts.some((fact) => fact.evidence.authority === ("analyzer" as never)))
check("observed facts carry explicit states", passingArtifact.facts.every((fact) => ["resolved", "inferred", "unknown", "unsupported"].includes(fact.state)))

const temp = mkdtempSync(resolve(tmpdir(), "bb-m11-harness-"))
const databasePath = resolve(temp, "fixture.db")
writeFileSync(databasePath, "database-fixture")
const operationNames = ["cold_index", "warm_index", "incremental", "deletion", "rename", "restart", "query"]
const measurements = []
try {
  for (const name of operationNames) {
    const { value, measurement } = await measureOperation(name, () => expectedArtifact.facts.length, {
      files: 1,
      symbols: 4,
      relationships: 3,
      databasePath,
    })
    check(`${name} operation returns value`, value === expectedArtifact.facts.length)
    check(`${name} wall time is finite`, Number.isFinite(measurement.wallTimeMs) && measurement.wallTimeMs >= 0)
    check(`${name} CPU times are finite`, Number.isFinite(measurement.userCpuMs) && Number.isFinite(measurement.systemCpuMs))
    check(`${name} peak RSS is positive`, measurement.peakRssBytes > 0)
    check(`${name} database size is measured`, measurement.databaseBytes === 16)
    check(`${name} throughput fields are finite`, measurement.filesPerSecond !== null && Number.isFinite(measurement.filesPerSecond))
    measurements.push(measurement)
  }

  const output = {
    schemaVersion: 1,
    kind: "harness_self_validation",
    truthSource: "validation/m11/fixtures/harness-expected.json",
    passing,
    intentionalFailure: failing,
    measurements,
    note: "These measurements validate harness fields and lifecycle labels; they are not product performance baselines.",
  }
  const outputPath = resolve(root, "validation/m11/results/harness-last-run.json")
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
  check("versioned harness result is written", readFileSync(outputPath, "utf8").includes("harness_self_validation"))
} finally {
  rmSync(temp, { recursive: true, force: true })
}

console.log(failures === 0 ? "\nM11 DIFFERENTIAL HARNESS: PASS" : `\nM11 DIFFERENTIAL HARNESS: FAIL (${failures})`)
process.exit(failures > 0 ? 1 : 0)
