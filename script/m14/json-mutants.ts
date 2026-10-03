/**
 * JSON LANE MUTANTS — lane-owned, mirroring `script/m14/fsharp-mutants.ts`.
 *
 * ## Why a separate file
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery that several lanes edit at once,
 * and the fsharp lane's mutants were silently unregistered by a merge: the definitions
 * went with it, so the F4 gate could not fail for that lane while still reading as a
 * suite with no fsharp reds. A mutant that is not registered is indistinguishable from
 * a defect class with no mutant, which is the exact shape the M14 contract's F4 rule
 * exists to prevent. Keeping these definitions here means registering them costs two
 * lines in the shared registry rather than an edit inside it.
 *
 * ## Wiring (a report-to-supervisor item, deliberately NOT done here)
 *
 * In `script/m14/mutate-analyzer.ts`, add the import beside the fsharp one and spread
 * the list at the head of `MUTANTS`:
 *
 *   import { JSON_MUTANTS } from "./json-mutants"
 *   ...
 *   export const MUTANTS: Mutant[] = [
 *     ...FSHARP_MUTANTS,
 *     ...JSON_MUTANTS,
 *
 * Until that lands these mutants are not RUN by `bun run script/m14/mutate-analyzer.ts`,
 * and `validation/m14/fixtures/json/mutants.ts` is what proves they are caught in the
 * meantime — it imports the real `runLang` and applies these same transforms.
 *
 * ## The defect classes these cover
 *
 * `npm-run-callee-any-token` and `npm-run-substring-runner` are the two mistakes the
 * new `calls` pass can make that a positive-only fixture would not catch: reading the
 * runner out of a token with a substring test (`npx` contains `npm`, and a PATH named
 * `npm` is not a runner), and accepting a target that is not a key of the same
 * `scripts` object. The manifest fixture's `forbidRelationships` carry both shapes.
 */
import type { Mutant } from "./mutate-analyzer"

const relType = (r: any) => r?.type ?? r?.relationshipType

/** Drops every `calls` edge — the pre-fix state of the lane, which emitted 6 of 10
 *  types and had no `calls` at all. Caught by manifest/package's three `calls` pins. */
const dropJsonCalls = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== "calls"),
})

/** Accepts a `npm run` target that is NOT a key of the same `scripts` object, so an
 *  edge names a symbol the file never declared. This is the fabricated-edge shape the
 *  ontology workstream calls the most expensive mistake available. Caught by
 *  manifest/package's `external` forbid. */
const npmRunCalleeAnyToken = (r: any) => ({
  ...r,
  relationships: [
    ...(r.relationships ?? []),
    ...(r.symbols ?? [])
      .filter((s: any) => s.ownerName === "scripts")
      .flatMap((s: any) => [{ source: s.name, target: "not-declared-here", type: "calls", confidence: 0.8, line_number: 0 }]),
  ],
})

/** Reads the runner with a substring test instead of comparing whole tokens, so `npx`
 * and `./scripts/npm` are taken for runners. Caught by manifest/package's `notarunner`
 * and `pathrunner` forbids. */
const npmRunSubstringRunner = (r: any) => ({
  ...r,
  relationships: [
    ...(r.relationships ?? []),
    { source: "notarunner", target: "compile", type: "calls", confidence: 0.8, line_number: 0 },
    { source: "pathrunner", target: "compile", type: "calls", confidence: 0.8, line_number: 0 },
  ],
})

/** Restores the unlined state: `line_number` was absent from the analyzer entirely
 *  before M60, so every json edge reached the store with a NULL site. Caught by
 *  manifest/package's `line_number`-bearing pins and the Lines fixture. */
const stripJsonEdgeLines = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => ({ ...x, line_number: 0 })),
})

/** Drops every `overrides` edge — the pre-fix state, where a duplicate key produced two
 *  `contains` rows for one name and no statement that the second replaced the first.
 *  Caught by json/DuplicateKey's `overrides` pins. */
const dropJsonOverrides = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== "overrides"),
})

/** Scopes the duplicate check to the FILE instead of the object, so the same key in two
 *  different objects reads as a redefinition. This is the permissive direction and it is
 *  the one that matters: measured over the corpus it is 120,174 occurrences across 7,679
 *  files against 21 genuine duplicates, so the mutant is worth ~5,700 false edges.
 *  Caught by json/SameKeyDifferentObjects' forbids, which exist only for this. */
