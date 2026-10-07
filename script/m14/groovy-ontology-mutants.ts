/**
 * GROOVY ONTOLOGY MUTANTS — the lane's regression mutants for the M14.0.F4 gate,
 * covering the two relationship labels added in the ontology pass (`imports`,
 * `exports`).
 *
 * WHY THIS IS A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is the shared registry
 * several lanes edit concurrently, so this lane's work lives in a file it owns and the
 * shared file needs a two-line import plus a spread — the arrangement
 * `script/m14/fsharp-mutants.ts` documents at length (a 259-line block written into the
 * shared registry was overwritten within the hour by another lane's edit, and the
 * overwrite was SILENT). The registration is reported to the owner rather than made
 * here, because `script/m14/**` is not this lane's to edit.
 *
 * WHAT A MUTANT IS HERE. Each entry is a revert of one behaviour the ontology pass
 * introduced, applied to the analyzer's OUTPUT — the same mechanism M14.0.F4 uses for
 * every lane. Three of them are REVERTS to the exact pre-change state (the label did not
 * exist), so they are the honest regression guards for the two new labels. Four are the
 * PLAUSIBLE WRONG FIXES: an implementer who closed the gap the other way would produce
 * each of them, and an expect-only matcher cannot see any of them because in every one
 * of those states the expected rows are still present.
 *
 *   id                                        what it reverts                       caught by
 *   groovy/imports-label-drop                 the label itself (pre-change)         imports-dependency
 *   groovy/imports-source-unrewritten         the source stays the package          imports-dependency
 *   groovy/imports-alias-target               the ALIAS enters the target           imports-dependency
 *   groovy/imports-shape-mislabelled          every form claims `single_type`       imports-dependency
 *   groovy/exports-label-drop                 the label itself (pre-change)         exports-publication
 *   groovy/exports-member-leak                a MEMBER is published (JAD3)exports-publication
 *   groovy/exports-default-package-leak       a default-package unit is published   default-package-unit
 *   groovy/exports-private-leak               a non-public top-level type publishes exports-publication
 */

export interface GroovyOntologyMutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (r: any, sourceText?: string) => any
}

const relType = (x: any): string => String(x?.type ?? x?.relationshipType ?? "")
const md = (x: any): any => x?.metadata ?? {}

