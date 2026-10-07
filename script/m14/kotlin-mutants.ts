/**
 * KOTLIN MUTANTS — the defects this lane's fixtures must be able to catch.
 *
 * ## Why this is a separate module
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8: report the
 * need, do not edit it), and the established precedent for a lane that needs a
 * mutant before the wiring line lands is `script/m14/nim-mutants.ts` +
 * `validation/m14/fixtures/nim/verify-mutants.ts`. This file is the kotlin half of
 * that precedent. The wiring is ONE line in the shared harness —
 * `import { KOTLIN_MUTANTS } from "./kotlin-mutants"` beside the FSHARP/NIM
 * imports, and `...KOTLIN_MUTANTS,` in the `MUTANTS` array — and it is REPORTED in
 * the handover, not applied.
 *
 * `validation/m14/fixtures/kotlin/verify-mutants.ts` runs these transforms through
 * the shared `runLang` with the harness's own caught/survived rule, so the numbers
 * are the harness's numbers and not a second opinion about them.
 *
 * ## What a mutant is
 *
 * A transform over the analyzer's RESULT reproducing a defect this lane actually
 * had or could plausibly acquire. Output transforms, not source surgery —
 * equivalent at the suite level (the harness's own declared limitation) and not
 * sensitive to formatting.
 *
 * ## The two waves here
 *
 *   DERIV_EXPORTS_KOT4 — the `exports` edges this round added. A fixture that
 *   pins only "the edge exists" catches neither a wrong label nor a wrong
 *   membership, so the wave is four: a mislabel, a payload loss, a membership
 *   widening (the pre-fix-era `ownerKind === Class` hole, which exported every
 *   member), and the store-shaped source swap (`(file)` -> the package name,
 *   which the store's own defensive filter deletes at insert time — a defect the
 *   ANALYZER cannot see failing, which is exactly why it needs a pin).
 *
 *   R7 round — the empty-name defect the corpus census measured: 2 empty symbol
 *   names and 5 edges whose source or target was the empty string. Two mutants:
 *   restore the empty-name publication, and restore the empty-endpoint edge.
 */

