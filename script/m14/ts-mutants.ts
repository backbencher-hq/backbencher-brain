/**
 * TYPESCRIPT LANE MUTANTS — this lane's defect-class registry for M14.0.F4.
 *
 * WHY A LANE-OWNED FILE: `script/m14/mutate-analyzer.ts` is MASTER-owned, and
 * this registry has to be ONE list with one spread so the shared gate can prove
 * every mutant is caught. The fsharp lane established the shape (fourteen
 * mutants in `script/m14/fsharp-mutants.ts`, spread into the master `MUTANTS`
 * array with one line) and the go lane followed it, because "a mutant that is
 * not registered is indistinguishable from a defect class with no mutant" —
 * which is the hole F4 exists to close. The two lines of wiring into
 * `mutate-analyzer.ts` are reported to master rather than made here.
 *
 * `script/m14/ts-mutants-run.ts` runs these against the REAL fixture runner and
 * prints each mutant's effect, so the lane can show its own gates failing
 * without waiting for the master wiring.
 *
 * Every transform below is a faithful revert of a shape the analyzer really
 * produced, written generically off the RESULT or off a NODE SHAPE — never off a
 * hardcoded endpoint that would silently stop matching when a fixture changes,
 * which is the failure mode that left `swift/drop-container-subscript-uses` and
 * two elixir mutants surviving.
 *
 * NO REGEX. Relationship selection is by node/label identity and string
 * comparison; the one text transform (`revertHeritageLeaf`) is a fixed
 * substring the analyzer is verified to contain, checked before use so a rename
 * fails loudly instead of silently no-op'ing into a surviving mutant.
 */
