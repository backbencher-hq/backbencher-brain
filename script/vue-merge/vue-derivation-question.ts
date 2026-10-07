// VUE_MERGE — DERIVATION question, asked of the master-owned gate itself.
//
// script/m60/rel-type-coverage-gate.ts is shared harness and this lane does not
// edit it. It EXPORTS runGate(), which is pure (reads engine.ts, differential.ts,
// graph-engine.ts and each analyzer's source; writes nothing). So the DERIVATION
// question — "is VUE_MERGE among the 100 findings: a type the analyzer emits
// that no oracle audits?" — is answered by CALLING the arbiter, not by
// re-implementing its regex over my own analyzer.
//
//   mode 1: runGate(["vue"]) — what the gate says today, from this worktree
//   mode 2: --classify — where each emitted type is actually PRODUCED on the
//           corpus (mine, measured) against what the gate calls audited.
//
// NO REGEX in this file. Reads the gate's own output.
import { runGate, readAuditedSets } from "../../script/m60/rel-type-coverage-gate"

const run = runGate(["vue"])
const lane = run.lanes.find((l) => l.lang === "vue")
console.log(`gate input errors: ${run.inputErrors.length}${run.inputErrors.length ? " -> " + JSON.stringify(run.inputErrors) : ""}`)
console.log(`lane vue: emitted(constructible) = ${JSON.stringify(lane?.emitted)}`)
console.log(`lane vue: audited(derived by an oracle) = ${JSON.stringify(lane?.audited)}`)
const deriv = run.findings.filter((f) => f.check === "DERIVATION" && f.lang === "vue")
console.log(`DERIVATION findings for vue: ${deriv.length}`)
for (const f of deriv) console.log(`  ${f.detail}`)
const reach = run.findings.filter((f) => f.check === "REACHABILITY" && f.lang === "vue")
console.log(`REACHABILITY findings for vue: ${reach.length}`)
for (const f of reach) console.log(`  ${f.detail}`)

// Per-type audit map, read from the gate's audited set rather than restated.
if (process.argv.includes("--classify")) {
  const r = readAuditedSets(["vue"])
  console.log(`readAuditedSets(["vue"]).failed = ${JSON.stringify(r.failed)}`)
  console.log(`audited set = ${JSON.stringify([...(r.sets.get("vue") ?? [])].sort())}`)
}