export interface KotlinMutant {
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

export const KOTLIN_MUTANTS: KotlinMutant[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // DERIV_EXPORTS_KOT4 — `exports` (kotlin visibility surface)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "kotlin/exports-labelled-references",
    language: "kotlin",
    defectClass: "wrong-relationship-type",
    description:
      "An export edge is filed as `references` — its neighbouring type in the ontology, and " +
      "the one the import edges already use, so the mistake is a plausible copy-paste rather " +
      "than a slip. `references` asserts that a declaration NAMES a type; `exports` asserts that " +
      "a file PUBLISHES a name, and a consumer answering \"what does this file offer\" reads only " +
      "the latter. " +
      "Caught by kotlin/exports-visibility, which pins seven `exports` edges from `(file)`.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "kotlin/exports-payload-dropped",
    language: "kotlin",
    defectClass: "relationship-payload-loss",
    description:
      "The export edge keeps its type and endpoints but loses the payload that says WHICH fact " +
      "published the name (`via`: an explicit `public` versus kotlin's public-by-default), the " +
      "resolved `visibility`, the `symbolKind`, and the `fileLevel` flag that tells the store the " +
      "source is the file. Without `fileLevel` the store does not rewrite `source_external` to " +
      "the project-relative path, so every kotlin export row lands naming `(file)` instead of a " +
      "path — the edge exists and identifies no file. " +
      "Caught by kotlin/exports-visibility, which pins `meta.via` and `meta.fileLevel` on " +
      "individual edges rather than only counting them.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports"
          ? {
              ...x,
              metadata: {
                ...(x.metadata ?? {}),
                via: undefined,
                visibility: undefined,
                symbolKind: undefined,
                fileLevel: undefined,
              },
            }
          : x,
      ),
    }),
  },
  {
    id: "kotlin/exports-includes-members",
    language: "kotlin",
    defectClass: "relationship-membership",
    description:
      "Membership widens to every owner-bearing symbol — the pre-KAD-MR3-K1 `ownerKind === Class` " +
      "hole that exported every member of every class. Membership of a member rides `contains` " +
      "(the store resolves `contains` structurally, by the edge's own line, and `exports` by " +
      "name), so exporting members both double-counts them and inflates every export row with " +
      "names no consumer can import directly. " +
      "Caught by kotlin/exports-visibility's forbid rows on `member`, `visible` and `hidden`.",
    transform: (r: any) => {
      const owned = new Set<string>()
      for (const s of r.symbols ?? []) {
        if (s.ownerName) owned.add(s.ownerName)
      }
      if (!owned.size) return r
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (!s.ownerName || !owned.has(s.ownerName)) continue
        if ((r.relationships ?? []).some((x: any) => x.type === "exports" && x.target === s.name)) continue
        extra.push({
          source: "(file)",
          target: s.name,
          type: "exports",
          confidence: 1,
          metadata: { kotlinSpecific: true, via: "member-leak", fileLevel: true },
        })
      }
      return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
    },
  },
  {
    id: "kotlin/exports-source-is-package",
    language: "kotlin",
    defectClass: "store-shape",
    description:
      "The edge's source becomes the FILE'S PACKAGE instead of `(file)`, which reads as a " +
      "better identity. It cannot survive the store: parallel-indexer.ts:3453 drops an `exports` " +
      "edge whose source is a lowercase dotted name, exactly as `org.jetbrains.kotlin.config` is, " +
      "so every kotlin export row would be deleted at insert time and the type would report as " +
      "emitted at zero rows stored. This is the defect class the analyzer cannot detect by " +
      "looking at its own output, which is why it needs a pin rather than a probe. " +
      "Caught by kotlin/exports-visibility's `from: (file)` pins and its forbid row on the " +
      "package name.",
    transform: (r: any) => {
      // The package is read off the analyzer's OWN scope, never off the source
      // text: a top-level symbol's scope is the package, and reading it keeps this
      // file free of the text-matching the lane forbids outright (and keeps the
      // mutant honest when a fixture has no package header at all).
      const top = (r.symbols ?? []).find((s: any) => !s.ownerName && typeof s.scope === "string" && s.scope.length > 0)
      const pkg = top?.scope
      if (!pkg) return r
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "exports" ? { ...x, source: pkg, metadata: { ...(x.metadata ?? {}), fileLevel: undefined } } : x,
        ),
      }
    },
  },
  // ═══════════════════════════════════════════════════════════════════════
  // R7 round — the empty name / empty endpoint defect the census measured
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: "kotlin/empty-symbol-name-restored",
    language: "kotlin",
    defectClass: "placeholder-name",
    description:
      "The pre-fix publication returns: a declaration whose name node is present but " +
      "ZERO-LENGTH (tree-sitter's ERROR recovery on IntelliJ `<caret>` / `<expr>` test markup) " +
      "is published with `name: \"\"`. Measured before the fix on the kotlin corpus: 2 such " +
      "symbols in a 405-file census, and because the same \"\" flowed into the derivations that " +
      "read `cls.name`, 5 edges whose SOURCE was the empty string. An empty name is not a name — " +
      "the file's ParseError already reports the ERROR node, so absence is the honest state " +
      "(R7, validation/m60/ledger.json). " +
      "Caught by kotlin/exports-visibility's forbid rows and by the lane census, which counts " +
      "empty symbol names as a standing-rule violation rather than a curiosity.",
    transform: (r: any) => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "", kind: "class", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} }],
    }),
  },
  {
    id: "kotlin/empty-edge-endpoint-restored",
    language: "kotlin",
    defectClass: "placeholder-name",
    description:
      "An edge with an EMPTY endpoint is published again — the state that put 5 rows into the " +
      "graph naming no participant (`source_symbol_id = NULL`, `source_external = ''`). " +
      "Caught by kotlin/exports-visibility's forbid rows, and countable by the lane census, " +
      "which reports `R7 bad` per relationship type.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          source: "",
          target: "AlsoPublished",
          type: "implements",
          confidence: 1,
          metadata: { relationshipType: "kotlin_implements" },
        },
      ],
    }),
  },
  {
    id: "kotlin/keyword-read-as-type-name",
    language: "kotlin",
    defectClass: "placeholder-name",
    description:
      "The second R7 mechanism returns: a name node that carries a KEYWORD rather than an " +
      "empty string. tree-sitter's recovery for IntelliJ context-parameter markup hands the " +
      "constructor keyword to the analyzer as a direct named child typed as a type_identifier, " +
      "with the real name buried inside an ERROR node, so the pre-fix analyzer published " +
      "`class constructor` for a file declaring `Foo`. Measured over the construct's own corpus " +
      "population (all 2,033 tracked .kt/.kts containing the fixed string `context(`): 2 such " +
      "symbols before the fix, 0 after. " +
      "Caught by kotlin/type-name-keyword-recovery, whose expectSymbolCount pins zero TYPE " +
      "symbols named `constructor` and exactly one METHOD of that name — the soft-keyword control, " +
      "so the mutant that also drops the legal function cannot hide behind the rule.",
    transform: (r: any) => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "constructor", kind: "class", range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, metadata: {} },
      ],
    }),
  },
  {
    id: "kotlin/secondary-ctor-source-is-placeholder",
    language: "kotlin",
    defectClass: "placeholder-name",
    description:
      "Edges written inside a SECONDARY constructor are attributed to the literal `constructor` " +
      "again. The M14 #419 K11 rule says such edges belong to the class name, and the rule was " +
      "implemented as `node.parent -> name`, which is true for a primary_constructor (its parent " +
      "IS the declaration) and false for a secondary_constructor (its parent is the class_body) — " +
      "so the rule was half implemented for every secondary constructor in the corpus. Measured: " +
      "60 endpoints over a 405-file census. " +
      "Caught by kotlin/ctor-delegation, whose delegation edges are now expected FROM `Derived` " +
      "and whose forbid row names the placeholder source — that forbid row is the load-bearing " +
      "half, because an expectation alone would also pass if both spellings were emitted.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = x.metadata ?? {}
        if (md.relationshipType === "constructor_invocation") return { ...x, source: "constructor" }
        return x
      }),
    }),
  },
]