export const GROOVY_ONTOLOGY_MUTANTS: GroovyOntologyMutant[] = [
  {
    id: "groovy/imports-label-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description:
      "Ontology `imports` regression: the label does not exist at all — the exact pre-change state, measured at 0 `imports` edges over 10,621 import declarations in 2,374 files of the pinned corpus. The dependency survives under `references`, so nothing else in the lane notices: the mention is still there and the graph still has the module. Caught by groovy/imports-dependency, whose six `imports` expectations all vanish (its `references` expectation still passes, which is the point: this defect is invisible to a mention-only pin).",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== "imports") }),
  },
  {
    id: "groovy/imports-source-unrewritten",
    language: "groovy",
    defectClass: "identity-corruption",
    description:
      "Ontology `imports` regression: the edge keeps the pre-rewrite source. Imports precede type declarations in a compilation unit, so the emit-side source is the package and is rewritten to the file's primary type after the walk; an edge left at the package names a node that is not a symbol, so it can never bind at either end. Caught by groovy/imports-dependency, which pins `source: \"Importer\"` on every one of its six rows.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "imports") return x
        const t = String(x.target ?? "")
        const dot = t.lastIndexOf(".")
        return dot > 0 ? { ...x, source: t.slice(0, dot) } : x
      }),
    }),
  },
  {
    id: "groovy/imports-alias-target",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "Ontology `imports` regression: the ALIAS is folded into the target. `import static java.util.Collections.emptyList as nothing` would publish `java.util.Collections.emptyList as nothing`, a string no other file writes and no importer can join — the dependency stops being a dependency. This is the plausible wrong fix, because keeping the alias in one place and reading it in the other is the shorter edit. Caught by groovy/imports-dependency, whose forbid list names both the aliased target and the bare alias.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "imports" || md(x).hasAlias !== true) return x
        // `hasAlias` is the analyzer's own record of the declaration, so the alias NAME
        // is recovered from the row's own target plus a name the source writes; the
        // point of the mutant is the target's SHAPE, not which alias it picked.
        return { ...x, target: `${x.target} as aliased` }
      }),
    }),
  },
  {
    id: "groovy/imports-shape-mislabelled",
    language: "groovy",
    defectClass: "relationship-mislabelling",
    description:
      "Ontology `imports` regression: every form claims `single_type`. A consumer asking \"does this file depend on a TYPE, on a PACKAGE, or on a STATIC MEMBER?\" gets the same answer four times, and the wildcard target (`java.util.concurrent` for `java.util.concurrent.*`) becomes indistinguishable from a single-type import of that same package. Caught by groovy/imports-dependency, which pins `on_demand_type`, `static_member` and `static_on_demand` on three separate rows — an expect-only matcher for the targets alone would pass in this state.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        relType(x) === "imports" ? { ...x, metadata: { ...md(x), relationshipType: "single_type" } } : x),
    }),
  },
  {
    id: "groovy/exports-label-drop",
    language: "groovy",
    defectClass: "relationship-loss",
    description:
      "Ontology `exports` regression: the label does not exist at all — the exact pre-change state. The analyzer still computed the importable-unit set and stored it as `ExportInfo`, so every existing `expectExports` pin still passes and the defect is invisible to them; measured before the change, 3,734 top-level types and 1,157 top-level script methods were computed and dropped. Caught by groovy/exports-publication's `expectRelationships` rows.",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => relType(x) !== "exports") }),
  },
  {
    id: "groovy/exports-member-leak",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "Ontology `exports` regression: MEMBERS are published again. This is java's JAD3 half, reversed in writing by the M49 convergence ruling (reviews/jvm-closure-audit.md: exports = importable units, membership rides Contains) — and it is the pre-ruling java/groovy behaviour, so it is a revert of a decision rather than of code. A `contains` edge already carries membership, so the row is a duplicate under a label that claims publication. Caught by groovy/exports-publication, whose forbid list names a method, a field and an enum member, and whose `forbidExports` list names the same three on the ExportInfo side.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        ...(r.symbols ?? [])
          .filter((s: any) => s.ownerName && md(s).nodeType !== "record_component")
          .map((s: any) => ({
            source: String(s.ownerName ?? ""),
            target: String(s.name ?? ""),
            type: "exports",
            confidence: 1.0,
            metadata: { isGroovyExport: true, relationshipType: "exported_type" },
          })),
      ],
    }),
  },
  {
    id: "groovy/exports-default-package-leak",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "Ontology `exports` regression: a unit in the DEFAULT package is published. A Groovy type declared with no `package` declaration compiles into the unnamed package, which has no importable name — another compilation unit cannot write `import DefaultPkg`, so the row claims a reachability the language denies. Measured exposure on the pinned corpus: 270 of 2,825 files declare no package, so a package-blind rule fabricates on ~10% of real files. Caught by groovy/default-package-unit, a fixture that exists only for this and pins nothing else.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
          // Built from the SYMBOL payload, not from `r.exports`: the analyzer's
          // ExportInfo list is the M49 top-level-unit rule and is deliberately NOT
          // package-gated, while the EDGE is. Reading the list here would make this
          // mutant a no-op and it would "pass" for the wrong reason.
        ...(r.symbols ?? [])
          .filter((s: any) => !s.ownerName && !md(s).isAnonymousClass && !md(s).isPhantom)
          .map((s: any) => ({
            source: "(script)",
            target: String(s.name ?? ""),
            type: "exports",
            confidence: 1.0,
            metadata: { isGroovyExport: true, relationshipType: "exported_type" },
          })),
      ],
    }),
  },
  {
    id: "groovy/exports-private-leak",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "Ontology `exports` regression: the visibility gate is gone, so a top-level type that is NOT public is published. Simulated from the analyzer's own symbol payload rather than from a name filter: every top-level type symbol whose recorded `visibility` is not `public` gains the row the gate withheld. Measured on the pinned corpus, 5 top-level types are written `private` and 1 `protected` (against 3,689 with no modifier written — Groovy's default IS public), so the gate costs 6 rows on real code and saves 6 fabrications. Caught by groovy/exports-publication, whose two non-public top-level types are pinned as forbidden on both the edge and the ExportInfo side.",
    transform: r => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        ...(r.symbols ?? [])
          .filter((s: any) => !s.ownerName && !md(s).isAnonymousClass && s.visibility && s.visibility !== "public")
          .map((s: any) => ({
            source: String(s.ownerName ?? "(script)"),
            target: String(s.name ?? ""),
            type: "exports",
            confidence: 1.0,
            metadata: { isGroovyExport: true, relationshipType: "exported_type" },
          })),
      ],
    }),
  },
]
/**
 * The R7 mutants: an empty name, and an edge whose SOURCE is a name no symbol carries.
 *
 * Both are the SAME root cause seen twice — a MISSING identifier node exists with an
 * empty `.text`, and two different pieces of code adopted that empty string as a name —
 * and both were measured on the pinned corpus before the fix (6 empty-named method
 * symbols; 11 `uses` rows with an empty source in one file alone). They are here because
 * a fixture that forbids `{ name: "" }` and `{ from: "" }` passes when the analyzer emits
 * an empty name only in a file the fixture does not contain, and the corpus is where
 * those files are.
 */
