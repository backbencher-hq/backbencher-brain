/**
 * LUA LANE MUTANTS — lane-owned, mirroring `script/m14/json-mutants.ts`.
 *
 * Lua's resolution lives in its callee and closure passes: `calls` comes from function calls,
 * `uses` from value reads, `references` from the names a closure captures, and `extends` from
 * the `setmetatable` decorator shape. The mutants below reintroduce the four ways that pass has
 * gone wrong: a dropped call, a `uses` read relabelled as a declaration-level reference, a
 * dropped inheritance edge, and a dropped `contains` declaration.
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

export const LUA_MUTANTS: Mutant[] = [
  {
    id: "lua/drop-calls",
    language: "lua",
    defectClass: "silent-drop",
    description:
      "Drops every `calls` edge — the pre-fix state before the callee pass existed. Caught by the callee-shape fixture's calls pins.",
    caughtBy: "validation/m14/fixtures/lua/callee-shape.expectation.json",
    transform: dropRel("calls"),
  },
  {
    id: "lua/uses-labelled-references",
    language: "lua",
    defectClass: "mislabelled-edge",
    description:
      "Relabels every `uses` read as `references`, conflating a value use with a declaration reference. The lane's fixtures pin both classes, so the swap shows as a drop and a fabrication at once.",
    caughtBy: "validation/m14/fixtures/lua",
    transform: relabel("uses", "references"),
  },
  {
    id: "lua/drop-extends",
    language: "lua",
    defectClass: "silent-drop",
    description:
      "Drops `extends` — the setmetatable-based inheritance edge. Caught by the class/instance fixture that pins the extends row.",
    caughtBy: "validation/m14/fixtures/lua",
    transform: dropRel("extends"),
  },
  {
    id: "lua/drop-contains",
    language: "lua",
    defectClass: "silent-drop",
    description:
      "Drops `contains` — the declaration tree the whole graph hangs from. Caught by every fixture that pins a contains row.",
    caughtBy: "validation/m14/fixtures/lua",
    transform: dropRel("contains"),
  },
]
