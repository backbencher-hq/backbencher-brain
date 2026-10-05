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

/**
 * The names a bare-`case` recovery lands on in this lane's fixtures, as a
 * TRANSFORM-side list. The analyzer decides this structurally (the `case`-row
 * adjacency test); a mutant has no parse tree, so it re-expresses the defect as
 * "re-publish the borrowed names" by naming them. Kept minimal and explicit
 * rather than clever so the mutant's own claim is checkable by reading it.
 */
const BORROWED_DISCRIMINATORS = new Set(["AddOpr", "SubOpr", "None", "Some", "float", "Circle", "Value"])
const isBorrowedDiscriminatorName = (n: string): boolean => BORROWED_DISCRIMINATORS.has(n)

/** Nim's reserved words, for the partial-fix mutant. Copied from the analyzer's
 *  `NIM_KEYWORDS` export rather than imported so the mutant fails if the two
 *  ever disagree — `verify-mutants.ts` asserts the equality. */
const NIM_RESERVED = new Set([
  "addr", "and", "as", "bind", "block", "break", "case", "concept", "const",
  "continue", "converter", "defer", "discard", "distinct", "div", "do", "elif",
  "else", "end", "enum", "except", "export", "finally", "for", "from", "func",
  "if", "import", "in", "include", "interface", "is", "isnot", "iterator", "let",
  "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
  "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
  "template", "try", "tuple", "type", "using", "var", "when", "while", "xor",
  "yield",
])

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
    id: "nim/concept-generic-target-read-as-the-type-argument",
    language: "nim",
    defectClass: "fabricated-endpoint",
    description:
      "`of Source[T]` publishes the type ARGUMENT `T` instead of the refined " +
      "contract `Source`. `refinement_list` is `sep1($.type_expression, \",\")` and a " +
      "generic instantiation is a `bracket_expression` whose FIRST named child is the " +
      "constructor while its `argument_list` holds the type arguments, so a reader that " +
      "takes the last name under the list lands on the argument. " +
      "This is 2 of the family's 47 corpus edges — nimony's " +
      "`tconceptinheritnotgeneric.nim:7 Bar = concept of Foo[T]` and " +
      "`tconceptinvocationbody.nim:39 MutableIndexable*[T] = concept of Indexable[T]` — " +
      "and it was unpinned until that repo entered the corpus on 2026-10-04. " +
      "The edge it produces is a FABRICATION, not a mislabel: `T` is a generic " +
      "parameter, it resolves at neither end, and `bb_impact` on it is wrong refactoring " +
      "advice. This lane's own oracle made exactly this mistake on its first pass and " +
      "the oracle cross-check caught it one round after the code was written. " +
      "Caught by nim/concept's forbidRelationships {implements, Wrapped -> T}, whose " +
      "sibling positive row {implements, Wrapped -> Source} has no other way to fail.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "implements" && String(x.source) === "Wrapped"
          ? { ...x, target: "T" }
          : x,
      ),
    }),
  },
  {
    id: "nim/concept-self-cycle-published",
    language: "nim",
    defectClass: "fabricated-relationship",
    description:
      "`type Cycle = concept of Cycle` publishes `Cycle implements Cycle`. A concept " +
      "refining itself is not a relationship, and this is a REAL corpus file rather than " +
      "a synthetic one: nimony/tests/nimony/concepts/tconceptcycle.nim is exactly that " +
      "one line, and upstream ships tconceptcycle.msgs reading `Error: concept " +
      "inheritance cycle detected`. " +
      "The guard already exists for this family, on both spellings, but only the `is`-form " +
      "half was pinned by a fixture — so a change that kept `r is Recursive` suppressed " +
      "while dropping the `of`-form guard would have passed the suite. " +
      "Caught by nim/concept's forbidRelationships {implements, from: Cycle}, which has no " +
      "sibling row: `Cycle` refines nothing else.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        ...(r.symbols ?? [])
          .filter((s: any) => String(s.name) === "Cycle")
          .map((s: any) => ({
            source: "Cycle",
            target: "Cycle",
            type: "implements",
            confidence: 1,
            metadata: { relationshipType: "nim_concept_refinement" },
          })),
      ],
    }),
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
  {
    id: "nim/nested-routine-ufcs-call-lost",
    language: "nim",
    defectClass: "dropped-relationship-family",
    description:
      "A parenless UFCS call of a NESTED routine stops being emitted. `s.trimmed` " +
      "invokes `trimmed(s)` with no parentheses and no call node, so the callee is a " +
      "member leaf and the analyzer has to decide it is a callable by name. Testing " +
      "only the module-scope set loses it, because nested routines are deliberately " +
      "kept out of that set. Found by script/m14/nim-truth-oracle.ts: one " +
      "unexplained `calls` edge on the 400-file sample, at " +
      "nim/lib/packages/docutils/rst.nim:3493 where `rmSpaces` is declared at :3491 " +
      "inside `proc dirImportdoc`. An analyzer that reads only its own metadata would " +
      "have agreed with itself and reported nothing. " +
      "Caught by nim/nested's forbidRelationships {uses, strip -> trimmed} — a mutant " +
      "that reclassified the call as a read is caught by the same pin, because the " +
      "shape is what is being asserted.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (e: any) => e.metadata?.relationshipType !== "nim_ufcs_member_call",
      ),
    }),
  },
  // ═══════════════════════════════════════════════════════════════════════
  // M60 bare-`case` discriminator fabrication
  //
  // Nim permits `case` with no discriminator name, and tree-sitter-nim has no
  // slot for the missing one, so error recovery attaches the FOLLOWING line —
  // the `of A, B:` branch list — to `variant_discriminator_declaration`. The
  // analyzer published the slot's first `symbol_declaration` as a `property` of
  // the owning type plus a `contains` edge to it: a field the object does not
  // have. Measured at 18 sites / 29 edges over nimony's 1,508 files.
  //
  // The shipped guard is the `case`-row adjacency test, which scored a perfect
  // separation (TP 19 / FN 0 / FP 0 / TN 24) against the structural ground truth.
  // The two mutants below are the two ways that guard, or any replacement for
  // it, can be defeated, and both are caught by nim/bare-case.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "nim/bare-case-discriminator-guard-removed",
    language: "nim",
    defectClass: "fabricated-symbol",
    description:
      "The bare-`case` guard stops applying, and the slot's borrowed constructor " +
      "is published again as a field of the owning type with a `contains` edge " +
      "to it. This is the defect itself, reproduced as a transform so the fixture " +
      "is proved able to catch it. " +
      "Caught by nim/bare-case's forbidSymbols {AddOpr, SubOpr, None, Some, float, " +
      "Circle, Value} and its four forbidRelationships `contains` rows.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !s.metadata?.nimVariantDiscriminator
        || isBorrowedDiscriminatorName(String(s.name ?? ""))),
      relationships: (r.relationships ?? []).filter((e: any) => !isBorrowedDiscriminatorName(String(e.target ?? ""))),
    }),
  },
  {
    id: "nim/bare-case-guard-restored-by-keyword-list",
    language: "nim",
    retired: true,
    retiredOn: "the same commit that shipped the guard",
    retirementReason:
      "NOT EXPRESSIBLE as an output transform against a fixed analyzer, and the reason is " +
      "structural rather than convenient. This mutant models the PARTIAL fix — a keyword-list " +
      "guard — by dropping published discriminators whose name is a Nim reserved word. On the " +
      "PRE-fix analyzer that transform would reproduce the defect and the fixture would catch " +
      "it. On the SHIPPED analyzer the real guard has already removed every borrowed name, so " +
      "the filter is idempotent and the harness's rule (`mutated.fail > base.fail`) cannot see " +
      "it. A surviving mutant here is the harness telling the truth about its own reach, not a " +
      "gap in the fixture: `mutate-analyzer.ts` transforms RESULTS, and a fix that changes which " +
      "symbols EXIST cannot be undone by transforming the result of the fix. " +
      "The hazard is not left unpinned — it is pinned from the other side, by the fixture rows " +
      "that a partial fix would have to keep passing: nim/bare-case's forbidSymbols name " +
      "AddOpr, None, Some, float and Circle, NONE of which is a Nim reserved word, so a keyword " +
      "guard cannot satisfy them. Mutant `nim/bare-case-discriminator-guard-removed` remains " +
      "live and CAUGHT, and it is the one that can be expressed.",
    defectClass: "partial-fix",
    description:
      "The guard is 'fixed' with the cheap instrument instead of the measured one: " +
      "a published discriminator is dropped when its name is a Nim reserved word. " +
      "That is the rewrite the measurement exists to prevent — over nimony's 43 " +
      "slots the reserved-word test catches 5 of 19 fabrications and misses 14, " +
      "because `None`, `Some`, `AddOpr`, `float` and `T` are legal identifiers and " +
      "not keywords. It PASSES the corpus keyword probe, which is why it is " +
      "dangerous: the defect looks closed and 14 fabrications per repo remain. " +
      "Caught by nim/bare-case's forbidSymbols {AddOpr, None, Some, float, Circle}, " +
      "none of which is a reserved word.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !s.metadata?.nimVariantDiscriminator
        || !NIM_RESERVED.has(String(s.name ?? ""))),
      relationships: (r.relationships ?? []).filter((e: any) => !NIM_RESERVED.has(String(e.target ?? ""))),
    }),
  },
  // ═══════════════════════════════════════════════════════════════════════
  // M60 module identity — the module symbol and the target that names it
  //
  // Two emitters spelling one symbol differently is the defect class the
  // B/A/C brief calls "format mismatch", and it is worth two mutants rather
  // than one because the two halves fail INDEPENDENTLY and a fixture that only
  // pins one of them passes while the other half is broken.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "nim/module-symbol-dropped",
    language: "nim",
    defectClass: "unresolvable-endpoint",
    description:
      "A `.nim` file stops publishing the MODULE it defines, so every `imports` edge " +
      "names a module that exists nowhere in the symbol set. This is not a resolution " +
      "failure — there is no candidate to fail to find — and the store cannot rescue " +
      "it: the insert-time resolver matches `brain_symbol.name` " +
      "(parallel-indexer.ts:2239), the three post-pass strategies match a bare name, a " +
      "`qualified_name`, or everything after the first `.` of a dotted target " +
      "(:3755-3774), and `std/assertions` is none of those; the fourth, " +
      "`resolveImportTargets`, is scoped to the `<module>:<item>` form " +
      "javascript/typescript/python emit and nim never reaches it. " +
      "MEASURED with production `parseFile` over the 6,063-file corpus " +
      "(validation/m14/fixtures/nim/census.ts): `imports` resolved on 37.1% of 13,364 " +
      "edges before the module pass and 92.0% of 13,365 after it. " +
      "Caught by nim/module-target's expectSymbols {module-target, kind: module}. The " +
      "mutant is kept separate from the target-normalisation mutant below because " +
      "dropping the symbol while keeping the normalised target leaves the edge pointing " +
      "at a name that exists, which a target-only fixture would not notice is wrong.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.kind !== "module"),
    }),
  },
  {
    id: "nim/import-target-keeps-the-written-path",
    language: "nim",
    defectClass: "unresolvable-endpoint",
    description:
      "The `imports` target goes back to the module path AS WRITTEN while the module " +
      "symbol stays published. The two halves drifted apart in the first place, which " +
      "is why this is expressible as its own mutant: the emitter wrote the path " +
      "`parseModuleExpression` returned and the publisher wrote the file's basename, " +
      "and no test compared them. `import std/os` then targets `std/os`, which no " +
      "symbol carries, and `import ./helpers` targets `./helpers`. Both were CORRECT " +
      "for the corpus by accident and wrong for the graph. " +
      "Caught by nim/module-target's three forbidRelationships rows — {imports, " +
      "std/os}, {imports, std/private/globs}, {imports, ../shared} — and by " +
      "nim/contract's five retargeted `imports` rows, whose `meta.nimModulePath` pins " +
      "the written path separately from the target so the two cannot be confused " +
      "again. Verified by hand before registration: reverting the three target sites " +
      "made nim/module-target and nim/contract FAIL (10 pass / 2 fail) with all three " +
      "forbid rows firing.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((e: any) => {
        const written = e?.metadata?.nimModulePath
        if (!written) return e
        return { ...e, target: written }
      }),
    }),
  },
]