const jsonOverridesUnscoped = (r: any) => {
  const byName = new Map<string, number>()
  const extra: any[] = []
  for (const x of r.relationships ?? []) {
    if (relType(x) !== "contains") continue
    const k = String(x.target ?? "")
    if (k.length === 0) continue
    const prior = byName.get(k)
    if (prior === undefined) byName.set(k, x.line_number ?? 0)
    else extra.push({ ...x, type: "overrides", metadata: { overridesLine: prior, redefinition: true } })
  }
  return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
}

/** Emits the edge but loses the PRIOR declaration's line, which is the only thing that
 *  distinguishes the two same-named declarations. Caught by DuplicateKey's
 *  `meta.overridesLine` pin, which a label-only assertion could not catch. */
const jsonOverridesLineLost = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) =>
    relType(x) === "overrides" ? { ...x, metadata: { ...(x.metadata ?? {}), overridesLine: 0 } } : x,
  ),
})

export const JSON_MUTANTS: Mutant[] = [
  {
    id: "json/calls-dropped",
    language: "json",
    defectClass: "missing-relationship-type",
    description:
      "M14 ontology regression: an npm script running a SIBLING script stops emitting `calls`, restoring the omission the corpus probe measured (12 sibling invocations across the first 300 admitted files, apollo-server/package.json carrying 7 with both endpoints resolving). Caught by json/manifest/package's three `calls` pins.",
    transform: dropJsonCalls,
  },
  {
    id: "json/calls-callee-any-token",
    language: "json",
    defectClass: "fabricated-edge",
    description:
      "M14 ontology regression: a `npm run` target is accepted without checking it is a key of the SAME `scripts` object, so the edge names a symbol the file never declared — the fabricated-edge class the ontology workstream names as the most expensive mistake available. Caught by json/manifest/package's `external` forbid.",
    transform: npmRunCalleeAnyToken,
  },
  {
    id: "json/calls-runner-substring",
    language: "json",
    defectClass: "over-matching-predicate",
    description:
      "M14 ontology regression: the runner token is matched by substring instead of compared whole, so `npx` (which contains `npm`) and a PATH named `npm` are taken for package runners. Caught by json/manifest/package's `notarunner` and `pathrunner` forbids.",
    transform: npmRunSubstringRunner,
  },
  {
    id: "json/overrides-dropped",
    language: "json",
    defectClass: "missing-relationship-type",
    description:
      "M14 ontology regression: a key declared TWICE in one object stops emitting `overrides`, so the second declaration reads as an ordinary member and the replacement is unstated. 21 named duplicate keys across 11 of 11,713 admitted files. Caught by json/DuplicateKey.",
    transform: dropJsonOverrides,
  },
  {
    id: "json/overrides-unscoped-to-file",
    language: "json",
    defectClass: "fabricated-edge",
    description:
      "M14 ontology regression: the duplicate check is scoped to the FILE instead of the OBJECT, so the same key in two different objects reads as a redefinition. A JSON key is unique only within its object, and this is the permissive direction: 120,174 occurrences across 7,679 files against 21 genuine duplicates, so the mutant is worth about 5,700 false edges. Caught by json/SameKeyDifferentObjects, whose forbids exist for exactly this mutant.",
    transform: jsonOverridesUnscoped,
  },
  {
    id: "json/overrides-prior-line-lost",
    language: "json",
    defectClass: "dishonest-payload",
    description:
      "M14 ontology regression: the `overrides` edge is emitted but `overridesLine` is zeroed, and since both declarations share a name AND a qualified path the prior line is the only thing that distinguishes them — the edge then asserts a replacement without saying what was replaced. Caught by json/DuplicateKey's `meta.overridesLine` pin.",
    transform: jsonOverridesLineLost,
  },
  {
    id: "json/edge-lines-dropped",
    language: "json",
    defectClass: "dishonest-payload",
    description:
      "M14 ontology regression: every edge loses its site line, restoring the measured pre-M60 state in which `line_number` occurred ZERO times in the analyzer and every json edge in the index was stored with a NULL line while symbols carried `range` throughout.",
    transform: stripJsonEdgeLines,
  },
]