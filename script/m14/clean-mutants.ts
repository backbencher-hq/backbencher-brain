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
      "M60 ONTOLOGY GAP (`overrides` reverted entirely): the lane emits no `overrides` edge at all, which is the state it was in before this round. This is the defect class `ontology-coverage-gate.ts` exists for — a relationship type absent from BOTH the analyzer and the oracle, so the differential had nothing to disagree about and the type stayed invisible for the whole lane's history. Clean has no `override` KEYWORD, so no keyword probe could ever have found it: the only evidence is the typeclass pairing, and measuring the pairing is what produced it. Measured before the branch existed: 1,036 instance members across 78 classes at the 2,181-file corpus. Caught by clean/typeclass-overrides, whose two `expectRelationships` rows pin `overrides Thing.show -> Show.show` and `overrides Int.show -> Show.show`.",
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
      "FABRICATION CLASS, and the direction an aggregate count invites. The in-file guard is dropped, so an `instance C T where m` emits `overrides T.m -> C.m` for a class this file never read. Almost every Clean class is IMPORTED — the doc's own `implements` row records 322 of 739 edges as external for exactly that reason — so the unguarded form names a class member the analyzer has no evidence exists. Unlike an `implements` edge, whose meaning survives an external target, an `overrides` edge ASSERTS that this member is the implementation of that specific class member; without having read the class, that is a claim about a declaration the run never saw. Caught by clean/typeclass-overrides, whose `forbidRelationships` row refuses `overrides from: Bool.size` — `instance Show Bool where size b = …` supplies a member (`size`) the imported class does not declare. THE SHAPE IS DERIVED, NOT HARDCODED, and it had to be re-derived when the container was namespaced: the unguarded emission is per INSTANCE, so the mutant reads the instance container (`impl`, `<target>::instance`) for the type and the member's NOMINAL owner for the endpoint — the two facts the naming fix moved. A mutant that still matched `kind === 'class'` would have survived by matching nothing, which is the failure mode a generator-built revert exists to avoid.",
    transform: (r: any) => {
      const SUFFIX = "::instance"
      // THE INSTANCE'S TYPE, from the container symbol — the post-fix spelling. Members are owned by
      // the NOMINAL type, so `ownerName` is the same string and both halves agree without guessing.
      const instanceTypes = new Set<string>()
      for (const s of r.symbols ?? []) {
        const name = String(s?.name ?? "")
        if (String(s?.kind) === "impl" && name.endsWith(SUFFIX)) instanceTypes.add(name.slice(0, -SUFFIX.length))
      }
      return {
        ...r,
        relationships: [
          ...(r.relationships ?? []),
          // The unguarded pre-fix shape: an edge for every instance member, built from
          // the same REAL member symbols the analyzer publishes. Both ends are real
          // nodes, which is the point — a fabricated edge between two REAL symbols is
          // the class no resolution check can catch, and only a fixture pin can.
          ...(r.symbols ?? [])
            .filter((m: any) => m.kind === "method" && instanceTypes.has(String(m.ownerName ?? "")))
            .map((m: any) => ({
              type: "overrides",
              source: String(m.ownerName) + "." + String(m.name),
              target: String(m.name),
              confidence: 1,
              line_number: m.startLine ?? m.range?.startLine,
              metadata: { cleanSpecific: true, isTypeClassOverride: true, isExternalClassUnguarded: true },
            })),
        ],
      }
    },
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
      "PAYLOAD CLASS on the type the lane just added. The `Owner.member` qualification is dropped from both endpoints, so `Thing.show -> Show.show` becomes `show -> show`. The edges still resolve — the store matches a bare name — and a resolution-rate check still reads 100%, so nothing about resolvability convicts this. What is lost is IDENTITY: three symbols in the typeclass-overrides fixture are named `show`, and `bb_graph`/`bb_impact` would merge them into one node. A bare-name edge cannot say WHICH `show`. This is the defect class where only a fixture pin can catch it, because every rate the store computes stays at 100%. Caught by clean/typeclass-overrides, whose `forbidRelationships` rows refuse `overrides show` (the unqualified form) and whose two `expectRelationships` rows carry the qualified endpoints.",
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
        // node, which is the point — every rate the store computes stays at 100%.
        // `new Set(...)` over a chain read from an `any` receiver infers `Set<unknown>`,
        // which is why the `flatMap` callback's `cls` had to be annotated against a set
        // of unknown values. The element type is stated instead.
        ...[...new Set<string>(
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
  {
    id: "clean/signature-lookup-by-derived-key-only",
    language: "clean",
    defectClass: "missing-relationship-type",
    description:
      "KEY-MISMATCH CLASS. Reverts `signaturesByNode`: the emitting pass is made to look its signature up ONLY by the derived string key, which is what the code did before this round's correction. The two passes derive that key independently and disagree for an instance member — the declaration pass files it under the MODULE owner (`|::cmp`, because it does not know the instance's target) and the emitting pass asks under the INSTANCE owner (`|[!a]::cmp`, because that is the scope the walk is in) — so the lookup misses, `applySignature` never runs, and the member's types and its `| C a` class context are read and discarded. Nothing is fabricated and nothing is mislabelled: real edges go MISSING, which is why a count-only check cannot see it and why the corpus had to be asked the question directly (of 473 class_context nodes at PROD, 20 published no edge at all). Measured at PROD, 312 files: `references` 10,049 -> 9,551, 498 edges absent, total 30,685 -> 30,187, and NO other type moves. Caught by clean/instance-member-signature-context, whose three `expectRelationships` rows pin `references cmp -> Ord` at L34, `references cmp -> Eq` at L43 and `references cmp -> Ord` at L53 — each an instance member's own dictionary requirement — plus `references inner -> Eq` at L67 for the `where`-local form.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(
          String(x.type).toLowerCase() === "references"
          && (x.metadata ?? {}).relationshipType === "class_context"
          && /^(cmp|inner|moduleLevel)$/.test(String(x.source ?? ""))
        ),
      ),
    }),
  },
  {
    id: "clean/operator-class-declaration-spelling-only",
    language: "clean",
    defectClass: "missing-relationship-type",
    description:
      "SPELLING-MISMATCH CLASS, first half. An operator IS a class name in Clean and the two sites spell it differently: a DECLARATION writes `class (>>=) a where` and an INSTANCE writes `instance >>= Thing where`. The mutant keys `classMembers` on the declaration's `name` field VERBATIM — `(>>=)` — exactly as the code did before this round's correction — so the `overrides` in-file guard cannot find the member set and refuses every `overrides` edge for an operator-named class declared in the SAME FILE. Nothing is fabricated and nothing is mislabelled: an edge that should exist is silently dropped, which is the failure a count-only check cannot see, because the lane's `overrides` total goes DOWN rather than wrong. It is invisible in aggregate for a second reason too: the corpus spells its operator-named classes on ONE line (`class (==) infix 4 a :: !a !a -> Bool`, clean-stdlib/StdOverloaded.icl:23), and the one-line form gives the member set nothing to read — measured 0 new `overrides` edges on the 312-file corpus when the fix landed. So the fixture had to be written to reach the code at all: clean/extends-probe-roles declares `class (>>=) a where` in the `where` form and requires `overrides Thing.>>= -> >>=.>>=` at line 106.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(String(x.type).toLowerCase() === "overrides" && /^[(*+\-/<>=|&!~?:@#$%^.]/.test(String(x.target ?? ""))),
      ),
    }),
  },
  {
    id: "clean/implements-external-class-always-external",
    language: "clean",
    defectClass: "wrong-payload",
    description:
      "SPELLING-MISMATCH CLASS, second half, and the one that is a FALSE STATEMENT rather than a missing edge. `isExternalClass` exists to say which of the two cases an `implements` edge is: the class is declared in this file, or it is imported. Almost every Clean class IS imported, so the flag is `true` for the normal case and is the only thing that stops a reader assuming otherwise. The mutant reverts the lookup to `!declaredTypeNames.has(className)` alone, so a class declared here as `class (==) infix 4 a ::` and read back by an instance as `==` is reported EXTERNAL — measured at 24 `implements` edges across the 312-file corpus, the false count after the fix being 0. Unlike the first half this one changes no count at all: same edges, same endpoints, same lines, same labels, and one metadata field quietly wrong on 24 of them. Caught by clean/extends-probe-roles, which pins `meta.isExternalClass: false` on `implements Thing -> ==` (line 75) and `implements Thing -> >>=` (line 105) AND forbids the same key reading false on `implements Thing -> Eq`, so the flag cannot be made constant to pass.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.type).toLowerCase() === "implements"
          ? { ...x, metadata: { ...(x.metadata ?? {}), isExternalClass: true } }
          : x,
      ),
    }),
  },
  {
    id: "clean/ampersand-class-context-separator-dropped",
    language: "clean",
    defectClass: "missing-relationship-type",
    description:
      "TWO-SPELLINGS-ONE-CONSTRUCT CLASS, and the first mutant in this battery that needs the SOURCE TEXT to be reverted faithfully — which is why `transform` receives `source`. `readClassContext` reset `expectName` on a `,` child and on nothing else, so a `|` context joined by `&` published its first conjunct and dropped the rest. `&` is not a second construct: the child shape is identical with the token swapped (`| == a` -> `!| operator_compare type_variable` against `| == a & UList a` -> `!| operator_compare type_variable !& constructor type_variable`, clean-stdlib/StdOverloadedList.dcl:5,8), which is the same two-spellings-one-handler shape the `fixity` field is already handled for. Measured cost of the `,`-only reader (validation/m14/fixtures/clean/ampersand-context-probe.mts): 365 of the 1,995 WIDE `class_context` nodes carry an `&`, and the conjuncts such a reader drops split 249 that would ADD a row against 264 that name a class already published on the same line. Nothing is fabricated and nothing is mislabelled — an edge that should exist is silently absent, which is the failure a count-only check cannot see because the lane's `references` total goes DOWN rather than wrong. The mutant re-derives the `,`-only reader off `source`: for a `class_context` edge, take the line, cut the context at its first `|`, split on `&`, and drop the edge when its target appears only in a conjunct after the first. A line with no `|` keeps its edges, so the mutant drops only what it can show the pre-fix code dropped. Caught by clean/ampersand-class-context, whose rows at lines 36, 41, 57, 64, 70 and 72 are exactly the shapes this loses.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const lines = source.split("\n")
      const conjunctsOn = (lineNumber: number): string[] | null => {
        const text = lines[lineNumber - 1]
        if (!text) return null
        const bar = text.indexOf("|")
        if (bar < 0) return null
        return text.slice(bar).split("&")
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).filter((x: any) => {
          if (String(x.type).toLowerCase() !== "references") return true
          if (x?.metadata?.relationshipType !== "class_context") return true
          const conjuncts = conjunctsOn(Number(x.line_number))
          if (!conjuncts || conjuncts.length < 2) return true
          const target = String(x.target ?? "")
          if (!target) return true
          if (conjuncts[0].includes(target)) return true
          return !conjuncts.slice(1).some((c) => c.includes(target))
        }),
      }
    },
  },
  {
    id: "clean/ampersand-repeat-published-per-conjunct",
    language: "clean",
    defectClass: "duplicate-edge",
    description:
      "THE OPPOSITE ERROR TO THE ONE ABOVE, and the reason the dedupe is pinned by a COUNT row rather than by prose. `pushRel` collapses on `source|type|target|line`, so `| Ord Int & Ord Int & Size Int` publishes one edge to `Ord` and one to `Size` — two rows for three conjuncts. The mutant models the alternative that was live before this round settled it: publish one row per conjunct, so the repeated conjunct yields a SECOND identical `references` edge on the same line. Nothing is fabricated about the class — `Ord` really is required — and the edge is still correctly labelled; what is wrong is that the payload carries no multiplicity field, so the second row says nothing the first did not, and `bb_graph`'s edge count and `bb_impact`'s dependent count both rise for a file that did not change. 264 conjuncts at WIDE and 47 at TRACKED have this shape, so it is not a synthetic case: `| toReal a & toReal b & toReal c` is Clyde/Clyde/timeprofile.icl:337. Measured as an A/B on TRACKED (validation/m14/fixtures/clean/references-duplicate-probe.mts) the fix itself changed the count of `references` groups holding more than one edge by ZERO — 387 before, 387 after, identical per discriminator — which is the evidence that the shipped code does not do this. Caught by clean/ampersand-class-context through `expectRelationshipCount` on `repeated -> Ord` at line 96, `equals 1`: under this mutant the real count is 2.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const lines = source.split("\n")
      const repeatsOn = (lineNumber: number, target: string): boolean => {
        const text = lines[lineNumber - 1]
        if (!text) return false
        const bar = text.indexOf("|")
        if (bar < 0) return false
        const conjuncts = text.slice(bar).split("&")
        if (conjuncts.length < 2) return false
        return conjuncts.slice(1).filter((c) => c.includes(target)).length > 0
      }
      const extra: any[] = []
      for (const x of (r.relationships ?? [])) {
        if (String(x.type).toLowerCase() !== "references") continue
        if (x?.metadata?.relationshipType !== "class_context") continue
        const target = String(x.target ?? "")
        if (!target) continue
        if (!repeatsOn(Number(x.line_number), target)) continue
        extra.push({ ...x })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "clean/instance-container-named-after-target",
    language: "clean",
    defectClass: "fabricated-declaration",
    caughtBy: "clean/instance-target-name-collision",
    description:
      "PHANTOM DECLARATION CLASS, and the mutant that keeps the fix falsifiable. `processInstance` publishes a CONTAINER symbol to own an instance's members, and before this round it was named exactly the instance's TARGET TYPE: `instance == Collision where` published a symbol called `Collision` (kind `class`), so a file that declares `:: Collision = …` and an instance for it declared the name TWICE. The invented symbol is not a declaration of anything the source declares — an instance head is a TYPE EXPRESSION, not a name form. MEASURED on the 312-file population (validation/m14/fixtures/clean/phantom-census.mts, +244 / gates): 699 containers in 94 files, 112 distinct names, 150 of them not an identifier at all (`.a`, `[]`, `?`), and the incoming gate resolves on `declCount === 1` ALONE with no kind test, so the phantom did not merely add a row — it MADE RESOLUTIONS. Removing it moved 1,537 residual rows (Int 654 · Bool 426 · Char 320 · Files 50 · File 37 · World 24 · ABCInstructionEntry 17 · ParseError 3 · ParseWarning 3 · Tm 2 · Range 1) into the open, and 100.0% of them are attributed to a name only a container published (validation/m14/fixtures/clean/phantom-attribution.mts). This transform reverts the NAMING and the KIND the pre-fix code published, and moves every edge endpoint that named a container with it, so a fixture that only checks relationships still sees the phantom's own rows. Caught by clean/instance-target-name-collision on three pins: `expectSymbolCount Collision equals 1` (the mutant reads 2), `expectSymbols Collision::instance` (absent), and `forbidRelationships contains -> Collision at line 17` (the instance's containment reappears under the bare name).",
    transform: (r: any) => {
      const SUFFIX = "::instance"
      /** namespaced container name -> the bare target type it published before the fix */
      const renamed = new Map<string, string>()
      const symbols = (r.symbols ?? []).map((s: any) => {
        const name = String(s?.name ?? "")
        if (!name.endsWith(SUFFIX)) return s
        const bare = name.slice(0, -SUFFIX.length)
        renamed.set(name, bare)
        // THE KIND MOVES TOO. The pre-fix container was a `class` — that is what made it an
        // EXPORTABLE declaration and what `expectExports`/`forbidExports` pin — so a revert that
        // kept `impl` would model a defect the code never had and could be caught by the wrong pin.
        return { ...s, name: bare, kind: "class" }
      })
      // EVERY EDGE ENDPOINT THAT NAMED A CONTAINER MOVES WITH IT: `contains` (the module and the
      // target type contain it), `exports` and `implements`. A transform that renamed only symbols
      // would leave the fixture's relationship rows green and the mutant would survive on the
      // symbol-count pin alone — which is the narrowest possible catch for a defect whose cost was
      // measured in RESOLUTIONS, not in symbol counts.
      const relationships = (r.relationships ?? []).map((x: any) => {
        const t = String(x?.target ?? "")
        const src = String(x?.source ?? "")
        if (!renamed.has(t) && !renamed.has(src)) return x
        return {
          ...x,
          ...(renamed.has(src) ? { source: renamed.get(src) } : {}),
          ...(renamed.has(t) ? { target: renamed.get(t) } : {}),
        }
      })
      return { ...r, symbols, relationships }
    },
  },
  {
    id: "clean/module-level-qualified-name-dropped",
    language: "clean",
    defectClass: "missing-symbol-identity",
    caughtBy: "clean/declaration-forms",
    description:
      "THE .dcl/.icl TWIN CLASS, reintroduced. A Clean module is DECLARED in `.dcl` and IMPLEMENTED in `.icl`, so a module-level type, function, class or macro is ONE declaration written in TWO files — and the incoming gate collapses the pair only when every declaration carries the same NON-EMPTY `qualifiedName` that DIFFERS from the bare name (the store's file-scope fallback is `qualifiedName = name`, and a fallback is not a qualification). This analyzer published NO qualifiedName at module scope, so every such pair reached the gate as TWO declarations and the pair was counted as a name collision. MEASURED on the 312-file arm, whole population: `references` ambiguous 1,808 -> 1,011 (-797, exactly the collapse price measured before the change), `exports` 40 -> 12, and the gate's own collapsed-key count 719 -> 3,148 (1,287 of them NAME keys, the rest the new `Module.name` alias keys each symbol now also answers to). Held by the pin on `clean/declaration-forms` (`qualifiedName: CleanDeclForms.Sized` / `CleanDeclForms.MaxBound`), which fails the moment a module-level symbol loses the spelling; the class/instance MEMBER spellings (`Sized.sizeOf`, `Int.sizeOf`) are pinned beside it so a revert that qualified EVERYTHING is caught too.",
    transform: (r: any) => {
      const symbols = (r.symbols ?? []).map((s: any) => {
        const name = String(s?.name ?? "")
        const owner = String(s?.ownerName ?? "")
        const qn = String(s?.qualifiedName ?? "")
        // the module-level spelling this round added: `<module>.<name>`, no `scope`, not a local.
        // A class/instance member carries `scope` (its owner) and is NOT touched — that is the
        // control: a revert that dropped every qualifiedName would also break the member pins.
        if (s?.scope === undefined && s?.visibility !== "local" && s?.metadata?.isLocalDefinition !== true &&
            owner.length > 0 && qn === `${owner}.${name}`) {
          return { ...s, qualifiedName: name }
        }
        return s
      })
      return { ...r, symbols }
    },
  },
]
