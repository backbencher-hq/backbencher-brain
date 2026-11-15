// Planted-mutant red runs for bb_impact: each mutant must turn its gate RED,
// then the file is restored byte-exactly and the gate is shown green again.
// Records validation/tools/bb_impact/MUTANTS.json. Read-only with respect to the
// shared index (BB_M48_READ_ONLY=1); mutates ONLY the named source file for the
// duration of one gate run and restores it from in-memory bytes.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/MUTANTS.json")
const IMPACT = path.join(ROOT, "src/lsp/impact.ts")
const HANDLER = path.join(ROOT, "src/mcp/tools/bb_impact/handler.ts")

type Mutant = {
  id: string
  defect: string
  file: string
  find: string
  replace: string
  gate: string
  expectFailureIncludes: string[]
}

const MUTANTS: Mutant[] = [
  {
    id: "M-B1-node-budget-removed",
    defect: "the declared 200-node budget no longer caps the returned set",
    file: IMPACT,
    find: "    if (impact.length >= IMPACT_BUDGET.maxNodes) {\n      truncated = true\n      truncationReason = \"impact-node-budget-exhausted\"\n      break\n    }",
    replace: "    if (impact.length > IMPACT_BUDGET.maxNodes + 1000) {\n      break\n    }",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["capped at the declared node budget"],
  },
  {
    id: "M-B2-hollow-total",
    defect: "the declared total is inferred from the returned set instead of measured",
    file: IMPACT,
    find: "  const total = unmeasurable ? null : counts.total",
    replace: "  const total = impact.length",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["measured a larger total"],
  },
  {
    id: "M-B3-truncated-hardcoded-false",
    defect: "a prefix set is reported as complete",
    file: IMPACT,
    find: "    truncated = true\n    truncationReason = truncationReason ?? \"impact-set-shorter-than-unbounded-walk\"",
    replace: "    truncated = false",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["truncated:true"],
  },
  {
    id: "M-B4-scan-ceiling-ignored",
    defect: "the counting walk returns a number after its declared scan ceiling",
    file: IMPACT,
    find: "      total: hitScanCeiling ? null : found.size,",
    replace: "      total: found.size,",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["scan ceiling"],
  },
  {
    id: "M-C1-cascade-via-collapsed",
    defect: "owner-cascade dependents are labelled exact (attribution dropped)",
    file: IMPACT,
    find: "      via: edge.targetMatch === \"owner-cascade\" ? \"member\" : \"exact\",",
    replace: "      via: \"exact\",",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["owner cascade"],
  },
  {
    id: "M-C2-cascade-composition-hardcoded",
    defect: "the returned set's cascade composition is fabricated",
    file: IMPACT,
    find: "    cascade = { exact, member, rangeFolded }",
    replace: "    cascade = { exact: impact.length, member: 0, rangeFolded: 0 }",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["owner cascade"],
  },
  {
    id: "M-H1-empty-rule-accepted",
    defect: "an empty relationshipTypes list is silently re-read as the engine default",
    file: IMPACT,
    find: "  if (relationshipTypes.length === 0) {\n    throw new Error(\n      \"bb/impact: relationshipTypes must name at least one relationship kind — an empty list matches nothing and would be silently re-read as the engine's default\",\n    )\n  }",
    replace: "  if (relationshipTypes.length === 0) {\n    // mutant: accept and let the engine substitute\n  }",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["REFUSES an empty relationshipTypes"],
  },
  {
    id: "M-H2-completeness-clearing-removed",
    defect: "a measured-complete set keeps a stale prefix claim",
    file: IMPACT,
    find: "  if (provenComplete && !walkTimeBoundFired) {\n    truncated = false\n    truncationReason = null\n  }",
    replace: "  if (provenComplete && !walkTimeBoundFired) {\n    // mutant: keep the stale prefix claim\n  }",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["NOT a set truncation"],
  },
  {
    id: "M-H3-complete-flag-hollow",
    defect: "countVerification.complete is always true",
    file: IMPACT,
    find: "      complete: verify && !counts.skipped ? provenComplete : null,",
    replace: "      complete: true,",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["disagrees"],
  },
  {
    id: "M-H4-refused-rule-reported-as-zero",
    defect: "a refused counting rule is reported as a measured zero instead of failed",
    file: IMPACT,
    find: "      total: null,\n      direct: 0,\n      rowsScanned: 0,\n      expansions: 0,\n      hitScanCeiling: false,\n      timedOut: false,\n      failed: true,",
    replace: "      total: null,\n      direct: 0,\n      rowsScanned: 0,\n      expansions: 0,\n      hitScanCeiling: false,\n      timedOut: false,\n      failed: false,",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["failed, not as zero"],
  },
  {
    id: "M-H5-file-hint-ignored",
    defect: "the optional file hint is silently dropped (ambiguous member cannot be resolved)",
    file: HANDLER,
    find: "computeImpact(raw, projectId as string, symbol, {}, memberFile, relationshipTypes ? { relationshipTypes } : {})",
    replace: "computeImpact(raw, projectId as string, symbol, {}, undefined, relationshipTypes ? { relationshipTypes } : {})",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["hint resolves the member"],
  },
  {
    id: "M-T1-walk-deadline-removed",
    defect: "the declared walk deadline is dropped, so a hub answer can spend unbounded wall time",
    file: IMPACT,
    find: "    timeBudgetMs: IMPACT_WALK_TIME_CEILING_MS,",
    replace: "    // mutant: no declared walk deadline",
    gate: "script/m48/verify-p1-impact-unity.ts",
    expectFailureIncludes: ["declares the walk deadline it applied"],
  },
  {
    id: "M-P2-hollow-field-planted",
    defect: "a tool builder publishes a completeness field that can only ever be false",
    file: HANDLER,
    find: "export const handler: ToolHandler = async (args, { projectId, projectPath }) => {",
    replace: "const __hollowCompleteness = { truncated: false, declaredAbsent: false }\nexport const handler: ToolHandler = async (args, { projectId, projectPath }) => {",
    gate: "script/m48/verify-p2-honesty-fields.ts",
    expectFailureIncludes: ["hollow completeness field"],
  },
]

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")