export const GROOVY_R7_MUTANTS: GroovyOntologyMutant[] = [
  {
    id: "groovy/empty-name-symbol",
    language: "groovy",
    defectClass: "symbol-fabrication",
    description:
      "R7 regression: a declaration whose name came back EMPTY is published as a symbol. The `if (nameNode)` guard does not catch it because a MISSING node is present with empty text — measured at 6 empty-named method symbols on the pinned corpus, all from the `@Unparsed` annotation shape the pinned grammar reads as `name: (MISSING identifier)`. An empty name is not a name, and it lands in the index and in every `contains` row that names it. Caught by groovy/empty-name-refusal, whose `forbidSymbols` row names the empty string.",
    transform: r => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "", kind: "method", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } }],
    }),
  },
  {
    id: "groovy/empty-name-read-source",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "R7 regression: a read inside an UNNAMED method is sourced at the empty string — the exact pre-fix emission, `uses \"\" -> length` (11 such edges in subprojects/groovy-groovysh GroovyCommands.groovy alone). An edge whose source names nothing cannot bind at either end and no consumer can follow it. Caught by groovy/empty-name-refusal's `forbidRelationships` rows on `from: \"\"`.",
    transform: r => ({
      ...r,
      relationships: [...(r.relationships ?? []), { source: "", target: "length", type: "uses", confidence: 0.6, metadata: { isFieldAccess: true, evidenceClass: "usage_contextual" } }],
    }),
  },
  {
    id: "groovy/misnamed-ctor-read-owner",
    language: "groovy",
    defectClass: "relationship-mislabelling",
    description:
      "Attribution regression: every `constructor_declaration` maps to the literal `constructor` again, so an ANNOTATED method with a parameter list — which the pinned grammar reads as a constructor node, and which the symbol path already demotes — emits `method handler` and then attributes that method's own reads to `constructor`. The row names a symbol the file does not have, so it cannot bind to the method it came from. Caught by groovy/empty-name-refusal, which pins `uses handler -> length` and forbids `uses constructor -> length`.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses") return x
        const owners = new Set<string>()
        for (const s of r.symbols ?? []) if (s.ownerName && s.kind === "method") owners.add(String(s.name))
        return owners.has(String(x.source)) ? { ...x, source: "constructor" } : x
      }),
    }),
  },
]

/**
 * The receiver mutants (M60 ontology pass). Two, because there are two ways this
 * edge can be wrong and an expect-only matcher sees neither: the source is a TEXT
 * FRAGMENT of an expression, or the source is silently the receiver itself.
 *
 * `groovy/receiver-text-fragment` restores `node.text.split(".")[0]` — the exact
 * pre-fix emission, so it is the honest regression guard for this fix. It is
 * expressible as an output transform because the pre-fix source is recoverable
 * from the analyzer's own `groovyCallExpression`-style payload... except it is
 * not: a `uses` row carries no receiver text. So this mutant reconstructs the
 * fragment from the SOURCE TEXT rather than from the row, which is what the
 * analyzer did, and the reconstruction is exact for the three shapes the fixture
 * contains (verified: its failure output names `new File(dir)`, `verdicts[0]`
 * and `(m)`, which are precisely the `forbidRelationships` rows).
 *
 * `groovy/receiver-as-source` is the plausible wrong fix in the other direction: an
 * implementer who decided the receiver IS the reader would source the read at
 * `first` unconditionally. Every expected row in the fixture would still be
 * present — the member, the line and the type are all right — and only the SOURCE
 * would name a local variable that this lane deliberately does not publish as a
 * symbol, so the edge would bind at neither end.
 */
