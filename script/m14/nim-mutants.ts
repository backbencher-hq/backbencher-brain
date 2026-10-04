/**
 * NIM MUTANTS — the defects this lane's fixtures must be able to catch.
 *
 * ## Why this is a separate module
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8: report,
 * do not edit), and it already carries this pattern for the f# lane via
 * `script/m14/fsharp-mutants.ts`: the lane owns its defect records, the shared
 * harness owns the loop that runs them. The wiring this file needs is one line
 * in `mutate-analyzer.ts` — `import { NIM_MUTANTS } from "./nim-mutants"` beside
 * the FSHARP_MUTANTS import, and `...NIM_MUTANTS,` in the `MUTANTS` array — and
 * it is reported in the lane handover rather than applied.
 *
 * `validation/m14/fixtures/nim/verify-mutants.ts` runs exactly these transforms
 * through the shared `runLang`, with the harness's own caught/survived rule
 * (`mutated.fail > base.fail || mutProblems > baseProblems`), so the numbers
 * below are the harness's numbers and not a second opinion about them.
 *
 * ## What a mutant is
 *
 * A transform over the analyzer's RESULT that reproduces a defect this lane
 * actually had or could plausibly acquire. Output transforms, not source
 * surgery: equivalent at the suite level (the harness's own declared
 * limitation) and not sensitive to formatting.
 *
 * ## The two waves here
 *
 *   M60 ontology wave — the two relationship types the lane implemented this
 *   round (`implements` from a concept refinement, `exports` from a re-export
 *   statement). Each has a MISLABEL mutant and a PAYLOAD-LOSS mutant, because
 *   a fixture that pins only "the edge exists" catches neither a wrong type
 *   label nor a dropped clause.
 *
 *   regression wave — the two defects the round actually carried on disk: the
 *   `refines` field read as a wrapper instead of as the list itself (which read
 *   ZERO occurrences on a construct the corpus and fixtures both spell
 *   correctly), and the `except` clause read as publication instead of
 *   exclusion (which stated the inverse of the construct).
 */

export interface NimMutant {
  retired?: boolean
  retiredOn?: string
  retirementReason?: string
  id: string
  language: string
  defectClass: string
  description: string
  source?: string
  transform: (r: any, source?: string) => any
}

