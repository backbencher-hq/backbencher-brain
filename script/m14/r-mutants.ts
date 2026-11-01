/**
 * R LANE MUTANTS — lane-owned, mirroring `script/m14/json-mutants.ts`.
 *
 * R's graph comes from S3/S4/R5/R6 class construction: `contains` from the declaration tree,
 * `extends` from the inheritance list, `overrides` from a method redefinition in a subclass,
 * `calls` from a resolved call, and `references` from a bare name read. The mutants below are
 * the failure modes this lane's arbitration actually found: a dropped inheritance edge, an
 * `overrides` edge mislabelled as a plain method call, and dropped references.
 */
import type { Mutant } from "./mutate-analyzer"

const relType = (r: any) => r?.type ?? r?.relationshipType

const dropRel = (t: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== t),
})

const relabel = (from: string, to: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => (relType(x) === from ? { ...x, type: to } : x)),
})

export const R_MUTANTS: Mutant[] = [
  {
    id: "r/drop-extends",
    language: "r",
    defectClass: "silent-drop",
    description:
      "Drops every `extends` edge — the S3/S4 inheritance list is the lane's central claim, and losing it silently is the pre-fix state. Caught by the inheritance fixtures.",
    caughtBy: "validation/m14/fixtures/r",
    transform: dropRel("extends"),
  },
  {
    id: "r/overrides-labelled-calls",
    language: "r",
    defectClass: "mislabelled-edge",
    description:
      "Relabels `overrides` as `calls`: a method redefinition in a subclass becomes a method invocation. Both classes are pinned separately by the lane's fixtures, so the swap is visible in both directions.",
    caughtBy: "validation/m14/fixtures/r",
    transform: relabel("overrides", "calls"),
  },
  {
    id: "r/drop-references",
    language: "r",
    defectClass: "silent-drop",
    description:
      "Drops every `references` edge — bare name reads. Caught by the reference rows in the lane's fixture suite.",
    caughtBy: "validation/m14/fixtures/r",
    transform: dropRel("references"),
  },
]
