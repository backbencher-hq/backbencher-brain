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
 * `calls` pass can make that a positive-only fixture would not catch: reading the
 * runner out of a token with a substring test (`npx` contains `npm`, and a PATH named
 * `npm` is not a runner), and accepting a target that is not a key of the same
 * `scripts` object. The manifest fixture's `forbidRelationships` carry both shapes.
 *
 * The pass-2 group covers the inheritance emitter: `implements` disappearing, an
 * inheritance edge to an undeclared target, a member descriptor accepted as a type
 * declaration, and the `extends` source regressing to the `allOf` array.
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
    const qualified = String(x.target ?? "")
    if (qualified.length === 0) continue
    // The defect class is "the duplicate check is scoped to the FILE, not the OBJECT", and a
    // JSON key is unique only WITHIN its object. So the KEY is compared across owners, which
    // after the `contains` endpoint change is the LEAF segment of the qualified target rather
    // than the whole path.
    //
    // Keying on the whole path made this mutant VACUOUS rather than caught: after
    // `SameKeyDifferentObjects.list[0].tag` and `…list[1].tag` became distinct endpoints, the
    // permissive version found no collisions and emitted nothing, and the run reported
    // `SURVIVED json/overrides-unscoped-to-file (0 -> 0 failures)`. A mutant that stops
    // testing anything is worse than no mutant, because it still reads as a passing check.
    const dot = qualified.lastIndexOf(".")
    const leaf = dot >= 0 ? qualified.slice(dot + 1) : qualified
    const prior = byName.get(leaf)
    if (prior === undefined) byName.set(leaf, x.line_number ?? 0)
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

/**
 * Pass-2 mutants. Four defects the pass-1 suite could not have caught, because the code they
 * break did not exist: the `implements` emitter, the `extends` source, and the two
 * document-level preconditions that keep the inheritance emitter from firing everywhere.
 */

/** Drops every `implements` edge — restoring the state this lane shipped, where `implements`
 *  was RULED and the corpus was never asked. Caught by json/Inherit.lsp's four pins. */
const dropJsonImplements = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== "implements"),
})

/**
 * Emits an inheritance edge whose target the document never declares — the fabricated-edge
 * class, and the one the ontology workstream names as the most expensive mistake available.
 * Measured on the corpus, 16 real statements take this shape (duckdb naming a superclass
 * declared in a sibling file). Caught by json/Inherit.lsp's `NotDeclaredAnywhere` /
 * `AlsoNotDeclared` forbids and json/Inherit.duckdb's `ParseInfo` forbid.
 */
const jsonInheritanceAnyTarget = (r: any) => ({
  ...r,
  relationships: [
    ...(r.relationships ?? []),
    { source: "Inherit.lsp.structures[6]", target: "Inherit.lsp.structures[6].extends[0]", type: "extends", confidence: 1, line_number: 0 },
    { source: "Inherit.duckdb[5]", target: "Inherit.duckdb[0]", type: "extends", confidence: 1, line_number: 0 },
  ],
})

/**
 * Reads the supertype off ANY object with a `base` string, dropping the `class` declaration
 * marker. This is the permissive direction and it is the one that matters: duckdb writes
 * `{ "id": 200, "name": "info", "type": "AlterInfo*", "base": "ParseInfo" }` for a FIELD,
 * 16 corpus-wide, and a member descriptor is not a type declaration. Caught by
 * json/Inherit.duckdb's two member-descriptor forbids.
 */
const jsonInheritanceUnmarkedDeclaration = (r: any) => ({
  ...r,
  relationships: [
    ...(r.relationships ?? []),
    { source: "Inherit.duckdb[4].members[0]", target: "Inherit.duckdb[0]", type: "extends", confidence: 1, line_number: 0 },
    { source: "Inherit.duckdb[4].members[1]", target: "Inherit.duckdb[0]", type: "extends", confidence: 1, line_number: 0 },
  ],
})

