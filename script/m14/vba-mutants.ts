import type { Mutant } from "./mutate-analyzer"

const dropRelationships = (types: Set<string>) => (result: any) => ({
  ...result,
  relationships: (result.relationships ?? []).filter((relationship: any) => !types.has(String(relationship.type))),
})

const dropMetadata = (key: string) => (result: any) => ({
  ...result,
  relationships: (result.relationships ?? []).map((relationship: any) => {
    if (!(key in (relationship.metadata ?? {}))) return relationship
    const metadata = { ...(relationship.metadata ?? {}) }
    delete metadata[key]
    return { ...relationship, metadata }
  }),
})

export const VBA_MUTANTS: Mutant[] = [
  {
    id: "vba/drop-calls",
    language: "vba",
    defectClass: "missing-relationship",
    description: "Drops VBA call edges, reverting procedure-call extraction.",
    caughtBy: "vba/representative",
    transform: dropRelationships(new Set(["calls"])),
  },
  {
    id: "vba/drop-instantiates",
    language: "vba",
    defectClass: "missing-relationship",
    description: "Drops VBA construction edges, reverting New-expression extraction.",
    caughtBy: "vba/representative",
    transform: dropRelationships(new Set(["instantiates"])),
  },
  {
    id: "vba/drop-contains",
    language: "vba",
    defectClass: "missing-relationship",
    description: "Drops declaration containment edges, disconnecting nested VBA symbols.",
    caughtBy: "vba/representative",
    transform: dropRelationships(new Set(["contains"])),
  },
  {
    id: "vba/drop-exports",
    language: "vba",
    defectClass: "missing-relationship",
    description: "Drops public module export edges.",
    caughtBy: "vba/representative",
    transform: dropRelationships(new Set(["exports"])),
  },
  {
    id: "vba/drop-decorates",
    language: "vba",
    defectClass: "missing-relationship",
    description: "Drops module attribute decoration edges.",
    caughtBy: "vba/representative",
    transform: dropRelationships(new Set(["decorates"])),
  },
  {
    id: "vba/drop-with-receiver-evidence",
    language: "vba",
    defectClass: "missing-evidence",
    description: "Drops the construct metadata identifying a With receiver.",
    caughtBy: "vba/control-flow",
    transform: dropMetadata("construct"),
  },
  {
    id: "vba/drop-implicit-member-evidence",
    language: "vba",
    defectClass: "missing-evidence",
    description: "Drops the implicit-member marker from calls such as .Run.",
    caughtBy: "vba/control-flow",
    transform: dropMetadata("implicitMember"),
  },
]
