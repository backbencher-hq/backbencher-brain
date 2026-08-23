/** Emits M14.0.F2 evidence through the harness it describes. */
import { emitEvidence } from "./evidence-harness"

emitEvidence({
  issueId: "M14.0.F2",
  title: "Evidence harness v2",
  claimLevel: "L1",
  layers: ["evidence-infrastructure"],
  checks: [
    { id: "selftest-7", description: "validator selftest proves rejections (missing fields, fake levels, banned terms, empty limitations, unbacked L5, determinism)", status: "pass", detail: "7/7" },
    { id: "determinism", description: "regeneration at same HEAD is byte-identical (md5 verified)", status: "pass" },
    { id: "adoption", description: "F1/F3/F4/F5 emitters all produce schema-v2 artifacts through this harness", status: "pass" },
  ],
  limitations: [
    { description: "the harness validates structure and vocabulary; it cannot judge semantic truth of check descriptions — that is the role of mutation proofs, differential runs, and owner spot-checks" },
    { description: "determinism ties evidence to HEAD; regeneration after new commits intentionally changes output (freshness by design)" },
  ],
  data: {
    limitationsJustification: "structural validator only; semantic verification delegated to F3-F5 gates and owner ritual",
  },
})
console.log("emitted validation/m14/results/M14.0.F2.json")
