/**
 * GO LANE MUTANTS — the go lane's own defect-class registry for M14.0.F4.
 *
 * WHY A LANE-OWNED FILE: `script/m14/mutate-analyzer.ts` is MASTER-owned, and
 * this registry has to be one list with one spread so the gate can prove every
 * mutant is caught. The fsharp lane established the shape — its fourteen mutants
 * live in `script/m14/fsharp-mutants.ts` and are spread into the master `MUTANTS`
 * array with one line — because "a mutant that is not registered is
 * indistinguishable from a defect class with no mutant", which is the hole F4
 * exists to close. The two lines of wiring are reported to master rather than
 * made here.
 *
 * `script/m14/tmp/go-mutant-run.ts` runs these against the real fixture runner
 * and prints each mutant's effect, so the lane can show its own gates failing
 * without waiting for the master wiring.
 *
 * Every transform below is a faithful revert of a shape the analyzer really
 * produced, expressed over the RESULT (never over a hardcoded name that would
 * silently stop matching when a fixture changes) except where noted.
 */
export interface GoMutant {
  id: string
  language: "go"
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

function normType(r: any): string {
  return String(r?.type ?? r?.relationshipType ?? "")
}

/** Drop every relationship of one type. Used by the two "missing-whole-kind"
 *  mutants, which are the shapes this lane actually had: `exports` and
 *  `overrides` were both emitted by nothing at all. */
function dropType(type: string) {
  return (r: any) => {
    if (!(r?.relationships ?? []).some((x: any) => normType(x) === type)) return r
    return { ...r, relationships: (r.relationships ?? []).filter((x: any) => normType(x) !== type) }
  }
}

/** Relabel one type as a neighbour. A mislabelled edge and a missing edge are
 *  different defects, and a suite that only ever loses edges cannot see the
 *  first: the label is what bb_graph, bb_impact and bb_migrate route on. */
function relabel(from: string, to: string) {
  return (r: any) => {
    if (!(r?.relationships ?? []).some((x: any) => normType(x) === from)) return r
    return {
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        normType(x) === from ? { ...x, type: to } : x,
      ),
    }
  }
}