export const GROOVY_RECEIVER_MUTANTS: GroovyOntologyMutant[] = [
  {
    id: "groovy/receiver-text-fragment",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "R7 regression, exact pre-fix state: the field-read walk takes the receiver from `node.text.split(\".\")[0]`, so a receiver that is an expression yields a text fragment as the relationship SOURCE — measured on the pinned corpus by script/m60/groovy-r7-census.ts as `malformedNameEndpoints` (the corpus count is in the commit that closed it). Caught by groovy/receiver-not-a-name, whose three `forbidRelationships` rows name `new File(dir)`, `verdicts[0]` and `(m)` exactly.",
    transform: (r: any, sourceText?: string) => {
      if (!sourceText) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) => {
          if (relType(x) !== "uses" || !md(x).isFieldAccess) return x
          // Recover the pre-fix source: the enclosing method's body, the text
          // before the first `.` of a member access whose receiver is not a plain
          // identifier. Reading the SOURCE rather than the row is the point — the
          // pre-fix emission is unrecoverable from the row, which is why the
          // mutation harness transforms output at all.
          const src = String(x.source ?? "")
          const re = new RegExp(
            `(?:new [A-Za-z_$][\\w.$]*\\([^\\n]*?\\)|[A-Za-z_$][\\w.$]*\\[[^\\n]*?\\]|\\([^\\n()]*?\\))\\.${String(x.target).replace(/[$]/g, "\\$")}`,
            "g",
          )
          const m = re.exec(sourceText)
          if (!m) return x
          const frag = m[0].slice(0, m[0].lastIndexOf("."))
          if (!frag || frag === src) return x
          return { ...x, source: frag }
        }),
      }
    },
  },
  {
    id: "groovy/receiver-as-source",
    language: "groovy",
    defectClass: "identity-corruption",
    description:
      "Attribution regression: the read is sourced at the RECEIVER rather than at the enclosing method — the plausible wrong fix, and invisible to an expect-only matcher because every expected row keeps its member, its line and its type. The row would name a local variable or a script binding that this lane deliberately does not publish as a symbol, so it binds at neither end. Caught by groovy/receiver-not-a-name, whose CONTROL 1 row pins the enclosing method as the source of a read whose receiver is a plain identifier.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses" || !md(x).isFieldAccess) return x
        return { ...x, source: String(x.target) }
      }),
    }),
  },
  {
    id: "groovy/leaf-text-slice",
    language: "groovy",
    defectClass: "relationship-fabrication",
    description:
      "R7 regression, the other half of the same defect: the MEMBER is taken from `node.text.split('.')`'s last segment rather than from the access node's `field` field, so a member written as a string literal keeps its quotes. Measured on the pinned corpus: `xml.properties.'maven.compiler.release'.text()` — the Gradle DSL spelling of a dotted property key, and a common shape there — published `uses xml -> release'`, an endpoint containing a quote that appears in no name. Probe-verified node shape: that access's `field` child is a `character_literal` whose value is `maven.compiler.release`, so the node carries the name and the text slice threw it away. Caught by groovy/receiver-not-a-name, whose `forbidRelationships` row names `release'` and whose `expectRelationships` row names `maven.compiler.release`.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (relType(x) !== "uses" || !md(x).isFieldAccess) return x
        const t = String(x.target ?? "")
        if (!t.includes(".")) return x
        const last = t.slice(t.lastIndexOf(".") + 1)
        // Only the defect's own shape: a leaf that lost its leading segments to a
        // quoted key. A dotted leaf that is already a plain name is untouched, so the
        // mutant cannot be caught by an unrelated pin.
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(last)) return x
        return { ...x, target: last }
      }),
    }),
  },
]
