/**
 * CSHARP MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY A SEPARATE FILE. `script/m14/mutate-analyzer.ts` holds the master `MUTANTS`
 * registry and the workstream's ownership table gives it to MASTER. The fsharp lane
 * established the precedent this follows (`script/m14/fsharp-mutants.ts`, spread in with
 * one import line): a lane that keeps its mutants in a file the lane owns cannot have
 * them silently overwritten by a concurrent edit, and the two lines of wiring this needs
 * are REPORTED to master rather than made here. `script/m14/tmp/cs-ont-06-mutants.ts`
 * runs them in the meantime, so the reds are demonstrated rather than claimed.
 *
 * WHAT EACH MUTANT IS. F4's rule is that a deliberately injected defect MUST make the
 * suite red; a surviving mutant fails THE SUITE, not the mutant. Each entry is a faithful
 * revert of one class, and each names the fixture that must catch it.
 *
 * The four ontology mutants are reverts of the two relationships this lane added and of
 * the two corrections the measurement forced while adding them — the mutants exist so
 * that a later widening of a rule (drop the visibility test, drop the top-level test,
 * publish the alias, publish the whole expression) cannot pass the suite quietly.
 */
import type { Mutant } from "./mutate-analyzer"

export const CSHARP_MUTANTS: Mutant[] = [
  {
    id: "csharp/drop-imports-edges",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "ONTOLOGY revert: drops every `imports` relationship while leaving the `imports[]` payload and the `references` twin alone — the exact state this lane was measured in (0 `imports` relationships over 269,352 on 1,200 roslyn files, 8,941 `references` rows already carrying metadata.isImport). Caught by csharp/import-export-edges, whose 9 `imports` expects all vanish.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => x.type !== "imports"),
    }),
  },
  {
    id: "csharp/drop-exports-edges",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "ONTOLOGY revert: drops every `exports` relationship and keeps the `exports[]` payload — the shape the r lane's own comment describes ('the exported surface existed in the parse result but in no relationship, so it was absent from graph_usages' exports view and from relations.ts' declaration set'). Caught by csharp/import-export-edges (4 expects) and csharp/export-global-scope (1 expect).",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => x.type !== "exports"),
    }),
  },
  {
    id: "csharp/override-methods-only",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "CS-ONT4 revert: drops every `override` edge whose `overriddenMemberKind` is not `method`, which is the pre-fix state exactly — the only branch that pushed an OverrideTask was the method branch, so `public override int P => 1;` produced a symbol, a `contains` edge and a declared-type `references` edge and NO `overrides` edge. Found by the lane's own independent overrides oracle (cs-ont-07: 118 TRUTH-ONLY rows on 250 roslyn files), NOT by a fixture and NOT by the differential, because csharp's `overrides` is excluded from the compared set on both sides — which is why this class could sit under the DERIVATION finding unobserved. Caught by csharp/override-member-kinds (4 of its 8 expects).",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.type === "overrides" && (x.metadata ?? {}).overriddenMemberKind && x.metadata.overriddenMemberKind !== "method"),
      ),
    }),
  },
  {
    id: "csharp/override-field-tasks-per-declaration",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "The CS-ONT4 field fix done the coarse way: one task per `field_declaration` instead of one per DECLARATOR, so `public override int A, B;` — two members, and C# requires both on the base — publishes one edge instead of two. Pinned by csharp/override-member-kinds' two `FieldPair` rows, which exist only because the fixture's author noticed that a multi-declarator field declaration is the shape the coarse rule drops silently.",
    transform: (r: any) => {
      const rows = (r.relationships ?? []).filter((x: any) => x.type === "overrides" && (x.metadata ?? {}).overriddenMemberKind === "field")
      if (rows.length < 2) return r
      // ONE TASK PER DECLARATION is exactly "one edge per field-declaration LINE", because
      // every declarator of one declaration shares the declaration's line. Keying on
      // (source,target) instead would keep both rows — the two declarators are DIFFERENT
      // members — and the mutant would be a no-op that survives for the wrong reason, which
      // is what the first draft did.
      const seen = new Set<number | string>()
      const kept = rows.filter((x: any) => {
        const k = String(x.line_number ?? x.source)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      return {
        ...r,
        relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && (x.metadata ?? {}).overriddenMemberKind === "field")).concat(kept),
      }
    },
  },
  {
    id: "csharp/import-kind-flattened",
    language: "csharp",
    defectClass: "wrong-payload",
    description:
      "Import-kind loss: stamps every `imports` row with the same kind, which is what the graph looks like when the kind is not read at all — the state before this round, where `using X;`, `using static X;`, `using A = X;` and `global using X;` were one undifferentiated reference. All four kinds are pinned in csharp/import-export-edges, so flattening fails three of the four expectations and not the first, which is the point of pinning four: a fixture that pinned only the common shape would have passed.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), importKind: "namespace" } } : x,
      ),
    }),
  },
  {
    id: "csharp/export-any-visibility",
    language: "csharp",
    defectClass: "relationship-fabrication",
    description:
      "Export-surface widening: drops the `public` accessibility test, which is the pre-fix behaviour in its WORSE direction — the original rule also published every namespace-free top-level declaration whatever its visibility, and carried `visibility: \"internal\"` on the row while exporting the type. Caught by six forbid rows across the two export fixtures (InternalType, IInternalContract, InternalEnum, FileScopedInternal, GlobalScopeInternal and their qualified spellings).",
    transform: (r: any) => ({
      ...r,
      exports: (r.exports ?? []).map((e: any) => ({ ...e, name: String(e.name).split(".").pop() ?? e.name })),
      relationships: [
        ...(r.relationships ?? []),
        ...((r.exports ?? []) as any[]).map((e: any) => ({
          type: "exports",
          source: "root",
          target: String(e.name).split(".").pop(),
          confidence: 1.0,
          metadata: { relationshipType: "assembly_public_surface", evidenceClass: "structural" },
        })),
      ],
    }),
  },
  {
    id: "csharp/export-nested-types-too",
    language: "csharp",
    defectClass: "relationship-fabrication",
    description:
      "Top-level test removed: publishes EVERY public type declaration as an assembly export, including one nested inside another type. This is the defect the first version of the rule had — the fixture caught it while the rule was being written, and the forbid rows (`NestedPublic`, `PublicType.NestedPublic`) keep the fix from being undone by widening the visibility test alone. The mutant reads the nested types off the result's own SYMBOLS rather than off `result.exports`, because after the fix that array no longer contains them: a mutant that re-published the array unchanged would be a no-op and would SURVIVE for the wrong reason — the first draft did exactly that and was caught by the runner, which is the runner doing its job.",
    transform: (r: any) => {
      const exported = new Set(((r.exports ?? []) as any[]).map((e: any) => String(e.name)))
      const extra = (r.symbols ?? [])
        .filter((s: any) => s.ownerName && s.ownerKind && String(s.ownerKind) !== "namespace")
        .filter((s: any) => ["class", "struct", "interface", "enum", "delegate"].includes(String(s.kind)))
        .map((s: any) => String(s.metadata?.fullName ?? `${s.ownerName}.${s.name}`))
        .filter((n: string) => !exported.has(n))
      if (extra.length === 0) return r
      return {
        ...r,
        exports: [...(r.exports ?? []), ...extra.map((n: string) => ({ name: n, kind: "class" }))],
        relationships: [
          ...(r.relationships ?? []),
          ...extra.map((n: string) => ({
            type: "exports",
            source: "root",
            target: n,
            confidence: 1.0,
            metadata: { relationshipType: "assembly_public_surface", evidenceClass: "structural" },
          })),
        ],
      }
    },
  },
  {
    id: "csharp/using-alias-as-import-target",
    language: "csharp",
    defectClass: "relationship-fabrication",
    description:
      "The CSD7/R1 alias confusion on the NEW label: publishes an `imports` row whose target is the alias rather than the imported namespace/type — a dependency on a name the file imports nothing from. A new relationship label is a new opportunity for a defect class an older label already had once, which is why this revert exists on both labels and the fixture forbids both spellings.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        { type: "imports", source: "root", target: "Alias", confidence: 1.0, metadata: { importKind: "alias", evidenceClass: "import_based" } },
        { type: "imports", source: "root", target: "GlobalAlias", confidence: 1.0, metadata: { importKind: "global_alias", evidenceClass: "import_based" } },
      ],
    }),
  },
  {
    id: "csharp/drop-extern-alias-import",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "Drops the `extern_alias_directive` import row. The construct occurs 0 times in the 300-file roslyn draw, so no corpus measurement can hold it — `script/m14/tmp/cs-ont-05-import-kinds.ts` counts it over 3,000 files, and the fixture is what actually keeps the branch alive. A branch that only a fixture can test is a branch that will be deleted the first time the fixture is not run.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => (x.metadata ?? {}).relationshipType !== "extern_alias_import",
      ),
    }),
  },
  {
    id: "csharp/exports-as-usage-contextual",
    language: "csharp",
    defectClass: "wrong-payload",
    description:
      "Evidence-class revert: removes the `exports` branch from `classifyEvidenceTier`, so every export row falls through to the default `usage_contextual`. The edge is right and the CLAIM about how it was known is wrong — the honesty contract makes evidenceClass countable per repo, so a mislabelled class is a defect in the same class as a mislabelled relationship type, and both fixtures assert it.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "exports"
          ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } }
          : x,
      ),
    }),
  },
  {
    id: "csharp/exports-arity-blind-collapse",
    language: "csharp",
    defectClass: "relationship-loss",
    description:
      "ARITY revert, over-dedupe direction. `class Reporter` and `class Reporter<TChannel>` are two C# types sharing one published name (measured: 10 such declarations in 800 aspnetcore `src` files — OwningComponentBase.cs:17 vs :105), so the export set and the `exports` edges key on (name, ARITY). This mutant collapses every name to its LAST row and strips `metadata.arity`, reproducing the state before arity was read: one exported entry for two types, and the earlier declaration's export line lost with it. The wrong repair of a real defect, which is why it is registered rather than left implicit — a fix that dedupes by name passes the M49 uniqueness invariant and silently drops a type. Caught by csharp/export-arity-collision (3 `expectRelationshipCount` rows, 3 `expectExports` arity rows, 3 `expectRelationships` arity/line rows).",
    transform: (r: any) => {
      const rows = (r.relationships ?? []).filter((x: any) => x.type === "exports")
      const lastByName = new Map<string, any>()
      for (const x of rows) lastByName.set(String(x.target), x)
      return {
        ...r,
        relationships: (r.relationships ?? []).filter((x: any) => x.type !== "exports" || lastByName.get(String(x.target)) === x),
      }
    },
  },
  {
    id: "csharp/exports-line-last-wins",
    language: "csharp",
    defectClass: "wrong-payload",
    description:
      "The pre-2026-10-03 line carrier, restored as a mutant. `exportLineByName` was a name->line MAP, so where one name covered two declarations the second declaration's line was stamped on BOTH edges — measured on OwningComponentBase.cs, where the class declared at line 17 and the generic class declared at line 105 both produced `exports` edges carrying line 105. Every other `exports` row in the lane carries its own line, so the defect was invisible outside a repeated name. The line now rides the export ENTRY (Erlang's shape: `arity`, `file`, `line`), which makes the collision unrepresentable rather than merely fixed. Caught by csharp/export-arity-collision (3 per-line `expectRelationships` rows).",
    transform: (r: any) => {
      const rows = (r.relationships ?? []).filter((x: any) => x.type === "exports")
      const lastByName = new Map<string, number>()
      for (const x of rows) if (typeof x.line_number === "number") lastByName.set(String(x.target), x.line_number)
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "exports" && lastByName.has(String(x.target))
            ? { ...x, line_number: lastByName.get(String(x.target)) }
            : x,
        ),
      }
    },
  },
  {
    id: "csharp/exports-duplicate-partial-provider",
    language: "csharp",
    defectClass: "relationship-duplication",
    description:
      "Dedupe revert, duplicate-provider direction. `public partial class Split` written twice in ONE file is ONE exported type, and the export list is the assembly's importable-unit SET — two entries for one unit is a duplicate provider, which is the failure the shared M49 export invariant exists to stop ('export names must be UNIQUE — a duplicate cannot identify its provider'). This mutant duplicates every single-row `exports` edge. It is the opposite repair to `csharp/exports-arity-blind-collapse` and the fixture holds both, because either repair alone passes half the suite. Caught by csharp/export-arity-collision (`equals: 1` on Acme.Arity.Split, the per-line forbid on line 71, and the M49 invariant itself).",
    transform: (r: any) => {
      const count = new Map<string, number>()
      for (const x of (r.relationships ?? []).filter((x: any) => x.type === "exports")) {
        count.set(String(x.target), (count.get(String(x.target)) ?? 0) + 1)
      }
      return {
        ...r,
        relationships: (r.relationships ?? []).flatMap((x: any) =>
          x.type === "exports" && count.get(String(x.target)) === 1 ? [x, { ...x }] : [x],
        ),
      }
    },
  },
  {
    id: "csharp/imports-tuple-element-names",
    language: "csharp",
    defectClass: "fabricated-target",
    description:
      "Re-publishes the pre-fix tuple module. A tuple type's identity is its element TYPES — `(Type ContainerType, string FieldName)` and `(Type, string)` are one type and the element names are labels the declaration gives them — so the raw text published two names that are not part of the type, in the one position whose contract says the published value is a NAME. Found by cs-ont-08's independent derivation as the ONLY disagreement in 2,185 imports over 800 aspnetcore `src` files (ClientValidationCache.cs:17). Injected as the extra row rather than as a replacement because this registry transforms the parse RESULT; the defect being injected IS an additional row, so an additional row is the faithful form. Caught by csharp/using-tuple-alias (2 forbidImports, 1 forbidRelationship).",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          type: "imports",
          source: "root",
          target: "(Type ContainerType,string FieldName)",
          confidence: 1.0,
          metadata: { importKind: "alias", evidenceClass: "import_based", relationshipType: "using_import" },
        },
      ],
    }),
  },
  {
    id: "csharp/imports-alias-from-unparsed-directive",
    language: "csharp",
    defectClass: "fabricated-target",
    description:
      "The CSD7/R1 fabrication reachable through the PARSER'S ERROR RECOVERY rather than through a well-formed directive. `using OneElement = (string Only);` is not C# — there is no one-element tuple — so the grammar parks `= (string Only)` in an ERROR node, the `=` stops being a direct child of the directive, the alias form becomes undetectable, and `csharpUsingDirectiveTarget`'s first-named-child search returns the ALIAS. Measured before the fix: `imports root -> OneElement` with `importKind: \"namespace\"`, i.e. a dependency on a name the file imports nothing from. An unparsed directive now publishes nothing and reports a ParseError instead (cs-ont-08 could not see this one — its derivation reads the directive's own children, which is the blind spot a result-transform mutant exists to cover). Caught by csharp/using-tuple-alias (2 forbidImports, 2 forbidRelationships, one of which pins the WRONG importKind as well as the target).",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        {
          type: "imports",
          source: "root",
          target: "OneElement",
          confidence: 1.0,
          metadata: { importKind: "namespace", evidenceClass: "import_based", relationshipType: "using_import" },
        },
      ],
    }),
  },
]