export const NIM_MUTANTS: NimMutant[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // M60 ontology wave — `implements` (concept refinement)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "nim/concept-refinement-labelled-extends",
    language: "nim",
    defectClass: "wrong-relationship-type",
    description:
      "`type A = concept x of B` is filed as `extends` instead of `implements`. " +
      "This is the neighbouring-type confusion question 4 asks about, and it is the " +
      "exact mistake of routing the `of` clause through the nominal-inheritance pass: " +
      "a concept is satisfied STRUCTURALLY and implicitly, there is no vtable and no " +
      "nominal subtype relation in a refinement, so `extends` asserts a storage " +
      "containment that does not exist. " +
      "Caught by nim/concept's expectRelationships {implements, Addable -> Number} " +
      "and, in the other direction, by its forbidRelationships {extends, target: Number}.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "implements" ? { ...x, type: "extends", metadata: { ...(x.metadata ?? {}), relationshipType: "nim_object_inheritance" } } : x,
      ),
    }),
  },
  {
    id: "nim/concept-refinement-lost",
    language: "nim",
    defectClass: "relationship-payload-loss",
    description:
      "The `implements` family stops being emitted while the symbols stay `interface`. " +
      "A concept that refines another contract declares that it INCLUDES that contract's " +
      "operations, and nothing else in the payload records it — the visibility marker " +
      "does not, the declared-type `references` edge does not. Dropping the family " +
      "leaves the language's only interface relation invisible while every other " +
      "signal still looks healthy. " +
      "Caught by nim/concept's four expectRelationships rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements"),
    }),
  },
  {
    id: "nim/concept-refinement-drops-the-list-tail",
    language: "nim",
    defectClass: "relationship-payload-loss",
    description:
      "`of Number, Container` yields only its FIRST entry. `refinement_list` is " +
      "`sep1($.type_expression, \",\")`, so a concept may name several contracts, and a " +
      "reader that stops at one turns a refinement of two contracts into a claim about " +
      "one — silently, and only for the multi-contract spelling. " +
      "Caught by nim/concept's {implements, Both -> Container}, which has no sibling " +
      "row that could satisfy it.",
    transform: (r: any) => {
      const perSource = new Map<string, number>()
      return {
        ...r,
        relationships: (r.relationships ?? []).filter((x: any) => {
          if (x.type !== "implements") return true
          const n = (perSource.get(String(x.source)) ?? 0) + 1
          perSource.set(String(x.source), n)
          return n === 1
        }),
      }
    },
  },
  {
    id: "nim/concept-satisfaction-invented",
    language: "nim",
    defectClass: "fabricated-relationship",
    description:
      "Concept SATISFACTION is inferred and published: every ordinary object type in " +
      "the file gets an `implements` edge to every concept it structurally matches. " +
      "Nim has no syntax for satisfaction — it is the compiler's structural match " +
      "against the concept body at instantiation time — so every one of these edges " +
      "is fabricated, at confidence 0.5 where the analyzer knows it is guessing. " +
      "A fabricated edge is counted `unexplained` by the oracle and poisons " +
      "bb_graph/bb_impact, where a fake implementer becomes wrong refactoring advice. " +
      "Caught by nim/concept's forbidRelationships {implements, from: Meters}: the " +
      "fixture declares one plain object type next to eight concepts, so an inferred " +
      "satisfaction edge has to name it and cannot.",
    transform: (r: any) => {
      const concepts = (r.symbols ?? []).filter((s: any) => s.kind === "interface").map((s: any) => String(s.name))
      const objects = (r.symbols ?? []).filter((s: any) => s.kind === "struct" || s.kind === "class")
      const invented = objects.flatMap((o: any) =>
        concepts.map((c: string) => ({
          source: String(o.name),
          target: c,
          type: "implements",
          confidence: 0.5,
          line_number: o.range?.startLine ?? 1,
          metadata: { relationshipType: "nim_concept_satisfaction", nimInferred: true },
        })),
      )
      return { ...r, relationships: [...(r.relationships ?? []), ...invented] }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // M60 ontology wave — `exports` (re-export statement)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "nim/export-except-published-as-exported",
    language: "nim",
    defectClass: "relationship-label-inversion",
    description:
      "`export M except a, b` publishes `a` and `b` as exported. `except` is the author " +
      "saying those names do NOT leave the module, so this states the inverse of the " +
      "construct, and it is the defect the pre-round reader actually had: it walked every " +
      "identifier under `export_statement`. The form is real — nim/compiler/nifstreams.nim " +
      "withholds nine names this way, and 9 of 155 corpus `export_statement` nodes carry " +
      "an `except_clause`. " +
      "Caught by nim/reexport's forbidRelationships {exports, target: helper} and " +
      "{exports, target: another}, plus forbidExports on both names.",
    transform: (r: any) => ({
      ...r,
      exports: [
        ...(r.exports ?? []),
        ...(r.relationships ?? [])
          .filter((x: any) => x.type === "exports" && Array.isArray(x.metadata?.nimExportExcluded))
          .flatMap((x: any) => (x.metadata.nimExportExcluded as string[]).map((name) => ({ name, metadata: { nimExport: true, nimReExport: true } }))),
      ],
      relationships: (r.relationships ?? []).flatMap((x: any) =>
        x.type === "exports" && Array.isArray(x.metadata?.nimExportExcluded)
          ? (x.metadata.nimExportExcluded as string[]).map((name) => ({ ...x, target: name }))
          : [x],
      ),
    }),
  },
  {
    id: "nim/export-qualified-published-by-written-form",
    language: "nim",
    defectClass: "endpoint-spelling",
    description:
      "`export common_parser.Parser` publishes the endpoint as the WRITTEN form " +
      "`common_parser.Parser` instead of the leaf `Parser`. The store resolves an " +
      "endpoint by matching it against a symbol name, so the written form resolves at " +
      "neither end while the lane's own symbols are all spelled `Parser` — the edge " +
      "counts as resolved-looking and is not. " +
      "Caught by nim/reexport's expectRelationships {exports, target: Parser} and its " +
      "forbidExports {name: Parser} would not fire, but the relationship row cannot " +
      "match a dotted endpoint.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports" && typeof x.metadata?.nimQualifiedName === "string"
          ? { ...x, target: x.metadata.nimQualifiedName }
          : x,
      ),
    }),
  },
  {
    id: "nim/foreign-reexport-listed-as-local-provider",
    language: "nim",
    defectClass: "provenance-inversion",
    description:
      "Every `export` operand is put back into the importable-unit list, including the " +
      "ones this file does not declare. That list is the index's provider set: giving a " +
      "name two providers is how an importer's binding gets attributed to the wrong " +
      "file. The re-export belongs on the RELATIONSHIP, which says 'this module hands " +
      "this name onward' and is true whoever declares it. " +
      "Caught by nim/reexport's forbidExports {name: foo}, {name: Parser}, " +
      "{name: strutils}, {name: std/os}.",
    transform: (r: any) => {
      const local = new Set<string>((r.symbols ?? []).map((s: any) => String(s.name)))
      const operands = (r.relationships ?? [])
        .filter((x: any) => x.type === "exports")
        .map((x: any) => ({ name: String(x.target), metadata: { nimExport: true, nimReExport: true } }))
      return {
        ...r,
        exports: [...(r.exports ?? []), ...operands.filter((o: any) => !local.has(o.name))],
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Regression wave — defects this round actually carried on disk
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "nim/concept-refines-field-read-as-wrapper",
    language: "nim",
    defectClass: "grammar-fact-inversion",
    description:
      "The regression that shipped in the first version of the `implements` reader: " +
      "`childForFieldName(\"refines\")` returns the `refinement_list` node ITSELF, and " +
      "the reader looked for a CHILD of that type instead. Every file therefore " +
      "produced zero refinements while the concept was still published as `interface`, " +
      "so every other signal looked healthy and the whole `implements` family read " +
      "zero occurrences on a construct the corpus and the fixtures both spell " +
      "correctly. This mutant reproduces it exactly — the edges go, the symbols stay. " +
      "Caught by nim/concept's four expectRelationships rows, and it is the reason the " +
      "field-shape fact now has one function (`refinementListOf`) read by both " +
      "consumers rather than one per consumer.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements"),
      symbols: (r.symbols ?? []).map((s: any) => {
        const md = s.metadata
        if (!md || !Array.isArray(md.nimRefines)) return s
        const out: any = { ...s, metadata: { ...md } }
        delete out.metadata.nimRefines
        return out
      }),
    }),
  },
  {
    id: "nim/star-marker-promoted-to-an-exports-edge",
    language: "nim",
    defectClass: "payload-duplication",
    description:
      "The `*` visibility marker is published a second time as an `exports` EDGE. " +
      "Visibility is already carried — `visibility: \"public\"` plus " +
      "`metadata.exported`, persisted into brain_symbol.visibility and read by gravity " +
      "(28,900 exported_symbol nodes in 1,335 corpus files) — so the extra graph " +
      "restates a fact at ~17.6% payload growth (163,960 edges measured before) for no " +
      "query a reader could not already ask. " +
      "Caught by nim/reexport's forbidRelationships {exports, target: visible}: the " +
      "fixture declares `proc visible*()` and never exports it by statement.",
    transform: (r: any) => {
      const extra = (r.symbols ?? [])
        .filter((s: any) => s.visibility === "public" || s.metadata?.exported)
        .map((s: any) => ({
          source: "(global)",
          target: String(s.name),
          type: "exports",
          confidence: 1,
          line_number: s.range?.startLine ?? 1,
          metadata: { relationshipType: "nim_star_visibility", evidenceClass: "structural" },
        }))
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "nim/nested-routine-symbol-dropped",
    language: "nim",
    defectClass: "unpublished-declaration",
    description:
      "A NAMED nested routine stops being published, which is the exact defect this lane " +
      "fixed: 653 `calls` edges over 4,555 corpus files named a declaration the parse tree " +
      "carried and the run published nowhere, because a `calls` EDGE was emitted while its " +
      "far end had no symbol. The analyzer is a per-file walker with no second pass, so the " +
      "regression is invisible in any edge count — only the symbol is missing. " +
      "Caught by nim/nested's expectSymbols {recentlyOpenedAdd, scope: closeTab} and by its " +
      "expectRelationships {contains, closeTab -> recentlyOpenedAdd}.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.scope === undefined || s.scope === ""),
    }),
  },
  {
    id: "nim/nested-routine-scope-lost",
    language: "nim",
    defectClass: "scope-misattribution",
    description:
      "The nested routine keeps its symbol but loses `scope`, so it reads as a module " +
      "procedure. The lua lane measured why this is a real defect and not cosmetics: `scope` " +
      "is what a consumer reads to decide where a symbol belongs, and a closure declared " +
      "inside `closeTab` does not belong to the file's module scope. It also breaks the " +
      "`qualifiedName` the worker derives from `scope`, so `closeTab.recentlyOpenedAdd` " +
      "stops resolving for the incoming walk. " +
      "Caught by nim/nested's expectSymbols scope assertion.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.scope ? { ...s, scope: undefined } : s)),
    }),
  },
  {
    id: "nim/doc-example-values-published",
    language: "nim",
    defectClass: "phantom-symbol",
    description:
      "A `runnableExamples` block's VALUE declarations are published as module symbols. " +
      "`var base: Base = Sub1()` is a local of the example unit exactly as `var` in a routine " +
      "body is a local of that routine, so this is `LocalsAreNotSymbols` violated in the " +
      "opposite direction from the nested-routine fix — the two must be fixed together or the " +
      "first fix reintroduces the second defect. " +
      "Caught by nim/nested's forbidSymbols {exampleOnlyLocal}, a name the fixture " +
      "declares nowhere else so the forbid cannot be satisfied by a coincidence.",
    transform: (r: any) => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        {
          name: "exampleOnlyLocal",
          kind: "variable",
          visibility: "private",
          range: { startLine: 56, startColumn: 5, endLine: 56, endColumn: 30, startIndex: 0, endIndex: 0 },
        },
      ],
    }),
  },
  {
    id: "nim/runnable-examples-pragma-published-as-a-call",
    language: "nim",
    defectClass: "fabricated-edge",
    description:
      "The `runnableExamples:` doc pragma is published as a `calls` edge. This is the " +
      "fabrication rule's cheapest available instance: the grammar parses the whole example " +
      "as the call's `argument_list`, so the call branch fires on a keyword, and the edge " +
      "lands on an identifier no Nim program can call — a name the graph can never resolve. " +
      "Measured before the fix: 24 such frames in nim/lib/system.nim alone. " +
      "Caught by nim/nested's forbidRelationships {calls, describe -> runnableExamples}.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          source: "describe",
          target: "runnableExamples",
          type: "calls",
          confidence: 0.85,
          line_number: 1,
          metadata: { relationshipType: "nim_call", evidenceClass: "usage_contextual" },
        },
      ],
    }),
  },
  {
    id: "nim/method-qualified-name-dropped",
    language: "nim",
    defectClass: "unresolvable-endpoint",
    description:
      "A method stops publishing `qualifiedName`, so every `overrides` endpoint — which is " +
      "receiver-qualified (`Rect.describe`) because the bare name cannot address either end — " +
      "fails to resolve for the incoming walk. Measured with `script/m14/incoming-check.ts` on " +
      "nim/lib/pure (105 files, 6,638 symbols) before the fix: 14 of 14 `overrides` edges " +
      "reported as UNRESOLVED targets, every one a correct edge. The worker's `qualifiedName` " +
      "fallback cannot recover it, because a method's owner is `ownerName`, not `scope`. " +
      "Caught by nim/contract's expectSymbols {describe, meta.fqn: Shape.describe}. The pin is " +
      "on `meta.fqn` rather than on `qualifiedName` because run-fixtures.ts cannot assert the " +
      "latter — it is missing from CONSTRAINT_KEY_ALLOWLIST, so a row carrying it is reported as " +
      "an INERT assertion. `pool-worker.ts:870` reads `s.qualifiedName || s.metadata?.fqn`, so " +
      "both carry the same fact and the metadata one is the assertable channel.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.kind === "method" && s.ownerName
          ? { ...s, qualifiedName: undefined, metadata: { ...(s.metadata ?? {}), fqn: undefined } }
          : s,
      ),
    }),
  },
]