export interface TsMutant {
  id: string
  language: "typescript"
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

function normRel(r: any): string {
  return String(r?.type ?? r?.relationshipType ?? "")
}
function rels(r: any): any[] {
  return r?.relationships ?? []
}
/** Drop every relationship of one type. */
function dropType(type: string) {
  return (r: any) => {
    if (!rels(r).some((x: any) => normRel(x) === type)) return r
    return { ...r, relationships: rels(r).filter((x: any) => normRel(x) !== type) }
  }
}
/** Relabel one type as a neighbour: a mislabelled edge and a missing edge are
 *  different defects, and a suite that only ever loses edges cannot see the
 *  first. The label is what bb_graph, bb_impact and bb_migrate route on. */
function relabel(from: string, to: string) {
  return (r: any) => {
    if (!rels(r).some((x: any) => normRel(x) === from)) return r
    return { ...r, relationships: rels(r).map((x: any) => (normRel(x) === from ? { ...x, type: to } : x)) }
  }
}
/** Drop every relationship carrying one `metadata.relationshipType` POSITION. */
function dropPosition(position: string) {
  return (r: any) => {
    const keep = rels(r).filter((x: any) => String(x?.metadata?.relationshipType ?? "") !== position)
    if (keep.length === rels(r).length) return r
    return { ...r, relationships: keep }
  }
}
/** Drop every re-export dependency edge — the `isReExport` metadata flag, not a
 *  path or a name, so the mutant stays valid when a fixture's paths change. */
function dropReExportImports() {
  return (r: any) => {
    const keep = rels(r).filter((x: any) => !(normRel(x) === "imports" && x?.metadata?.isReExport === true))
    if (keep.length === rels(r).length) return r
    return { ...r, relationships: keep }
  }
}
/** Faithful revert of the heritage leaf rule: put the RAW type text back on
 *  every heritage edge, which is what `extractClassHeritage` produced for
 *  `implements I<T>` and for `extends Ns.B`. The mutant is written over the
 *  RESULT so it needs no knowledge of the analyzer's internals, and it is
 *  reconstructed by re-wrapping the leaf — for `Shape<number>` the analyzer's
 *  own pre-fix target was the node's text, so the mutant appends a plausible
 *  argument list, which is what makes it a faithful shape rather than an
 *  arbitrary string. Caught by typescript/heritage-parameterized-leaves, whose
 *  forbid rows name `Shape<number>` and `Ns.Shape` directly. */
function revertHeritageLeaf(r: any) {
  let changed = false
  const out = rels(r).map((x: any) => {
    if (normRel(x) !== "implements" && normRel(x) !== "extends") return x
    const t = String(x.target ?? "")
    // A leaf with no dots and no brackets is the shape the pre-fix code already
    // produced correctly; leaving it alone keeps the mutant from inflating the
    // failure count with rows that were never wrong.
    if (t === "" || t.includes(".") || t.includes("<")) return x
    changed = true
    return { ...x, target: `${t}<number>` }
  })
  return changed ? { ...r, relationships: out } : r
}

export const TS_MUTANTS: TsMutant[] = [
  {
    id: "typescript/parameterized-heritage-raw-text-target",
    language: "typescript",
    defectClass: "unmatchable-identity",
    description:
      "PRE-FIX (M14 IMPORTS_ENUM, 2026-10-04): `implements I<T>` published SOURCE TEXT as the edge target. The grammar nests the type arguments inside a `generic_type` under `implements_clause` while `extends_clause` puts them in a sibling field, and `extractClassHeritage` only skipped a `type_arguments` CHILD — correct for extends, never firing for implements. Measured targets: `implements: A -> \"I<T>\"`, `\"Ns.I<T>\"`, `\"Outer.Inner<T>\"`. Worse than a bad target: pool-worker.ts:594 drops any target whose leaf contains `<` or `>`, so the edge VANISHED before the index — the production path published nothing. Corpus site packages/typescript/src/api/node/node.generated.ts:41. No gate saw it because the differential's normTarget strips type arguments on BOTH sides. Caught by typescript/heritage-parameterized-leaves, whose forbids name the source-text targets directly.",
    transform: revertHeritageLeaf,
  },
  {
    id: "typescript/re-export-dependency-not-emitted",
    language: "typescript",
    defectClass: "missing-whole-class",
    description:
      "PRE-FIX (M14 IMPORTS_ENUM, 2026-10-04): a re-export recorded a module dependency in `ParseResult.imports` (which reaches the brain_import TABLE via parallel-indexer.ts:2168) and published NO relationship (brain_relationship is written by the separate statement at :2174, and no consumer reconciles the two stores). So a barrel file appeared to depend on nothing in the graph bb_graph, bb_impact and bb_migrate read. Measured with script/m14/ts-construct-probe.ts over tracked .ts of fixtures/repositories/typescript: `export … from` in 14 of the first 40 files, 0 imports edges; the star form published no exports edge either. Caught by typescript/re-export-module-dependency, which expects six re-export dependency edges including the star and the type-only forms.",
    transform: dropReExportImports,
  },
  {
    id: "typescript/re-export-star-export-edge-fabricated",
    language: "typescript",
    defectClass: "fabrication",
    description:
      "THE OPPOSITE ERROR, pinned because a suite that only ever loses edges cannot see a fabrication. `export * from \"./m\"` re-exports a set the file cannot name, so an `exports` edge target of `*` would be the unresolvable-endpoint class the family rules out for anonymous constructors (X8) and placeholder literals (R7) — and `*` passes every universal target rule in pool-worker, so nothing downstream would have caught it. The analyzer refuses it; this mutant adds it, and typescript/re-export-module-dependency must fail on the forbid row. " +
      "THE FIRST VERSION OF THIS MUTANT WAS A NO-OP, AND A NO-OP MUTANT IS NOT A PASS (L-2026-10-21-07). It keyed the star re-export on `metadata.isStarReExport === true` — a metadata key THE ANALYZER NEVER PUBLISHES. MEASURED 2026-10-21: `grep -rn isStarReExport src/` returns nothing, so the guard never fired, the mutant changed nothing, and the battery reported it as a SURVIVOR — which is the same reading as 'the suite cannot detect this defect', and is false: the suite never exercised the defect at all. The guard now keys on the SPELLING THE ANALYZER ACTUALLY EMITS: an `imports` row carrying `metadata.isReExport === true`, with NO `metadata.alias` (the namespace form `export * as ns from` carries one), whose target ends in the whole-module `:*` shape. Those three conditions are the analyzer's own star form and nothing else, so the mutant fires on a star re-export and on nothing else.",
    transform: (r: any) => {
      const already = rels(r).filter((x: any) => normRel(x) === "exports" && String(x.target ?? "") === "*")
      if (already.length > 0) return r
      // THE ANALYZER's OWN SPELLING, all three conditions — measured, not guessed. See the
      // description: the earlier `isStarReExport` key existed in NO analyzer source, so the
      // mutant was a no-op and the battery's "SURVIVED" verdict was a statement about the
      // mutant, not about the suite.
      const star = rels(r).find((x: any) =>
        normRel(x) === "imports" &&
        x?.metadata?.isReExport === true &&
        x?.metadata?.alias === undefined &&
        String(x.target ?? "").endsWith(":*"))
      if (!star) return r
      return {
        ...r,
        relationships: [
          ...rels(r),
          { source: star.source, target: "*", type: "exports", confidence: 1, metadata: {} },
        ],
      }
    },
  },
  {
    id: "typescript/type-predicate-position-dropped",
    language: "typescript",
    defectClass: "missing-whole-position",
    description:
      "PRE-FIX (M14 IMPORTS_ENUM, 2026-10-04): a type PREDICATE published nothing. Measured on the pinned wasm, the return type of `f(): x is Foo` is not a `type_annotation` — it is `(return_type (type_predicate_annotation (type_predicate name: (identifier) type: (type_identifier))))` — so `extractDeclaredTypeRefs`'s `type_annotation` case never fired for that shape, and `asserts x is Foo` (two hops down `asserts_annotation > asserts > type_predicate`) was silent for the same reason. Caught by typescript/type-predicate-and-constraint-refs, which expects four type_predicate_target reference rows and forbids the predicate's own parameter name as a target.",
    transform: dropPosition("type_predicate_target"),
  },
  {
    id: "typescript/type-parameter-constraint-position-dropped",
    language: "typescript",
    defectClass: "missing-whole-position",
    description:
      "PRE-FIX (M14 IMPORTS_ENUM, 2026-10-04): `<T extends C>` published the BINDING (`references f -> T`) and never the CONSTRAINT, so the one place `C` is named produced no edge. `(type_parameter name: (type_identifier) constraint: (constraint (type_identifier)))` had no case in the declared-type-refs walk. Measured: 53 constraint sites in the first 40 files of fixtures/repositories/typescript, 13 of 24 distinct names reached by an edge. Caught by typescript/type-predicate-and-constraint-refs (four type_parameter_constraint rows) and by typescript/heritage-parameterized-leaves (the `shrink` row).",
    transform: dropPosition("type_parameter_constraint"),
  },
  {
    id: "typescript/type-parameter-binding-leaked-as-reference",
    language: "typescript",
    defectClass: "fabrication",
    description:
      "THE OPPOSITE ERROR for the constraint arm, and the one a naive implementation produces: emitting the type parameter's own NAME as a type reference, so `<T extends C>` publishes `references f -> T` at the DECLARATION as well as at the parameter annotation. The java oracle states the rule in its own words — 'a TYPE PARAMETER DECLARATION is not a type usage: <T>, <A extends B>, <K, V> declare variables, they do not name a type in the file' — and this lane's pass has a PRIMITIVES exclusion for the same reason on the other side. Caught by typescript/type-predicate-and-constraint-refs, whose forbid rows name `x` for the predicate and a predefined constraint for the parameter.",
    transform: (r: any) => {
      // Publish the type parameter's OWN NAME at the constraint position, which is
      // what a collector that passed the whole `type_parameter` node to emit()
      // instead of its `constraint` field produces. The binding name is read from
      // the symbol's own `genericParameters` payload ("Q extends Shape"), not
      // invented, so the mutant stays a faithful shape rather than a synthetic
      // string that a fixture could be said not to have asked about.
      // EVERY constraint site, not just the first: a binding whose name already
      // has a legitimate edge from the same source (`references onlyShapes -> T`
      // from the parameter annotation) is not the defect, so the mutant has to
      // keep looking for a site whose binding is mentioned NOWHERE else. That is
      // what makes it a faithful revert rather than a duplicate-row injection —
      // and it is why the fixture needed a type parameter used nowhere
      // (`boundOnly<Q extends Shape>`), or the mutation would be
      // indistinguishable from correct behaviour.
      const out = [...rels(r)]
      for (const anchor of out) {
        if (normRel(anchor) !== "references") continue
        if (anchor?.metadata?.relationshipType !== "type_parameter_constraint") continue
        const sym = (r.symbols ?? []).find((s: any) => s.name === anchor.source)
        const gps: string[] = sym?.genericParameters ?? []
        for (const gp of gps) {
          const sp = gp.indexOf(" ")
          const binding = sp === -1 ? gp : gp.slice(0, sp)
          if (binding === "" || binding === String(anchor.target ?? "")) continue
          const already = out.some(
            (x: any) => normRel(x) === "references" && String(x.target ?? "") === binding && x.source === anchor.source,
          )
          if (already) continue
          out.push({
            source: anchor.source,
            target: binding,
            type: "references",
            confidence: 0.95,
            metadata: { relationshipType: "type_parameter_constraint" },
          })
          return { ...r, relationships: out }
        }
      }
      return r
    },
  },
  {
    id: "typescript/imports-mislabelled-as-references",
    language: "typescript",
    defectClass: "mislabelling",
    description:
      "IMPORTS_ENUM, from the OTHER side. Every relationship this analyzer publishes as `imports` published as `references` instead — the shape the differential reported as a references/use disagreement for this lane before IMPORTS_ENUM landed. A mislabelled edge and a missing edge are different defects and only this one is visible to bb_graph, bb_impact and bb_migrate's default traversal, which is un-narrowed (measured at 2.5-4.8x a filtered answer). Caught by typescript/re-export-module-dependency, whose expects are all `imports` rows.",
    transform: relabel("imports", "references"),
  },
  {
    id: "typescript/exports-not-emitted",
    language: "typescript",
    defectClass: "missing-whole-kind",
    description:
      "The lane's pre-M14 shape: the analyzer published an `exports` array and NO `exports` relationship for three of its export forms, so `bb_graph` could not answer what a module makes available. Retained as a defect class rather than retired because the star form still publishes no `exports` edge BY RULING — so the class is live, and a mutant that can still fail is the only kind worth keeping (a pin that cannot fail is a false assurance).",
    transform: dropType("exports"),
  },
  {
    id: "typescript/overrides-not-emitted",
    language: "typescript",
    defectClass: "missing-whole-kind",
    description:
      "`overrides` is the type the ontology sweep measured as silent in nine of twenty lanes, and it fires here only 80 times over 260 files — so it is the lane's most fragile type. A revert must fail: typescript/class-implements-interface-overrides expects four overrides rows, including the transitive one and the interface-implements one.",
    transform: dropType("overrides"),
  },
  // ⇒⇒⇒ THE THREE BEHAVIOURS THIS ROUND ADDED, EACH WITH A MUTANT THAT MUST DIE. A new emission
  // path with no mutant is an emission path the suite has not been shown to be able to detect — and
  // this lane has already published one SURVIVOR that turned out to be a NO-OP keyed on a metadata
  // name the analyzer never emits (L-2026-10-21-07). So each of these keys on the analyzer's OWN
  // spelling and each is aimed at a specific fixture row.
  {
    id: "typescript/mixes-in-not-emitted",
    language: "typescript",
    defectClass: "missing-whole-kind",
    description:
      "`mixes_in` is the lane's newest emission and its whole population is 2 edges, so a revert is invisible to the corpus and only a fixture can catch it. typescript/mixin-application expects `mixes_in Post -> Tagged`; dropping every `mixes_in` row must fail that expectation and nothing else.",
    transform: dropType("mixes_in"),
  },
  {
    id: "typescript/mixin-application-flattened-into-extends",
    language: "typescript",
    defectClass: "conflation",
    description:
      "THE DISCRIMINATOR IS THE SHAPE, SO THE MUTANT ERASES THE SHAPE. It rewrites every `mixes_in` edge into an `extends` edge, which is exactly the collapse a reader would get if the heritage clause's expression were never inspected: `class X extends Mixin(Base)` and `class X extends Base` would publish the same label. typescript/mixin-application forbids `mixes_in` for the PLAIN subclass and expects `extends` for it, so this mutant must die on the fixture's negative half — the half that found the real defect.",
    transform: (r: any) => {
      const out = rels(r).map((x: any) =>
        normRel(x) === "mixes_in" ? { ...x, type: "extends", relationshipType: undefined } : x)
      return { ...r, relationships: out }
    },
  },
  {
    id: "typescript/extends-base-name-is-the-whole-call",
    language: "typescript",
    defectClass: "fabrication",
    description:
      "THE DEFECT A FIXTURE'S NEGATIVE HALF ALREADY CAUGHT ONCE, PINNED SO IT CANNOT COME BACK SILENTLY. Before the fix, `class Post extends Tagged(Timestamped)` published an `extends` edge whose target was THE WHOLE CALL TEXT — a target that names no symbol. This mutant re-fabricates it by appending the call shape to every `extends` target that also has a `mixes_in` edge from the same source, which is precisely the old behaviour. typescript/mixin-application forbids an `extends` target ending in `(`, so it must die there.",
    transform: (r: any) => {
      const mix = new Set(rels(r).filter((x: any) => normRel(x) === "mixes_in")
        .map((x: any) => `${x.source}|${x.target}`))
      if (mix.size === 0) return r
      const out = rels(r).map((x: any) => {
        if (normRel(x) !== "extends") return x
        if (!mix.has(`${x.source}|${x.target}`)) return x
        return { ...x, target: `${x.target}(...)` }
      })
      return { ...r, relationships: out }
    },
  },
  {
    id: "typescript/reference-directive-not-emitted",
    language: "typescript",
    defectClass: "missing-whole-kind",
    description:
      "`part_of` is emitted from a node the SERVED grammar does not produce, so this mutant is the only way to prove the fixture would notice its absence: typescript/reference-directive expects three `part_of` rows (types, path, lib) and dropping them must fail all three.",
    transform: dropType("part_of"),
  },
]