export const GO_MUTANTS: GoMutant[] = [
  {
    id: "go/exports-not-emitted",
    language: "go",
    defectClass: "missing-whole-kind",
    description:
      "PRE-FIX (2026-10-02 ontology round): the lane published an `exports: ExportInfo[]` array and NO `exports` relationship, so `bb_graph` could not answer what a package makes available. MEASURED as a real construct first — the Go spec's capitalized-identifier rule is a CONVENTION, so the ontology gate's grammar inventory is blind to it and probe B1 on the tree counts it instead. Caught by go/exports-spec, which expects five `exports` edges from the package symbol.",
    transform: dropType("exports"),
  },
  {
    id: "go/overrides-not-emitted",
    language: "go",
    defectClass: "missing-whole-kind",
    description:
      "PRE-FIX: `collectGoPromotedMethods` computed that an outer method shadows a promoted one and DISCARDED the promoted method without recording the displacement, so no `overrides` edge existed although the analyzer held the evidence. Same defect shape as bash's omitted `overrides`. Caught by go/override-promotion, which expects `Wrapper.Report -> Shape.Report` and `Wrapper.Name -> Shape.Name`.",
    transform: dropType("overrides"),
  },
  {
    id: "go/overrides-relabelled-extends",
    language: "go",
    defectClass: "relationship-mislabel",
    description:
      "Method shadowing published on the `extends` label — the nearest neighbour, since the embedding itself is already an `extends` edge and a shadow is a relation between the two types. This is the label confusion the ontology asks about directly (Part 1 q4): the edge would read as inheritance while the fact is displacement. Caught by go/override-promotion, whose expectation names the `overrides` label and whose `extends` pin is scoped to `Wrapper -> Shape`.",
    transform: relabel("overrides", "extends"),
  },
  {
    id: "go/overrides-endpoint-unqualified",
    language: "go",
    defectClass: "fabricated-name-spelling",
    description:
      "The `overrides` endpoints published as the bare method leaf (`Report -> Report`) instead of the family's `Receiver.Method` qualified spelling. Go method names are not package-scope names — `Report` is declared on Shape, Wrapper and Counter in one file — so the unqualified form cannot name which declaration shadows which, and it collides with the `uses`/`contains` leaf surface. Caught by go/override-promotion, whose expectations name `Wrapper.Report` and `Shape.Report`.",
    transform: (r: any) => {
      const hits = (r?.relationships ?? []).filter((x: any) => normType(x) === "overrides")
      if (hits.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          normType(x) === "overrides"
            ? { ...x, source: String(x.source).split(".").pop(), target: String(x.target).split(".").pop() }
            : x,
        ),
      }
    },
  },
  {
    id: "go/overrides-name-only-to-signature-only",
    language: "go",
    defectClass: "dropped-construct",
    description:
      "The name-only shadow match replaced with a signature-compatible-only one — the shape the analyzer's own promotion dedupe uses for interface satisfaction. Both are defensible rules; only one is Go's selector rule. `Wrapper.Name()` hides a promoted `Shape.Name(string)` with a DIFFERENT signature, and Go selects Wrapper's for `w.Name()`, so a signature-only match under-reports the relationship by exactly the hiding cases. Caught by go/override-promotion, which pins `Wrapper.Name -> Shape.Name` and forbids the promoted-only `Wrapper.Area -> Shape.Area`.",
    transform: (r: any) => {
      const hits = (r?.relationships ?? []).filter((x: any) => normType(x) === "overrides")
      if (hits.length === 0) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(normType(x) === "overrides" && x?.metadata?.sameSignature === false),
        ),
      }
    },
  },
  {
    id: "go/exports-source-not-the-package",
    language: "go",
    defectClass: "wrong-endpoint",
    description:
      "The `exports` source set to the FILE path instead of the package symbol. An `imports` edge legitimately names a module path as its source, and the two sit in the same phase of `analyze()` — so the wrong source is one identifier away, and it makes every export edge unattributable to a module. Caught by go/exports-spec, whose expectations pin `source: \"exports\"` for all five edges.",
    transform: (r: any) => {
      const module = (r?.symbols ?? []).find((s: any) => String(s.kind).toLowerCase() === "module")
      if (!module || !(r?.relationships ?? []).some((x: any) => normType(x) === "exports")) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          normType(x) === "exports" ? { ...x, source: "/some/path/fixture.go" } : x,
        ),
      }
    },
  },
  {
    id: "go/exports-includes-function-local-type",
    language: "go",
    defectClass: "fabricated-edge",
    description:
      "THE MUTANT FOR A DEFECT THAT WAS LIVE, not a shape this lane once had. `exports` published for a type declared INSIDE a function body — `exports cobra -> UserCompletionTypeHelper` for `type UserCompletionTypeHelper func(...)` at cobra/completions_test.go:2946. It happened because the edge read the PHASE-5 `exports` ARRAY, whose predicate is `!ownerName`, and GO38 deliberately publishes a function-local type as a SYMBOL (a local var/const is not a symbol, but a local TYPE is, because the declared-type pass attributes that type's field types to it). The symbol carries no ownerName, so the array accepted it, and the edge published `exportForm: \"capitalized_package_scope_name\"` on a declaration that is not at package scope at all. Go does not export it: the name has no reach beyond the function that declares it. Caught by go/exports-spec, whose `scopeBoundary` body declares `type localUnit struct{ n int }` and whose expectations FORBID `exports -> localUnit` while still REQUIRING the `contains localUnit -> n` edge, so the mutant cannot be satisfied by deleting the symbol.",
    transform: (r: any) => {
      const mod = (r?.symbols ?? []).find((s: any) => String(s.kind).toLowerCase() === "module")
      if (!mod) return r
      const present = new Set((r?.symbols ?? []).map((s: any) => String(s.name)))
      const added = [...present]
        .filter((n) => /^[A-Z]/.test(n) && !(r?.relationships ?? []).some((x: any) => normType(x) === "exports" && String(x.target) === n))
        .slice(0, 4)
        .map((name) => ({
          source: mod.name,
          target: name,
          type: "exports",
          confidence: 1,
          metadata: { relationshipType: "go_exported_identifier", exportForm: "capitalized_package_scope_name", evidenceClass: "structural" },
        }))
      if (added.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...added] }
    },
  },
  {
    id: "go/exports-drops-lowercase-only",
    language: "go",
    defectClass: "swallowed-predicate",
    description:
      "The exported-ness test made case-INSENSITIVE, so `helper` and `modeTable` publish `exports` edges. Go's rule is not 'is it a name' but 'does its FIRST CHARACTER begin an upper-case Unicode letter'; a predicate that stops discriminating cannot tell an exported identifier from an unexported one, and the edge then claims a package publishes something an importer cannot name. Caught by go/exports-spec, which forbids `exports -> helper` and `exports -> modeTable`.",
    transform: (r: any) => {
      const mod = (r?.symbols ?? []).find((s: any) => String(s.kind).toLowerCase() === "module")
      if (!mod) return r
      const present = new Set((r?.symbols ?? []).map((s: any) => String(s.name)))
      const added = [...present]
        .filter((n) => /^[a-z_]/.test(n))
        .slice(0, 4)
        .map((name) => ({
          source: mod.name,
          target: name,
          type: "exports",
          confidence: 1,
          metadata: { relationshipType: "go_exported_identifier", evidenceClass: "structural" },
        }))
      if (added.length === 0) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...added] }
    },
  },
]