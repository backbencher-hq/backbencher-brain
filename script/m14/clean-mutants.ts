/**
 * CLEAN MUTANTS — the clean lane's regression mutants for the M14.0.F4 gate.
 *
 * ## Why this is a separate file
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (ONTOLOGY-WORKSTREAM.md
 * §Ownership; the clean lane's §8 list names it explicitly), and
 * `script/m14/css-mutants.ts` records in its own header what happens otherwise:
 * a 259-line block written into the shared registry was overwritten within the hour,
 * silently, and the file stayed syntactically valid so the gate kept reporting numbers
 * with this lane's mutants simply absent from them. The footprint kept in a shared file
 * is therefore an import and nothing else.
 *
 * ## WIRING THE SUPERVISOR OWNS (two lines, in `script/m14/mutate-analyzer.ts`)
 *
 *   import { CLEAN_MUTANTS } from "./clean-mutants"
 *   …
 *   export const MUTANTS: Mutant[] = [
 *     …,
 *     ...CLEAN_MUTANTS,
 *   ]
 *
 * Until that lands these mutants are defined and NOT RUN by the shared gate, so this
 * file must not be read as a claim that the F4 gate covers them.
 * `script/m14/clean-mutant-run.ts` is the lane-owned runner that DOES execute them,
 * and it reports the pass/fail counts it measured.
 *
 * ## WHAT EACH MUTANT IS
 *
 * M14.0.F4's rule is that a deliberately injected defect MUST make the suite red: a
 * surviving mutant fails THE SUITE, not the mutant. Each entry below reverts one
 * defect class this lane's M60 pass 2 either fixed or deliberately declined to fix,
 * and each names the fixture that catches it.
 *
 * `overrides` is the lane's one newly-emitted type (a GAP the corpus overturned: 1,036
 * instance members across 78 classes supply a class member — see
 * `script/m14/clean-extends-overrides-probe.ts`), and it has exactly four ways to be
 * wrong, in OPPOSITE directions. All four are here, because a fixture that pins only
 * one direction pins a type that can be broken in the direction nobody checked.
 */
import type { Mutant } from "./mutate-analyzer"

