import { evaluateDifferential } from "./differential"

const report = {
  "java": { filesSampled: 1, coveragePct: 100, fabricationPct: 0 },
}
const current = {
  "grails-core:java": { missing: 0, unexplained: 0, heuristic: 1, perf: { avgMsPerFile: 10 } },
}
const baseline = {
  "grails-core:java": { missing: 0, unexplained: 0, heuristic: 1, perf: { avgMsPerFile: 10 } },
}

const pass = evaluateDifferential(report, current, baseline, 60, 60, "grails-core")
if (!pass.comparable || pass.regressions.length !== 0 || pass.perfRegressions.length !== 0 || pass.checks[0]?.status !== "pass") {
  throw new Error(`expected matching baseline to pass: ${JSON.stringify(pass)}`)
}

const regression = evaluateDifferential(
  report,
  { ...current, "grails-core:java": { ...current["grails-core:java"], unexplained: 1 } },
  baseline,
  60,
  60,
  "grails-core",
)
if (!regression.regressions.includes("grails-core:java") || regression.checks[0]?.status !== "fail") {
  throw new Error(`expected regression to fail evidence: ${JSON.stringify(regression)}`)
}

const probe = evaluateDifferential(report, current, baseline, 60, 5, "grails-core")
if (probe.comparable || probe.checks[0]?.status !== "fail" || !probe.checks[0]?.detail.includes("NOT COMPARABLE")) {
  throw new Error(`expected mismatched sample to be non-comparable: ${JSON.stringify(probe)}`)
}

console.log("differential evidence evaluation checks passed")
