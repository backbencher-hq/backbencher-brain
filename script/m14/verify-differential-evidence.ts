// M14 F5 differential-evaluation self-test.
//
// This is the gate that decides whether the corpus differential can claim
// anything. It must be able to FAIL (case 2 below) and it must never label a
// rotated sample's findings as regressions (case 4) — that mislabel is exactly
// how the M49 W4 rotated-sample findings (ledger J6/T2) were reported.
import { evaluateDifferential } from "./differential"

const report = {
  "java": { filesSampled: 1, coveragePct: 100, fabricationPct: 0 },
}
const ROW = "grails-core:java"
// One declared-heuristic edge, mirroring a lane whose baseline allowance
// tolerates heuristic suspicion (so heuristic 1 is the baseline value here).
// #871: perf rows carry load context; a row pinned without it is not scored.
const ROW_COUNTS = { missing: 0, unexplained: 0, heuristic: 1, perf: { avgMsPerFile: 10, loadAvg1: 1 } }
const current = { [ROW]: { ...ROW_COUNTS, sampleHash: "aaa111" } }
const baseline = { [ROW]: { ...ROW_COUNTS } }
const HASHES = { [ROW]: "aaa111" }

// 1. Matching pinned file set, counts unchanged -> pass.
const pass = evaluateDifferential(report, current, baseline, 60, 60, "grails-core", HASHES)
if (
  !pass.comparable || pass.regressions.length !== 0 || pass.perfRegressions.length !== 0
  || pass.resampled.length !== 0 || pass.unpinnedLanes.length !== 0 || pass.checks[0]?.status !== "pass"
) {
  throw new Error(`expected matching baseline to pass: ${JSON.stringify(pass)}`)
}

// 2. The gate must still be able to FAIL: same drawn file set, counts grew.
const regression = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], unexplained: 1 } },
  baseline,
  60,
  60,
  "grails-core",
  HASHES,
)
if (!regression.regressions.includes(ROW) || regression.checks[0]?.status !== "fail") {
  throw new Error(`expected regression to fail evidence: ${JSON.stringify(regression)}`)
}

// 3. M49 G5 — cold-pool rotation: a DIFFERENT drawn file set. Parity on the
// fresh sample is what the check can verify; the pinned allowance cannot be
// applied. A clean resampled lane passes, and says in the evidence that its
// counts were not compared (including its unscored heuristic edges).
const resampledClean = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], sampleHash: "bbb222" } },
  baseline,
  60,
  60,
  "grails-core",
  HASHES,
)
if (
  resampledClean.regressions.length !== 0 || !resampledClean.resampled.includes(ROW)
  || resampledClean.checks[0]?.status !== "pass"
  || !String(resampledClean.checks[0]?.detail).includes("resampled")
  || !String(resampledClean.checks[0]?.detail).includes("unscored")
) {
  throw new Error(`expected a clean rotated sample to pass while disclosing the resample: ${JSON.stringify(resampledClean)}`)
}

// 4. THE regression this was built for: the same counts that are a regression
// on a pinned sample must NOT be reported as one when the sample rotated
// (that is the #770/#771 mislabel), and must not be able to pass silently
// either — the lane's own missing/unexplained anomalies fail the check for
// triage.
const rotatedGrowth = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], unexplained: 1, sampleHash: "bbb222" } },
  baseline,
  60,
  60,
  "grails-core",
  HASHES,
)
if (
  rotatedGrowth.regressions.length !== 0
  || !rotatedGrowth.resampled.includes(ROW)
  || rotatedGrowth.checks[0]?.status !== "fail"
  || !String(rotatedGrowth.checks[0]?.detail).includes("different file set")
) {
  throw new Error(`expected a rotated sample's growth to be triage, not a regression: ${JSON.stringify(rotatedGrowth)}`)
}

// 5. Pre-G5 baseline rows carry no drawn-set hash: the strict count comparison
// is the only claim available, so it is KEPT (conservative default) but the
// lane is disclosed as unpinned so the gap can only shrink.
const unpinned = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], unexplained: 1 } },
  baseline,
  60,
  60,
  "grails-core",
  {},
)
if (!unpinned.regressions.includes(ROW) || !unpinned.unpinnedLanes.includes(ROW) || unpinned.resampled.length !== 0) {
  throw new Error(`expected an unpinned baseline lane to stay strict AND be disclosed: ${JSON.stringify(unpinned)}`)
}

// 6. Probe mode (sample size differs): nothing is comparable.
const probe = evaluateDifferential(report, current, baseline, 60, 5, "grails-core")
if (probe.comparable || probe.checks[0]?.status !== "fail" || !probe.checks[0]?.detail.includes("NOT COMPARABLE")) {
  throw new Error(`expected mismatched sample to be non-comparable: ${JSON.stringify(probe)}`)
}

// 7. #871 §1 — a baseline row without load context is REFUSED, not scored: a
// breach-versus-busy-machine judgement needs the context, so the perf check
// must not fire (and the refusal must be disclosed). Counts are still scored.
const noContextBaseline = { [ROW]: { ...ROW_COUNTS, perf: { avgMsPerFile: 10 } } }
const noContext = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], perf: { avgMsPerFile: 999, loadAvg1: 1 } } },
  noContextBaseline,
  60,
  60,
  "grails-core",
  HASHES,
)
if (
  noContext.perfRegressions.length !== 0
  || !noContext.perfUnscored.some((x: string) => x.startsWith(ROW))
  || noContext.regressions.length !== 0
) {
  throw new Error(`expected a context-less baseline perf row to be refused, not scored: ${JSON.stringify(noContext)}`)
}

// 8. The perf gate must still be able to FAIL: with context recorded on both
// sides, a >3x breach is a regression.
const perfBreach = evaluateDifferential(
  report,
  { ...current, [ROW]: { ...current[ROW], perf: { avgMsPerFile: 999, loadAvg1: 1 } } },
  baseline,
  60,
  60,
  "grails-core",
  HASHES,
)
if (!perfBreach.perfRegressions.some((x: string) => x.startsWith(ROW)) || perfBreach.perfUnscored.length !== 0) {
  throw new Error(`expected a context-scored perf breach to fire: ${JSON.stringify(perfBreach)}`)
}

console.log("differential evidence evaluation checks passed (8 cases: pass, regression, resampled-clean, rotated-growth-is-triage, unpinned, probe-mode, perf-refused-without-context, perf-breach-fires)")
