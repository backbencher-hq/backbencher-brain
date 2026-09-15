// script/m61/extinction_core.ts — M61.V6 (issue #847): the extinction pack's
// pure decision core (drafted off-repo, moved in after the lane ladder).
//
// A verifier bug fixed locally is a bug that can recur. This module decides,
// for ONE historical verifier-bug class, whether the class is EXTINCT:
//   * the class is declared, with the incident it memorializes;
//   * its permanent mutant is PRESENT in the named gate;
//   * the mutant is TRACEABLE — a comment within NEAR_LINES names the incident;
//   * the gate that RUNS the mutant is in an automated tier (a mutant nobody
//     runs is not extinction);
//   * the owner's sealed record shows the mutant actually ran and caught.
//
// Pure by construction: every fact arrives as an argument, so the verifier's
// source-level mutations of THIS file are the can-fail proof.

export type ClassSpec = {
  id: string
  title: string
  incident: string
  incidentTag: string
  owner: string
  rule: string
  mutant: string
  mutantLabel: string
  memorial: string
  publicProbe: string
}

export type ClassFacts = {
  /** every path the class declares exists on disk */
  filesExist: boolean
  /** the mutant label literal appears in the memorial gate's source */
  labelPresent: boolean
  /** a comment naming the incident sits within NEAR_LINES of that literal */
  incidentNearLabel: boolean
  /** the gate that RUNS the mutant is in an automated tier */
  mutantGateTiered: boolean
  /** the mutant gate's own sealed record exists */
  recordSealed: boolean
  /** can-fail proofs that record declares (mutants + negatives) */
  recordProofs: number
  /** the record declares at least one failed check */
  recordFailed: boolean
}

export const REQUIRED_FIELDS: Array<keyof ClassSpec> = [
  "id",
  "title",
  "incident",
  "incidentTag",
  "owner",
  "rule",
  "mutant",
  "mutantLabel",
  "memorial",
  "publicProbe",
]

/** How close a comment must sit to the mutant to count as its memorial. */
export const NEAR_LINES = 8

/**
 * The classes this pack must carry. D-6 names five (the issue's deliverables);
 * the sixth is the class this very milestone found in the lane — a gate wired
 * into no tier rots silently and then breaks an unrelated closure. Removing a
 * class from the manifest is a finding, not a simplification.
 */
export const REQUIRED_IDS = [
  "tdz-dynamic-import",
  "silent-capability-cap",
  "self-staling-byte-gated-doc",
  "concurrent-clobber",
  "unsealed-evidence-trust",
  "on-demand-gate-rot",
]

/** Structural validation of one manifest entry. [] when valid. */
export function validateClass(spec: Partial<ClassSpec>, seenIds: Set<string>): string[] {
  const out: string[] = []
  const id = typeof spec.id === "string" ? spec.id : "<missing id>"
  for (const f of REQUIRED_FIELDS) {
    const v = spec[f]
    if (typeof v !== "string" || v.trim() === "") out.push(`${id}: required field "${f}" is missing or empty`)
  }
  if (typeof spec.id === "string") {
    if (seenIds.has(spec.id)) out.push(`${id}: duplicate class id`)
    seenIds.add(spec.id)
  }
  // Lane discipline: script/* and validation/* only.
  for (const f of ["owner", "mutant", "memorial"] as const) {
    const v = spec[f]
    if (typeof v === "string" && !v.startsWith("script/")) out.push(`${id}: ${f} "${v}" is outside the lane (script/* only)`)
  }
  if (typeof spec.incident !== "string" || spec.incident.length < 40) out.push(`${id}: "incident" must name the incident it memorializes`)
  return out
}

/** The extinction verdict for one class: [] means the class is extinct. */
export function auditClass(spec: ClassSpec, facts: ClassFacts): string[] {
  const out: string[] = []
  if (!facts.filesExist) out.push(`${spec.id}: a declared path does not exist`)
  if (!facts.labelPresent) out.push(`${spec.id}: mutant "${spec.mutantLabel}" is not present in ${spec.memorial} — the class can recur`)
  if (!facts.incidentNearLabel) out.push(`${spec.id}: no comment within ${NEAR_LINES} lines of the mutant names the incident ("${spec.incidentTag}") — an untraceable mutant is folklore`)
  if (!facts.mutantGateTiered) out.push(`${spec.id}: ${spec.mutant} is wired into no automated tier — a mutant nobody runs cannot make a class extinct`)
  if (!facts.recordSealed) out.push(`${spec.id}: no sealed evidence record is owned by ${spec.mutant} — the mutant has no proof of having run`)
  if (facts.recordProofs < 1) out.push(`${spec.id}: ${spec.mutant}'s record declares no can-fail proof — the mutant is not counted as evidence`)
  if (facts.recordFailed) out.push(`${spec.id}: ${spec.mutant}'s record declares failed checks — the mutant gate is not green`)
  return out
}
