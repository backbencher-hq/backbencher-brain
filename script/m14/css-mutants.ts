/**
 * CSS MUTANTS — the css lane's regression mutants for the M14.0.F4 gate.
 *
 * ## Why this is a separate file
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery that six concurrent lanes edit
 * (ONTOLOGY-WORKSTREAM.md §Ownership), and `script/m14/fsharp-mutants.ts` records what
 * happens otherwise in its own header: a 259-line block written into the shared
 * registry was overwritten within the hour, silently, and the file stayed
 * syntactically valid so the gate kept reporting numbers with this lane's mutants
 * simply absent from them. The footprint kept in a shared file is therefore an import
 * and nothing else.
 *
 * ## WIRING THE SUPERVISOR OWNS (two lines, in `script/m14/mutate-analyzer.ts`)
 *
 *   import { CSS_MUTANTS } from "./css-mutants"
 *   …
 *   export const MUTANTS: Mutant[] = [
 *     …,
 *     ...CSS_MUTANTS,
 *   ]
 *
 * Until that lands these mutants are defined and NOT RUN by the shared gate, so this
 * file must not be read as a claim that the F4 gate covers them.
 * `validation/m14/census/css-mutant-run.ts` is the lane-owned runner that DOES execute
 * them, and it reports the pass/fail counts it measured.
 *
 * ## WHAT EACH MUTANT IS
 *
 * M14.0.F4's rule is that a deliberately injected defect MUST make the suite red: a
 * surviving mutant fails THE SUITE, not the mutant. Each entry below reverts one
 * defect class this lane's M14 ontology round either fixed or deliberately declined to
 * fix, and each names the fixture that catches it.
 *
 * `overrides` is the lane's one newly-emitted type, and it has exactly two ways to be
 * wrong, in OPPOSITE directions. Both are mutants here, because a fixture that pins
 * only one of them pins a type that can be broken in the direction nobody checked:
 *
 *   - emitting nothing: the type silently disappears and the pre-fix state returns.
 *   - emitting on a vendor-prefixed pair: 142 fabricated edges over the corpus.
 *
 * ## THE PASS-2 SET (3 more, on the shape pass 2 added)
 *
 * Pass 2 measured a second `overrides` shape — a `--custom-property` assigned twice
 * inside ONE declaration block — and the three mutants below attack it from the three
 * directions it can be wrong. Only ONE of them is "emit too much", and that is the
 * expensive direction: the shape's boundary is a BLOCK, and widening it to a file turns
 * every `:root { --x } .dark { --x }` pair in a stylesheet into an edge asserting a
 * replacement CSS does not perform.
 */
import type { Mutant } from "./mutate-analyzer"

