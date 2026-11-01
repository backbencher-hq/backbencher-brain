/**
 * GRAPHQL LANE MUTANTS — lane-owned, mirroring `script/m14/json-mutants.ts`.
 *
 * The lane's three emitted relationship classes are `imports` (the `#import` convention),
 * `implements`/`extends` (the two heritage clauses the analyzer keeps distinct) and
 * `contains`/`exports` (declaration structure). The fixtures pin all of them, so each mutant
 * below is caught by a specific lane row rather than by a count that happens to move.
 *
 * The defect classes are the three mistakes this analyzer has actually made or can make:
 * dropping the `#import` convention (it was added late and is easy to lose in a refactor),
 * collapsing `implements` into `extends` (they are separate clauses in SDL and the fleet's
 * vocabulary keeps them separate), and dropping `exports` (SDL definitions are exported by
 * construction; a refactor that forgets the export list publishes no edges).
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

export const GRAPHQL_MUTANTS: Mutant[] = [
  {
    id: "graphql/drop-imports",
    language: "graphql",
    defectClass: "silent-drop",
    description:
      "Drops every `imports` edge — the `#import \"...\"` comment convention the lane publishes. Caught by the fixtures that pin imports rows (declaration-lines-and-extensions and the federation/import fixture).",
    caughtBy: "validation/m14/fixtures/graphql",
    transform: dropRel("imports"),
  },
  {
    id: "graphql/implements-labelled-extends",
    language: "graphql",
    defectClass: "mislabelled-edge",
    description:
      "Relabels `implements` as `extends`, collapsing the two SDL heritage clauses into one. The lane's fixtures pin them separately, so a collapse shows up as both a missing and a fabricated edge.",
    caughtBy: "validation/m14/fixtures/graphql",
    transform: relabel("implements", "extends"),
  },
  {
    id: "graphql/drop-exports",
    language: "graphql",
    defectClass: "silent-drop",
    description:
      "Drops every `exports` edge — SDL type definitions are exported by declaration, and a refactor that forgets the export list publishes none. Caught by the exports rows in the fixture suite.",
    caughtBy: "validation/m14/fixtures/graphql",
    transform: dropRel("exports"),
  },
]