export const CLEAN_MUTANTS: Mutant[] = [
  {
    id: "clean/overrides-dropped",
    language: "clean",
    defectClass: "missing-relationship-type",
    description:
      "M60 ONTOLOGY GAP (`overrides` reverted entirely): the lane emits no `overrides` edge at all, which is the state it was in before this round. This is the defect class `ontology-coverage-gate.ts` exists for — a relationship type absent from BOTH the analyzer and the oracle, so the differential agreed perfectly with itself and the type stayed invisible for the whole lane's history. Clean has no `override` KEYWORD, so no keyword probe could ever have found it: the only evidence is the typeclass pairing, and measuring the pairing is what produced it. Measured before the branch existed: 1,036 instance members across 78 classes at the 2,181-file corpus. Caught by clean/typeclass-overrides, whose two `expectRelationships` rows pin `overrides Thing.show -> Show.show` and `overrides Int.show -> Show.show`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() !== "overrides"),
    }),
  },
  {
    id: "clean/overrides-in-file-guard-dropped",
    language: "clean",
    defectClass: "fabricated-relationship",
    description:
      "FABRICATION CLASS, and the direction an aggregate count invites. The in-file guard is dropped, so an `instance C T where m` emits `overrides T.m -> C.m` for a class this file never read. Almost every Clean class is IMPORTED — the doc's own `implements` row records 322 of 739 edges as external for exactly that reason — so the unguarded form names a class member the analyzer has no evidence exists. Unlike an `implements` edge, whose meaning survives an external target, an `overrides` edge ASSERTS that this member is the implementation of that specific class member; without having read the class, that is a claim about a declaration the run never saw. Caught by clean/typeclass-overrides, whose `forbidRelationships` rows refuse an `overrides` edge targeting `Show.size` — `size` is a member of the instance, never of the class.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        // The unguarded pre-fix shape: an edge for every instance member, built from
        // the same REAL member symbols the analyzer publishes. Both ends are real
        // nodes, which is the point — a fabricated edge between two REAL symbols is
        // the class no resolution check can catch, and only a fixture pin can.
        ...(r.symbols ?? [])
          .filter((s: any) => s.kind === "class" && (r.relationships ?? []).some((x: any) => String(x.type).toLowerCase() === "implements" && x.source === s.name))
          .flatMap((s: any) =>
            (r.symbols ?? [])
              .filter((m: any) => m.kind === "method" && m.ownerName === s.name)
              .map((m: any) => ({
                type: "overrides",
                source: String(s.name) + "." + String(m.name),
                target: String(m.name),
                confidence: 1,
                line_number: m.startLine ?? m.range?.startLine,
                metadata: { cleanSpecific: true, isTypeClassOverride: true, isExternalClassUnguarded: true },
              })),
          ),
      ],
    }),
  },
  {
    id: "clean/overrides-direction-reversed",
    language: "clean",
    defectClass: "wrong-relationship-type",
    description:
      "LABEL/DIRECTION CLASS, and the confusion this language is most likely to fall into: the edge is emitted class-member -> instance-member instead of instance-member -> class-member. Both ends are real, the type is right, and the graph is silently INVERTED: `bb_graph` on a class member would then report its own subclasses as the things it overrides, and `bb_impact` on `Show.show` would return its implementations where it should return its callers. In Clean the direction is not a convention — a `class_declaration` member is ABSTRACT (`class Show a where show :: !a -> String` carries no body) and therefore overrides nothing; the instance member is the definition. Caught by clean/typeclass-overrides, whose `forbidRelationships` rows refuse `overrides Show.show` (the reverse direction) and require both `Thing.show -> Show.show` and `Int.show -> Show.show`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type).toLowerCase() === "overrides" ? { ...x, source: x.target, target: x.source } : x,
      ),
    }),
  },
  {
    id: "clean/overrides-endpoints-unqualified",
    language: "clean",
    defectClass: "wrong-payload",
    description:
      "PAYLOAD CLASS on the type the lane just added. The `Owner.member` qualification is dropped from both endpoints, so `Thing.show -> Show.show` becomes `show -> show`. The edges still resolve — the store matches a bare name — and a resolution-rate check still reads 100%, so nothing about resolvability convicts this. What is lost is IDENTITY: three symbols in the typeclass-overrides fixture are named `show`, and `bb_graph`/`bb_impact` would merge them into one node. A bare-name edge cannot say WHICH `show`. This is the defect class where only a fixture pin can catch it, because every rate the store computes stays perfect. Caught by clean/typeclass-overrides, whose `forbidRelationships` rows refuse `overrides show` (the unqualified form) and whose two `expectRelationships` rows carry the qualified endpoints.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type).toLowerCase() !== "overrides") return x
        const leaf = (s: string) => (s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : s)
        return { ...x, source: leaf(String(x.source)), target: leaf(String(x.target)) }
      }),
    }),
  },
  {
    id: "clean/overrides-self-edge-guard-dropped",
    language: "clean",
    defectClass: "fabricated-relationship",
    description:
      "FABRICATION CLASS, third direction. The `frameOwner !== className` guard is removed, so a POLYMORPHIC instance of a locally-declared class emits an edge whose two endpoints are the SAME string: `instance List [] a where _cons …` gives `List._cons -> List._cons`. An edge from a declaration to itself asserts a relation between two declarations that is not there, and it is invisible to every rate the store computes — both endpoints resolve (to the same row), the confidence is 1.0, the site line is present. The underlying cause is real and named in the analyzer: a polymorphic instance publishes no symbol, so its members are attributed to the CLASS and share the class member's qualifiedName. Measured on the corpus before the guard: 60 such self-edges over the 2,181-file set. Caught by clean/typeclass-overrides, whose two `forbidRelationships` rows refuse `overrides Sized.size` and an edge targeting `Sized.size`.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        // The pre-fix shape, built from the same REAL method symbols the analyzer
        // publishes: for every class that a POLYMORPHIC instance targets, each of
        // that class's own methods becomes a self-edge. Both endpoints are one real
        // node, which is the point — every rate the store computes stays perfect.
        ...[...new Set(
          (r.relationships ?? [])
            .filter((x: any) => String(x.type).toLowerCase() === "implements" && (x.metadata as any)?.isPolymorphicInstance)
            .map((x: any) => String(x.target)),
        )].flatMap((cls: string) =>
          (r.symbols ?? [])
            .filter((m: any) => m.kind === "method" && m.ownerName === cls)
            .map((m: any) => ({
              type: "overrides",
              source: `${cls}.${String(m.name)}`,
              target: `${cls}.${String(m.name)}`,
              confidence: 1,
              line_number: m.startLine ?? m.range?.startLine,
              metadata: { cleanSpecific: true, isTypeClassOverride: true, isSelfEdge: true },
            })),
        ),
      ],
    }),
  },
  {
    id: "clean/overrides-relabelled-as-implements",
    language: "clean",
    defectClass: "wrong-relationship-type",
    description:
      "SECOND LABEL CLASS: the member-level `overrides` edges are relabelled `implements`. It is a plausible misreading — `instance C T where m` DOES implement `C.m` — and it is wrong because the lane ALREADY emits the instance-level `implements` edge (`Thing -> Show`), so the relabelled form double-counts one relationship under two labels and puts an edge whose SOURCE is a method into a type whose sources the other lanes' oracles derive as a type or a class. `implements` is audited by the differential for clean; `overrides` is in the audited set too, so relabelling moves the edge from one audited label to another and the differential's per-label counts change without the total moving. Caught by clean/typeclass-overrides, which requires `type: \"overrides\"` on both member edges and already requires `implements Thing -> Show` on the instance edge.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type).toLowerCase() === "overrides" ? { ...x, type: "implements" } : x,
      ),
    }),
  },
  {
    id: "clean/overrides-site-line-lost",
    language: "clean",
    defectClass: "wrong-payload",
    description:
      "SITE-LINE CLASS (M59.O2). The instance member's own `line_number` is dropped from the `overrides` edges. The rule the whole lane follows is that every relationship carries a 1-based line on the NAME-BEARING node, per-site, and that the line is part of the store key `(source, type, target, line)`. With the line gone, `Int.show -> Show.show` and `Thing.show -> Show.show` differ only by their source, so they survive — but a file with two instances of one class for the SAME target type would collide under `INSERT OR IGNORE` and one becomes unreachable from the graph. Caught by clean/typeclass-overrides, whose two `expectRelationships` rows assert distinct `line_number` values (40 and 43) and whose `expectRelationshipCount` row pins the count.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type).toLowerCase() !== "overrides") return x
        const { line_number, ...rest } = x as Record<string, unknown>
        void line_number
        return rest
      }),
    }),
  },
]