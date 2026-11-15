export type EvidenceClass =
  | "indexed"
  | "inferred"
  | "semantic_candidate"
  | "static_finding"
  | "runtime_artifact"
  | "unknown"
  | "stale"

export interface EvidenceProvenance {
  evidenceClass: EvidenceClass
  engine: string
  engineVersion: string
  projectId: string
  indexedAt?: number | null
  source: string
  limitations: string[]
  truncated: boolean
  sampled: boolean
  unknowns: string[]
}

export function makeProvenance(input: Omit<EvidenceProvenance, "truncated" | "sampled" | "unknowns"> & Partial<Pick<EvidenceProvenance, "truncated" | "sampled" | "unknowns">>): EvidenceProvenance {
  return {
    truncated: false,
    sampled: false,
    unknowns: [],
    ...input,
  }
}

export function assertProvenance(value: unknown): asserts value is EvidenceProvenance {
  if (!value || typeof value !== "object") throw new Error("missing evidence provenance")
  const p = value as Record<string, unknown>
  if (typeof p.evidenceClass !== "string" || typeof p.engine !== "string" || typeof p.engineVersion !== "string" || typeof p.projectId !== "string" || typeof p.source !== "string") throw new Error("invalid evidence provenance identity")
  if (!Array.isArray(p.limitations) || !Array.isArray(p.unknowns) || typeof p.truncated !== "boolean" || typeof p.sampled !== "boolean") throw new Error("invalid evidence provenance bounds")
}