/**
 * Sources an `extends` edge from the `allOf` ARRAY again instead of the schema object that
 * composes. Caught by json/AllOf's two `extends` pins plus its two forbids. The array is a
 * keyword shared by every schema in the file, so this is what a name-resolving consumer
 * binds to an arbitrary schema.
 */
const jsonExtendsSourceIsArray = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) =>
    relType(x) === "extends" && x.metadata?.composition === "allOf"
      ? { ...x, source: String(x.metadata?.compositionSite ?? x.source) }
      : x,
  ),
})

  /**
   * Pass-3 mutants — the two endpoint-identity defects the incoming check found.
   *
   * `contains` was the last type in this lane still emitting BARE names. Measured on a
   * 202-file / 99-repo sample: 32,660 of 66,032 `contains` edges (49.4%) named a target
   * matching more than one published symbol, and the shared resolver
   * (`src/ast/parallel-indexer.ts` strategy 2) declines a non-unique bare name, so those
   * edges bound to no declaration. Both mutants below revert one of the two halves of the
   * fix, and both must be caught.
   */

  /** Reverts `contains` endpoints to `ownerName -> leaf name`. Caught by every fixture's
   *  `contains` pins, because each pin spells a qualified path on both ends. */
  const jsonContainsBareEndpoints = (r: any) => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (relType(x) !== "contains") return x
      const owner = String((x.metadata ?? {}).ownerName ?? "")
      const target = String(x.target ?? "")
      const dot = target.lastIndexOf(".")
      return { ...x, source: owner, target: dot >= 0 ? target.slice(dot + 1) : target }
    }),
  })

  /** An array item's owner is the ARRAY, so only the `[i]` comes off the target's path.
   *  This mutant strips the array's own leaf segment as well, which names the document ROOT
   *  as the owner of every array element — the exact defect the first version of the fix had,
   *  and the one 5 fixture pins caught. Caught by json/Arrays' two item pins and
   *  json/AllOf's `allOf[0]` / `allOf[1]` pins. */
  const jsonArrayItemOwnerIsRoot = (r: any) => ({
    ...r,
    relationships: (r.relationships ?? []).map((x: any) => {
      if (relType(x) !== "contains") return x
      const source = String(x.source ?? "")
      const target = String(x.target ?? "")
      const bracket = target.lastIndexOf("[")
      if (bracket < 0) return x
      const arrayPath = target.slice(0, bracket)
      if (source !== arrayPath) return x
      const dot = arrayPath.lastIndexOf(".")
      if (dot < 0) return x
      return { ...x, source: arrayPath.slice(0, dot) }
    }),
  })

/**
 * Pass-3 mutant: an array-inside-an-array's elements are named from the array's own NAME again,
 * which is correct for every array written under a key and wrong for an array that is itself an
 * ELEMENT — the inner array's name is the outer array's name, so two different objects collide
 * and `contains` is asserted between objects that are not nested. Caught by
 * json/ArrayInArray's two forbids and its `rows[0][0]` / `rows[0][1]` pins.
 */
const jsonArrayItemNamedFromBareName = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    const q = String(s.qualifiedName ?? "")
    const m = /^(.*)\[(\d+)\]\[(\d+)\]$/.exec(q)
    if (!m) return s
    // `…rows[0][0]` becomes `…rows[0]`: the inner array's items indexed as if they were the
    // outer array's, which is the pre-fix shape.
    return { ...s, name: `${m[1]}[${m[2]}]`, qualifiedName: `${m[1]}[${m[2]}]`, ownerName: m[1] }
  }),
  relationships: (r.relationships ?? []).map((x: any) => {
    const t = String(x.target ?? "")
    const m = /^(.*)\[(\d+)\]\[(\d+)\](.*)$/.exec(t)
    if (!m) return x
    return { ...x, target: `${m[1]}[${m[2]}]${m[4]}`, source: String(x.source ?? "").replace(/\[(\d+)\]$/, "") }
  }),
})

