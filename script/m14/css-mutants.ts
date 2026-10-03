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