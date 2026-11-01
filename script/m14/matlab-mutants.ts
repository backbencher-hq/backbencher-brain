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

export const MATLAB_MUTANTS: Mutant[] = [
  {
    id: "matlab/drop-calls",
    language: "matlab",
    defectClass: "missing-relationship",
    description: "Drops MATLAB function_call relationships.",
    caughtBy: "matlab/functions",
    transform: dropRelationships(new Set(["calls"])),
  },
  {
    id: "matlab/drop-contains",
    language: "matlab",
    defectClass: "missing-relationship",
    description: "Drops nested declaration containment.",
    caughtBy: "matlab/class-and-methods",
    transform: dropRelationships(new Set(["contains"])),
  },
  {
    id: "matlab/drop-extends",
    language: "matlab",
    defectClass: "missing-relationship",
    description: "Drops class superclass relationships.",
    caughtBy: "matlab/class-and-methods",
    transform: dropRelationships(new Set(["extends"])),
  },
  {
    id: "matlab/drop-field-evidence",
    language: "matlab",
    defectClass: "missing-evidence",
    description: "Drops field receiver/member construct metadata.",
    caughtBy: "matlab/class-and-methods",
    transform: dropMetadata("construct"),
  },
]