export const CSS_MUTANTS: Mutant[] = [
  {
    id: "css/overrides-dropped",
    language: "css",
    defectClass: "missing-relationship-type",
    description:
      "M14 ONTOLOGY GAP (`overrides` reverted entirely): the lane emits no `overrides` edge at all, which is the state the lane was in before this round. The defect class is the one the ontology-coverage gate exists for — a relationship type absent from BOTH the analyzer and the oracle, so the differential agreed perfectly with itself and the type stayed invisible for the whole lane's history. Measured on the corpus: 146 adjacent same-name second declarations of a `@keyframes` across 33 files, 4 of them genuine same-keyword redefinitions. Caught by css/keyframes-redefinition-overrides, whose two `expectRelationships` rows pin `overrides` with `supersedesLine` for the `@keyframes fade` pair and the `@property --brand` pair.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() !== "overrides"),
    }),
  },
  {
    id: "css/overrides-on-a-vendor-prefixed-pair",
    language: "css",
    defectClass: "fabricated-relationship",
    description:
      "FABRICATION CLASS, the inverse of the mutant above and the one an aggregate count invites. The `@keyframes` keyword discriminator is dropped, so `@-webkit-keyframes slide` and `@keyframes slide` are read as two declarations of one name and an `overrides` edge is emitted between them. They are not: a prefixed pair is TWO animations and the user agent picks the one it implements, so every such edge asserts a replacement CSS does not perform. Measured cost if this shipped: 142 of the 146 adjacent same-name second declarations in the corpus are this shape (overwhelmingly Font Awesome's `@-webkit-keyframes fa-spin` / `@keyframes fa-spin`), i.e. 97.3% of the type would be invented. Caught by css/keyframes-redefinition-overrides, whose `forbidRelationships` rows refuse `overrides slide -> slide` and `overrides` targeting `slide` at all.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        // The pre-fix shape: an edge for the prefixed pair, built from the same two
        // `function` symbols the analyzer publishes for it. Both are real nodes —
        // which is the point: a fabricated edge between two REAL symbols is the class
        // no resolution check can catch, and only a fixture pin can.
        ...(r.symbols ?? [])
          .filter((s: any) => s.kind === "function")
          .map((s: any) => ({
            type: "overrides",
            source: String(s.name),
            target: String(s.name),
            confidence: 1,
            line_number: s.range?.startLine,
            metadata: { cssSpecific: true, isOverride: true, isVendorPrefixedPair: true },
          })),
      ],
    }),
  },
  {
    id: "css/overrides-line-pair-collapsed",
    language: "css",
    defectClass: "wrong-payload",
    description:
      "PAYLOAD CLASS on the type the lane just added. `supersedesLine` is dropped from the `overrides` metadata and the edge keeps only its own `line_number`. Both ends are the same string by construction (the lane publishes one symbol per name), so with the line pair gone the edge says `fade overrides fade` and a reader cannot tell WHICH earlier block died — which is the entire content of the fact. It also stops being storable-distinct: a relationship's store key is (source, type, target, line) — M59 #822 — so two `fade -> fade` supersessions in one file collide under `INSERT OR IGNORE` and one of them is unreachable from the graph. Caught by css/keyframes-redefinition-overrides, whose `expectRelationships` rows assert `meta.supersedesLine` on both the `@keyframes` and the `@property` edge.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type).toLowerCase() !== "overrides") return x
        const { supersedesLine, distinctSites, ...rest } = (x.metadata ?? {}) as Record<string, unknown>
        void supersedesLine
        void distinctSites
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "css/overrides-relabelled-as-extends",
    language: "css",
    defectClass: "wrong-relationship-type",
    description:
      "LABEL CLASS, and the confusion this language is most likely to fall into: the new `overrides` edges are relabelled `extends`. Both spell a kind of precedence between two declarations of one name, and CSS's own preprocessor DOES have an `extends`-shaped construct — SCSS `@extend .base` — so a lane reasoning from the family rather than from the measurement can pick the wrong word. It is the wrong word twice over: `extends` asserts type-level inheritance between two DIFFERENT names (a `calls`-shaped supertype relation CSS does not have), while `overrides` asserts a later declaration replaces an earlier one of the SAME name. Measured: 0 `@extend` directives and 0 type-declaration nodes in the whole corpus, so an `extends` edge here would name a relation the language never writes. Caught by css/keyframes-redefinition-overrides, which forbids `extends fade -> fade` and requires `overrides`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type).toLowerCase() === "overrides" ? { ...x, type: "extends" } : x,
      ),
    }),
  },
  {
    id: "css/overrides-custom-property-block-boundary-widened-to-the-file",
    language: "css",
    defectClass: "fabricated-relationship",
    description:
      "FABRICATION CLASS on pass 2's new shape, and the expensive direction. The `--custom-property` redefinition rule is scoped to ONE declaration block, because two declarations of one property inside one block share origin, context, layer, specificity and importance, so CSS Cascade 5 §6.1 (\"The last declaration in document order wins\") makes the later one replace the earlier one outright. `:root { --x: 1px }` followed by `.dark { --x: 2px }` shares NONE of those: the two apply to different elements and the cascade chooses between them per element. The mutant drops the block scope and keys the rule by property name alone, so every cross-block pair becomes an `overrides` edge asserting a replacement that never happens. This is the class the workstream calls the most expensive mistake available — an edge between two REAL symbols (the lane publishes one `--x` symbol by name-identity, which is exactly why the two blocks are the same node), so no resolution check can catch it. Caught by css/custom-property-redefinition-overrides, whose `forbidRelationships` rows refuse `overrides --scoped -> --scoped` and `overrides --guarded -> --guarded` while requiring the same type for `--twice`, `--thrice` and `--conditional`.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        // The block scope dropped: one edge per (name, occurrence) instead of per
        // (block, name), built from the `variable` symbols the analyzer publishes.
        ...(r.symbols ?? [])
          .filter((s: any) => s.kind === "variable" && String(s.name ?? "").startsWith("--"))
          .filter((s: any) => (s.metadata as any)?.occurrences > 1)
          .map((s: any) => ({
            type: "overrides",
            source: String(s.name),
            target: String(s.name),
            confidence: 1,
            line_number: s.startLine ?? s.range?.startLine,
            metadata: { cssSpecific: true, isOverride: true, isCrossBlockRedefinition: true, distinctSites: true },
          })),
      ],
    }),
  },
  {
    id: "css/overrides-custom-property-ignores-importance",
    language: "css",
    defectClass: "fabricated-relationship",
    description:
      "SECOND FABRICATION DIRECTION on the same shape, subtler than the boundary one. `--guarded: 1px !important; --guarded: 2px;` does NOT redefine: CSS Cascade 5 §6.1 sorts IMPORTANCE above document order, so the later declaration LOSES to the important one and the edge would point the wrong way. The mutant drops the equal-importance guard, so every mixed-importance pair in a declaration block becomes an `overrides` edge. Caught by css/custom-property-redefinition-overrides, which forbids `overrides --guarded -> --guarded` while requiring the type for the three equal-importance pairs in the same fixture — so the guard cannot be satisfied by suppressing the whole shape either.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type).toLowerCase() !== "overrides") return x
        if ((x.metadata as any)?.isCustomPropertyRedefinition !== true) return x
        // The guard inverted rather than removed: the mixed-importance pair now reads as
        // a redefinition and the equal-importance one does not.
        return { ...x, metadata: { ...(x.metadata ?? {}), importanceIgnored: true, isCustomPropertyRedefinition: false } }
      }),
    }),
  },
  {
    id: "css/overrides-custom-property-only-adjacent",
    language: "css",
    defectClass: "dropped-construct",
    description:
      "UNDERSHOOT on the same shape, and the one a naive implementation gets. The rule keys on \"assigned twice in one block\", which is what CSS Cascade 5 §6.1 actually says; it does NOT require the two declarations to be ADJACENT. `:root { --twice: 1px; --between: 2px; --twice: 3px }` still has the second assignment replace the first, because position decides and nothing between them competes. The mutant adds an adjacency requirement, so any interleaved redefinition is silently dropped — the type shrinks toward zero on real stylesheets while every adjacent case still passes. Caught by css/custom-property-redefinition-overrides, which requires `overrides --twice -> --twice` at the line of the THIRD declaration with `supersedesLine` naming the first, across an interleaved `--between`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => {
        if (String(x.type).toLowerCase() !== "overrides") return true
        if ((x.metadata as any)?.isCustomPropertyRedefinition !== true) return true
        // Keep only the redefinition whose killed declaration sits on the immediately
        // preceding line — i.e. the adjacent-only reading of the rule.
        const sup = (x.metadata as any)?.supersedesLine
        const line = (x as any).line_number
        return typeof sup === "number" && typeof line === "number" && line - sup === 1
      }),
    }),
  },
  {
    id: "css/scope-symbol-extent-collapsed-to-the-first-block",
    language: "css",
    defectClass: "wrong-payload",
    description:
      "REGRESSION GUARD on pass 2's second fix, and the defect class is an ENDPOINT rather than a label. `@media` and `@layer` publish ONE symbol per name, at the first block, so a second block of the same query used to leave the symbol's recorded extent covering only that first block — while every rule of the later block kept a `contains` edge pointing at it. Measured over the whole admitted corpus before the fix: 7,257 of 25,181 `isMediaScope` edges (28.8%) and 40 of 505 `isLayerScope` edges (7.9%) carried a contained rule OUTSIDE the source symbol's line range, e.g. `bootstrap-grid.css` pointing `.col-sm` at L284 through a symbol recorded at L22-L26. The mutant reverts the widening, so every multi-block scope collapses to its first block again. Caught by css/scope-conditions-and-custom-properties, which writes the same `@media` query twice and asserts the containment edge for a rule in the SECOND block. The class matters beyond this lane: a `contains` edge whose endpoint is somewhere its target is not is what makes `bb_impact` on a scope name report the wrong rule set, and no resolution check can see it because the endpoint DOES bind.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        const nm = String(s.name ?? "")
        if (!(nm.startsWith("@media ") || nm.startsWith("@layer ") || nm.startsWith("@container ") || nm.startsWith("@scope "))) return s
        // The pre-fix shape: the extent is the FIRST block only, which is what the
        // symbol carried before `widenScopeSymbol` existed.
        //
        // BOTH spellings have to be collapsed. `analyze()` returns the extent inside a
        // `range` object while `parseFile` flattens it to top-level `startLine` /
        // `endLine`; the fixture runner's matcher reads `actual[k]` and falls back to
        // `actual.range[k]` (run-fixtures.ts `matchConstraints`), so mutating only the
        // flattened fields leaves `range.endLine` correct and THE FIRST VERSION OF THIS
        // MUTANT SURVIVED. A mutant that changes a field nobody reads is not a weak
        // mutant, it is a dead one, and the run reported it as a survivor rather than
        // hiding it — which is the only reason it was found.
        const startLine = s.range?.startLine ?? s.startLine
        const startColumn = s.range?.startColumn ?? s.startColumn
        const startIndex = s.range?.startIndex ?? s.startIndex
        return {
          ...s,
          endLine: startLine,
          endColumn: startColumn,
          endIndex: startIndex,
          ...(s.range
            ? { range: { ...s.range, endLine: startLine, endColumn: startColumn, endIndex: startIndex } }
            : {}),
        }
      }),
    }),
  },
  {
    id: "css/animation-use-relabelled-as-a-call",
    language: "css",
    defectClass: "wrong-relationship-type",
    description:
      "REGRESSION GUARD on an EXISTING emitted type, and the one the ontology's six questions call LABELLED. `animation: fade` names a `@keyframes` sequence, and the lane emits `uses .spinner -> fade`; the mutant relabels that edge `calls`. `calls` in this codebase means \"invokes a callable declared elsewhere\", and CSS has no callable to invoke — the whole `calls` question for this language is RULED on a grammar inventory of 103 node types with no function-definition production and 0 `@function` declarations on the tree. So a `calls` edge out of a stylesheet would name a construct the language does not have, and `calls` is the type `bb_migrate` most trusts. Caught by css/keyframes-redefinition-overrides, which forbids `calls .spinner -> fade`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type).toLowerCase() !== "uses") return x
        if ((x.metadata as any)?.isAnimationRef !== true) return x
        return { ...x, type: "calls" }
      }),
    }),
  },
]