function runGate(gate: string) {
  const res = spawnSync("npx", ["tsx", gate], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 420_000,
    env: { ...process.env, BB_M48_READ_ONLY: "1", BB_NO_AUTO_REFRESH: "1" },
  })
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`
  return { exit: res.status ?? -1, out }
}

const results: any[] = []
const failuresAtStart: string[] = []

for (const mutant of MUTANTS) {
  const original = readFileSync(mutant.file)
  const originalHash = sha(mutant.file)
  const source = original.toString("utf8")
  if (!source.includes(mutant.find)) {
    failuresAtStart.push(`${mutant.id}: anchor not found in ${path.relative(ROOT, mutant.file)}`)
    results.push({ id: mutant.id, defect: mutant.defect, status: "ANCHOR-MISSING", gate: mutant.gate })
    continue
  }
  writeFileSync(mutant.file, source.replace(mutant.find, mutant.replace))
  const mutatedHash = sha(mutant.file)
  let red: { exit: number; out: string }
  try {
    red = runGate(mutant.gate)
  } finally {
    writeFileSync(mutant.file, original)
  }
  const restoredHash = sha(mutant.file)
  const redObserved = red.exit !== 0
  const expectedFailureLine = mutant.expectFailureIncludes.find((needle) => red.out.includes(needle))
  results.push({
    id: mutant.id,
    defect: mutant.defect,
    targetFile: path.relative(ROOT, mutant.file),
    gate: mutant.gate,
    mutatedHash,
    restoredHash,
    restoredExactly: restoredHash === originalHash,
    exit: red.exit,
    redObserved,
    expectedFailureMatched: expectedFailureLine ?? null,
    failureLines: red.out.split("\n").filter((line) => line.trim().startsWith("FAIL")).slice(0, 4),
  })
  console.log(`${mutant.id}: exit=${red.exit} red=${redObserved} matched=${expectedFailureLine ?? "NO"}`)
  if (!redObserved || expectedFailureLine === undefined) {
    failuresAtStart.push(`${mutant.id}: gate did not go red on the expected assertion`)
  }
}

// Baseline after restore: the gates must be green on the restored tree.
const baselineP1 = runGate("script/m48/verify-p1-impact-unity.ts")
const baselineP2 = runGate("script/m48/verify-p2-honesty-fields.ts")

const evidence = {
  schemaVersion: 1,
  tool: "bb_impact",
  generatedAt: new Date().toISOString(),
  currentCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
  method: "each mutant is written into the named source file, its gate is run with BB_M48_READ_ONLY=1, the file is restored byte-exactly, and the sha256 is checked; then both gates are shown green on the restored tree",
  baseline: {
    p1: { exit: baselineP1.exit, pass: baselineP1.out.includes("PASS") },
    p2: { exit: baselineP2.exit, pass: baselineP2.out.includes("PASS") },
  },
  mutants: results,
  allMutantsRed: results.every((r) => r.redObserved === true),
  allMutantsMatchedExpectedAssertion: results.every((r) => r.expectedFailureMatched !== null),
  allRestoredExactly: results.every((r) => r.restoredExactly === true),
  failuresAtStart,
}
writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n")
console.log(`MUTANTS: ${results.length} run, allRed=${evidence.allMutantsRed}, allMatched=${evidence.allMutantsMatchedExpectedAssertion}, allRestored=${evidence.allRestoredExactly}`)
console.log(`BASELINE: P1 exit=${baselineP1.exit} P2 exit=${baselineP2.exit}`)
if (failuresAtStart.length > 0) { console.error(failuresAtStart.join("\n")); process.exit(1) }
if (!evidence.allMutantsRed || !evidence.allMutantsMatchedExpectedAssertion || !evidence.allRestoredExactly || baselineP1.exit !== 0 || baselineP2.exit !== 0) process.exit(1)