export const JSON_MUTANTS: Mutant[] = [
  {
    id: "json/array-item-named-from-bare-array-name",
    language: "json",
    defectClass: "wrong-symbol-identity",
    description:
      "M14 ontology pass-3 regression: an array that is itself an ELEMENT names its children from its bare name again, so `rows[0]`'s two elements collide with `rows`' own element namespace and `contains` is asserted between objects that are not nested. Measured over the corpus as 183 UNEXPLAINED `contains` edges that two implementations agreed on, which is the shared-misreading case the honesty contract names. Caught by json/ArrayInArray.",
    transform: jsonArrayItemNamedFromBareName,
  },
  {
    id: "json/contains-endpoints-are-bare-names",
    language: "json",
    defectClass: "unresolvable-identity",
    description:
      "M14 ontology pass-3 regression: `contains` reverts to `ownerName -> leaf name`, the two BARE names it emitted before the incoming check. Measured on a 202-file / 99-repo sample that is 32,660 of 66,032 edges (49.4%) naming a target that matches more than one published symbol, and the shared resolver declines a non-unique bare name, so those edges bind to no declaration at all. Caught by every json fixture's `contains` pins.",
    transform: jsonContainsBareEndpoints,
  },
  {
    id: "json/array-item-owner-is-root",
    language: "json",
    defectClass: "dishonest-identity",
    description:
      "M14 ontology pass-3 regression: an array item's owner drops the array's own segment as well as its `[i]`, so `objs[0]` reads as contained by the document ROOT instead of by `objs`. This is the defect the first version of the fix had, and 5 fixture pins caught it. Caught by json/Arrays' item pins and json/AllOf's `allOf[0]`/`allOf[1]` pins.",
    transform: jsonArrayItemOwnerIsRoot,
  },
  {
    id: "json/implements-dropped",
    language: "json",
    defectClass: "missing-relationship-type",
    description:
      "M14 ontology pass-2 regression: `implements` stops being emitted, restoring the state this lane shipped — RULED on a grammar inventory, with 113 interface mix-in statements in one corpus file unread. Caught by json/Inherit.lsp's four pins.",
    transform: dropJsonImplements,
  },
  {
    id: "json/inheritance-undeclared-target",
    language: "json",
    defectClass: "fabricated-edge",
    description:
      "M14 ontology pass-2 regression: an inheritance statement resolves to a target the document never declares, so the edge names a symbol the file does not contain. Measured on the corpus, 16 real statements take exactly this shape and are correctly declined. Caught by json/Inherit.lsp's orphan forbids and json/Inherit.duckdb's `ParseInfo` forbid.",
    transform: jsonInheritanceAnyTarget,
  },
  {
    id: "json/inheritance-declaration-marker-dropped",
    language: "json",
    defectClass: "over-matching-predicate",
    description:
      "M14 ontology pass-2 regression: the supertype is read off any object carrying a `base` string, so a MEMBER DESCRIPTOR counts as a type declaration. duckdb writes `{\"id\":200,\"name\":\"info\",\"type\":\"AlterInfo*\",\"base\":\"ParseInfo\"}` for a FIELD whose C++ class derives from ParseInfo — 16 corpus-wide. Caught by json/Inherit.duckdb's member-descriptor forbids.",
    transform: jsonInheritanceUnmarkedDeclaration,
  },
  {
    id: "json/extends-source-is-allof-array",
    language: "json",
    defectClass: "mislabeled-source",
    description:
      "M14 ontology pass-2 regression: `extends` is sourced from the `allOf` array rather than the schema object that composes. Measured on a 2,343-file stride sample, that is the difference between 0% and 100% of `extends` endpoints binding by bare name. Caught by json/AllOf's two `extends` pins and its two forbids.",
    transform: jsonExtendsSourceIsArray,
  },
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