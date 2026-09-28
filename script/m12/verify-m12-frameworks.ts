// M12.46 framework & library intelligence differential verification.
//
// Verifies framework detection across all language families:
//   1. Parses every fixture under validation/m12/framework-fixtures/<family>/
//      with the production parser (pool-worker parseFile → ASTEngine).
//   2. Emits observed facts for the PRIMARY framework and the DETECTED list.
//   3. Compares against validation/m12/ground-truth/framework.json using the
//      M11 differential harness (compareFacts) → precision/recall per file.
//   4. Asserts no fabrication: fixtures marked unknown must stay unknown /
//      language-default and must not report real frameworks.
//   5. Writes validation/m12/results/framework-differential.json.
//
// Usage: bun script/m12/verify-m12-frameworks.ts
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import { compareFacts, type ObservedFact, type ValidationFact } from "../m11/differential-harness"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = process.cwd()
const FIXTURE_ROOT = join(ROOT, "validation/m12/framework-fixtures")
const TRUTH_FILE = join(ROOT, "validation/m12/ground-truth/framework.json")
const OUT_FILE = join(ROOT, "validation/m12/results/framework-differential.json")

const truthDoc = JSON.parse(readFileSync(TRUTH_FILE, "utf8")) as { facts: ValidationFact[] }
const expectedFacts = truthDoc.facts

// ---- Observed fact emission -------------------------------------------------
const observed: ObservedFact[] = []
const perFile: Record<string, { framework: string; detected: string[] }> = {}
const crashes: { file: string; error: string }[] = []

async function analyze(fixturePath: string): Promise<void> {
  try {
    const content = readFileSync(fixturePath, "utf8")
    // Production analyzer entry point — the same engine the pool-worker
    // delegates to for indexing (ASTEngine.parseFile → framework intelligence).
    const parsed = await ASTEngine.parseFile(fixturePath, content, { projectPath: ROOT } as any)
    const md: any = parsed.metadata || {}
    const framework: string = md.framework ?? "unknown"
    const detected: string[] = Array.isArray(md.detectedFrameworks) ? md.detectedFrameworks : []
    const file = basename(fixturePath)
    perFile[file] = { framework, detected }

    observed.push({
      id: `framework:${file}:primary:${framework}`,
      layer: "intelligence",
      kind: "framework_primary",
      file,
      attributes: { framework },
      state: framework === "unknown" ? "unknown" : "resolved",
    })
    if (detected.length > 0) {
      for (const fw of detected) {
        observed.push({
          id: `framework:${file}:detected:${fw}`,
          layer: "intelligence",
          kind: "framework_detected",
          file,
          attributes: { framework: fw },
          state: "resolved",
        })
      }
    } else {
      observed.push({
        id: `framework:${file}:detected:none`,
        layer: "intelligence",
        kind: "framework_detected",
        file,
        attributes: { framework: "__none__" },
        state: "unknown",
      })
    }
  } catch (error: any) {
    crashes.push({ file: basename(fixturePath), error: String(error?.message ?? error).slice(0, 300) })
  }
}

const families = readdirSync(FIXTURE_ROOT)
  .filter((d) => !d.startsWith("."))
  .sort()
let fixtureCount = 0
for (const family of families) {
  const dir = join(FIXTURE_ROOT, family)
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue
  const files = readdirSync(dir).filter((f) => !f.startsWith(".")).sort()
  for (const file of files) {
    fixtureCount++
    await analyze(join(dir, file))
  }
}

const result = compareFacts(expectedFacts, observed)
const m = result.metrics

// ---- Report ----------------------------------------------------------------
console.log(`M12.46 framework differential: ${fixtureCount} fixtures across ${families.length} families`)
console.log(`  expected facts: ${m.expected}  observed resolved: ${m.observedResolved}`)
console.log(`  precision: ${m.precision?.toFixed(3) ?? "n/a"}  recall: ${m.recall?.toFixed(3) ?? "n/a"}`)
console.log(`  true positives: ${m.truePositive}  false positives: ${m.falsePositive}  false negatives: ${m.falseNegative}`)
console.log(`  unknown: ${m.unknown}  unsupported: ${m.unsupported}  correctly-unknown: ${m.correctlyClassifiedUnknown}`)

if (m.falsePositive > 0) {
  console.log("  FALSE POSITIVES (phantom framework detections):")
  for (const id of result.falsePositiveIds) console.log(`    - ${id}`)
}
if (m.falseNegative > 0) {
  console.log("  FALSE NEGATIVES (missed framework detections):")
  for (const id of result.falseNegativeIds) console.log(`    - ${id}`)
}
if (m.correctlyClassifiedUnknown !== m.unknown) {
  console.log("  MISCLASSIFIED UNKNOWN (fabricated detections):")
}

// Fabrication guard: every fixture expected to be unknown must not emit any
// real detected framework beyond the language default.
let fabricationFailures = 0
for (const fact of expectedFacts) {
  if ((fact.expectedState ?? "resolved") !== "unknown") continue
  const observedForFile = observed.filter((o) => o.file === fact.file)
  if (observedForFile.length === 0) continue
  const fabricated = observedForFile.filter(
    (o) => o.kind === "framework_detected" && o.attributes?.framework !== "__none__" && o.attributes?.framework !== "SQL" && o.attributes?.framework !== "Bash"
  )
  if (fabricated.length > 0) {
    fabricationFailures++
    console.log(`  FABRICATION in ${fact.file}: ${fabricated.map((f) => f.attributes?.framework).join(", ")}`)
  }
}

const passed = result.passed && fabricationFailures === 0 && crashes.length === 0
console.log(`\n${passed ? "PASS" : "FAIL"} (${crashes.length} crashes, ${fabricationFailures} fabrication failures)`)

writeFileSync(
  OUT_FILE,
  JSON.stringify(
    {
      schemaVersion: 1,
      name: "m12.46-framework-differential",
      fixtureCount,
      families,
      passed,
      metrics: m,
      crashes,
      fabricationFailures,
      perFile,
      truePositiveIds: result.truePositiveIds,
      falsePositiveIds: result.falsePositiveIds,
      falseNegativeIds: result.falseNegativeIds,
      unknownIds: result.unknownIds,
      earliestFailingLayer: result.earliestFailingLayer,
    },
    null,
    2
  )
)
console.log(`wrote ${OUT_FILE}`)
process.exit(passed ? 0 : 1)
