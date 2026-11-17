/**
 * Java M12 mismatch classification, read-only.
 * Do not re-label differences as correct facts without independent proof.
 * Records explicitly what is comparable and what remains to adjudicate.
 */
import { readFileSync } from "node:fs"

const root = process.cwd()
const differential = JSON.parse(readFileSync(root + "/validation/m12/results/java-differential.json", "utf8"))
const ground = JSON.parse(readFileSync(root + "/validation/m12/ground-truth/java.json", "utf8"))
const passing = differential.passing
const fp = passing.falsePositiveIds as string[]
const fn = passing.falseNegativeIds as string[]
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error("JAVA_M12_ADJUDICATION_FAILED: " + message)
}
assert(passing.passed === false, "this report expects the presently failing M12 comparison")
assert(fp.length === passing.metrics.falsePositive, "all FP ids must be represented")
assert(fn.length === passing.metrics.falseNegative, "all FN ids must be represented")
const truthKinds = new Set(
  (ground.facts as Array<{kind?: string; attributes?: Record<string, unknown>}>)
    .filter(x => x.kind === "relationship")
    .map(x => x.attributes?.relationshipType ?? x.attributes?.type)
)
const matchedFp = new Set<string>()
const matchedFn = new Set<string>()
const structuralCandidates: Array<{truth: string; observed: string; explanation: string}> = []

// A missing truth family is NOT an independently verified false positive.
// This is coverage debt, not a certificate that all observed edges are valid.
const unscoredFamilies = fp.filter(id =>
  (id.includes(":imports:") && !truthKinds.has("imports")) ||
  (id.includes(":exports:") && !truthKinds.has("exports")))
for (const id of unscoredFamilies) matchedFp.add(id)

for (const missing of fn) {
  const m = /^sym:([^:]+):(\d+):([^:]+):([^:]+)$/.exec(missing)
  if (!m) continue
  const [ , file, line, kind, name ] = m
  for (const extra of fp) {
    if (matchedFp.has(extra)) continue
    const e = /^symbol:([^:]+):(\d+):([^:]+):([^:]+)$/.exec(extra)
    if (!e || e[1] !== file || e[3] !== kind) continue
    const sameName = e[4] === name
    const oneLineShift = sameName && Number(e[2]) === Number(line) + 1
    const constructorRename = kind === "constructor" &&
      name === "constructor" && Number(e[2]) === Number(line)
    if (!oneLineShift && !constructorRename) continue
    matchedFp.add(extra)
    matchedFn.add(missing)
    structuralCandidates.push({
      truth: missing, observed: extra,
      explanation: oneLineShift
        ? "candidate declaration-line convention drift (annotation vs identifier)"
        : "candidate constructor naming convention drift (literal vs owner name)",
    })
    break
  }
}
for (const missing of fn) {
  const m = /^rel:([^:]+):contains:([^:]+):constructor$/.exec(missing)
  if (!m) continue
  const expectedObserved = `rel:${m[1]}:contains:${m[2]}:${m[2]}`
  if (!fp.includes(expectedObserved) || matchedFp.has(expectedObserved)) continue
  matchedFn.add(missing)
  matchedFp.add(expectedObserved)
  structuralCandidates.push({
    truth: missing, observed: expectedObserved,
    explanation: "candidate constructor containment target naming drift",
  })
}
const compilerOverrideFacts = fn.filter(x => x.includes(":overrides:"))
const outstandingFp = fp.filter(id => !matchedFp.has(id))
const outstandingFn = fn.filter(id => !matchedFn.has(id))

const report = {
  input: differential.fixtureDir,
  groundTruthSource: ground.truthSource,
  raw: { falsePositive: fp.length, falseNegative: fn.length, passed: passing.passed },
  knownOracleCoverageGap: {
    unscoredImportsAndExports: unscoredFamilies.length,
    examples: unscoredFamilies.slice(0, 4),
  },
  structuralIdentityCandidates: {
    count: structuralCandidates.length,
    pairs: structuralCandidates,
  },
  compilerProvenOverrideFactsStillMissingInM12: compilerOverrideFacts,
  remainingForIndependentAdjudication: {
    falsePositive: outstandingFp,
    falseNegative: outstandingFn,
  },
  caveat: "This script classifies mismatch candidates only; it does not modify ground truth, establish semantic precision, or declare M12 passed.",
}
assert(matchedFp.size + outstandingFp.length === fp.length, "FP ids were dropped")
assert(matchedFn.size + outstandingFn.length === fn.length, "FN ids were dropped")
console.log("JAVA_M12_MISMATCH_CENSUS", JSON.stringify(report))
console.log(`JAVA_M12_MISMATCH_CENSUS_SUMMARY FP=${fp.length} FN=${fn.length} oracle-coverage=${unscoredFamilies.length} paired-identity-candidates=${structuralCandidates.length} unresolved-FP=${outstandingFp.length} unresolved-FN=${outstandingFn.length}`)
