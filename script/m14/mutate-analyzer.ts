/**
 * M14.0.F4 — Mutation-Testing Harness
 *
 * Proves the verification gates CAN fail. For each mutant (a deliberately
 * defective analyzer), the fixture suite MUST go red. A surviving mutant
 * fails THE SUITE, not the mutant — suites that stay green no matter what
 * are decoration, and decoration is what let M13 claim dishonest things.
 *
 * Mutants wrap the real analyzer and transform its output — a faithful
 * simulation of an analyzer carrying the defect, without fragile source
 * surgery. Every mutant is documented with its defect class.
 *
 * Gate: every mutant must increase its language's failure count above the
 * recorded baseline (validation/m14/fixture-baseline.json). Exit 0 iff all
 * mutants are caught. Also emits evidence via the F2 harness.
 *
 * CLI: bun run script/m14/mutate-analyzer.ts
 */
import * as fs from "fs"
import * as path from "path"
import { runLang, LANGS } from "./run-fixtures"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")

interface Mutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (result: any) => any
}

function normRel(r: any) { return { ...r, type: r.type ?? r.relationshipType } }

const MUTANTS: Mutant[] = [
  {
    id: "c/drop-field-access-uses",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C field-access Uses edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "field_access") }),
  },
  {
    id: "c/drop-include-references",
    language: "c",
    defectClass: "relationship-loss",
    description: "drops C include dependency References edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "include_dependency") }),
  },
  {
    id: "c/drop-complexity",
    language: "c",
    defectClass: "payload-loss",
    description: "removes C cyclomatic complexity from function symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "cpp/drop-virtual-overrides",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ virtual override edges (isVirtualOverride)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isVirtualOverride) }),
  },
  {
    id: "cpp/drop-extends-edges",
    language: "cpp",
    defectClass: "relationship-loss",
    description: "drops C++ class inheritance (extends) edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "extends") }),
  },
  {
    id: "cpp/drop-qualified-calls",
    language: "cpp",
    defectClass: "payload-loss",
    description: "removes C++ qualified_calls payloads from method symbols",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: undefined })) }),
  },
  {
    id: "java/mislabel-inheritance",
    language: "java",
    defectClass: "relationship-mislabel",
    description: "relabels every extends edge as implements (the exact multi-interface bug class reported by the owner)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => normRel(x).type === "extends" ? { ...x, type: "implements" } : x) }),
  },
  {
    id: "java/drop-method-symbols",
    language: "java",
    defectClass: "symbol-loss",
    description: "drops every method symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "method") }),
  },
  {
    id: "java/fqn-edge-drop",
    language: "java",
    defectClass: "edge-drop",
    description: "drops edges whose target contains a dot (FQN handling regression)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(normRel(x).target ?? "").includes(".")) }),
  },
  {
    id: "groovy/confidence-tamper",
    language: "groovy",
    defectClass: "confidence-dishonesty",
    description: "sets confidence 1.0 on every relationship (silent heuristic inflation, contract §4 violation)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => ({ ...x, confidence: 1 })) }),
  },
  {
    id: "groovy/segment-garbage",
    language: "groovy",
    defectClass: "relationship-garbage",
    description: "adds a bogus implements edge to package segment 'java' for every class",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter(s => s.kind === "class").map(s => ({ type: "implements", source: s.name, target: "java", confidence: 1, metadata: {} }))] }),
  },
  {
    id: "javascript/drop-field-access",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "strips isFieldAccess uses edges (the collector-added feature)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isFieldAccess) }),
  },
  {
    id: "javascript/hide-jsdoc",
    language: "javascript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (docstring-loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "scala/drop-typeParameters",
    language: "scala",
    defectClass: "symbol-payload-loss",
    description: "strips genericParameters from every symbol (the #383c bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => {
        const clean = { ...s, genericParameters: undefined }
        if (clean.metadata) { delete clean.metadata.typeParameters }
        return clean
      }) }),
  },
  {
    id: "scala/drop-decorators",
    language: "scala",
    defectClass: "annotation-loss",
    description: "clears decorators from every symbol (annotation-driven detection regression)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, decorators: [] })) }),
  },
  {
    id: "scala/drop-docstrings",
    language: "scala",
    defectClass: "docstring-loss",
    description: "clears comments arrays (KDoc/ScalaDoc loss family)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "java/drop-declared-types",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops all declared_type references (the silent type-usage-graph bug class fixed in M14)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "declared_type") }),
  },
  {
    id: "java/drop-initializer-calls",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges attributed to initializer/field-init/enum-body scopes (#419 G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).inInitializer) }),
  },
  {
    id: "java/drop-array-access",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "java/drop-ctor-delegation",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "java/drop-record-patterns",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops References edges for record patterns (#419 G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "record_pattern") }),
  },
  {
    id: "java/drop-import-edges",
    language: "java",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isJavaImport references) — #419 section B imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isJavaImport) }),
  },
  {
    id: "java/drop-parameters",
    language: "java",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (java cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "java/reclassify-import-tier",
    language: "java",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the JVM-family tier bug: classifier ignored isJavaImport)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isJavaImport ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-declared-types",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/as/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "as_expression", "check_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "kotlin/drop-expression-uses",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the K1 indexing + K4 string-template bug class: xs[i] and \"hi $name\" reads were invisible before the #419 pass)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "expression_use")) }),
  },
  {
    id: "kotlin/drop-ctor-delegation",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops constructor_delegation_call edges (the K2 bug class: super(...)/this(...) delegation emitted no Calls)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "constructor_invocation")) }),
  },
  {
    id: "kotlin/drop-callable-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops callable_reference type references (the K3 bug class: Foo::bar emitted no reference to Foo)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "callable_reference")) }),
  },
  {
    id: "kotlin/drop-type-alias-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the K5 bug class: typealias Fn = (Int) -> String referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "type_alias")) }),
  },
  {
    id: "kotlin/drop-type-alias-symbols",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops type_alias symbols (the K5 bug class: typealias declarations were completely invisible)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isTypeAlias) }),
  },
  {
    id: "kotlin/drop-anonymous-objects",
    language: "kotlin",
    defectClass: "symbol-loss",
    description: "drops anonymous object symbols (the K6 bug class: object : Runner { } had no symbol and misattributed go() to the enclosing class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !s.metadata?.isAnonymousObject) }),
  },
  {
    id: "kotlin/drop-object-literal-refs",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops object_literal supertype references (the K6 bug class: anonymous objects referenced their implemented type nowhere)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "object_literal")) }),
  },
  {
    id: "kotlin/global-attribution",
    language: "kotlin",
    defectClass: "relationship-mislabel",
    description: "reverts class-level call attribution to the bogus Global placeholder (the K7 bug class: init blocks and property initializers attributed to Global)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => (s.kind === "class" || s.kind === "interface") && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).kotlinSpecific && classNames.has(x.source) ? { ...x, source: "Global" } : x) }
    },
  },
  {
    id: "kotlin/reclassify-import-tier",
    language: "kotlin",
    defectClass: "evidence-mislabel",
    description: "reclassifies import edges from import_based back to reference_qualified (the K8 JVM-family tier bug: classifier ignored isImportDep)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isImportDep ? { ...x, metadata: { ...x.metadata, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "kotlin/drop-instantiates",
    language: "kotlin",
    defectClass: "relationship-loss",
    description: "drops Instantiates edges (pins the Matrix 1b instantiates cell — kotlin has no 'new' keyword; Widget() is the construction heuristic)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "kotlin/strip-parameters",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "strips the parameters payload from every symbol (pins the Matrix 1b parameters cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "kotlin/strip-visibility",
    language: "kotlin",
    defectClass: "symbol-payload-loss",
    description: "flattens every symbol to public visibility (pins the Matrix 1b visibility cell for kotlin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, visibility: "public" })) }),
  },
  {
    id: "kotlin/clear-comments",
    language: "kotlin",
    defectClass: "docstring-loss",
    description: "clears comments arrays (pins the Matrix 1b docstrings cell for kotlin — the M14.1 KDoc fix)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "groovy/drop-declared-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "throws_type", "instanceof_expression"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/drop-declared-types",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops declared_type/throws/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "throws_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "scala/reclassify-import-tier",
    language: "scala",
    defectClass: "tier-misclassification",
    description: "reverts import edges to the old reference_qualified tier (the JVM-family isImportDep bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep ? { ...x, metadata: { ...x.metadata, isImportDep: undefined, evidenceClass: "reference_qualified" } } : x) }),
  },
  {
    id: "scala/drop-import-source-rewrite",
    language: "scala",
    defectClass: "relationship-loss",
    description: "reverts the import source rewrite to the root placeholder (G1 half 2)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => x.metadata?.isImportDep && x.source !== "root" ? { ...x, source: "root" } : x) }),
  },
  {
    id: "scala/drop-pattern-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops typed_pattern/case_class_pattern references (pattern-match type-usage gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "pattern_type") }),
  },
  {
    id: "scala/drop-method-value-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops method_value references (Foo.bar loses its Foo ref)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "method_value") }),
  },
  {
    id: "scala/drop-expression-uses",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops uses edges (interpolation + field-access Uses gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "uses") }),
  },
  {
    id: "scala/drop-tuple-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops return_type refs whose function returns a tuple_type (G5)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "return_type" && x.metadata?.declaredOn === "function_definition" && ["pair", "both"].includes(String(x.source)))) }),
  },
  {
    id: "scala/drop-derives-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops derives_type references (derives Show/Hashing gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "derives_type") }),
  },
  {
    id: "scala/drop-type-alias-refs",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops type_alias references (type X = ... RHS types gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "scala/drop-self-type-ref",
    language: "scala",
    defectClass: "relationship-loss",
    description: "drops self_type references (self: Service => gap)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "self_type") }),
  },
  {
    id: "scala/drop-parameters",
    language: "scala",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "typescript/drop-declared-types",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/cast/check references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "cast_target", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "javascript/drop-instanceof-refs",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instanceof_check references (JS's only unambiguous named-type usage)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "instanceof_check") }),
  },
  {
    id: "python/drop-declared-types",
    language: "python",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type/isinstance references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type", "instanceof_check"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "go/drop-declared-types",
    language: "go",
    defectClass: "relationship-loss",
    description: "drops declared_type/return_type references (silent type-usage-graph bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["declared_type", "return_type"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "typescript/drop-qualified-calls",
    language: "typescript",
    defectClass: "symbol-payload-loss",
    description: "strips qualified_calls from every symbol (the isKotlinBuiltin bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, qualified_calls: [] })) }),
  },
  {
    id: "typescript/hide-jsdoc",
    language: "typescript",
    defectClass: "docstring-loss",
    description: "clears comments arrays (kotlin KDoc bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map(s => ({ ...s, comments: [] })) }),
  },
  {
    id: "typescript/swap-heritage-labels",
    language: "typescript",
    defectClass: "relationship-mislabel",
    description: "swaps extends <-> implements labels on heritage edges",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map(x => {
      const t = x.type ?? x.relationshipType;
      if (t === "extends") return { ...x, type: "implements" };
      if (t === "implements") return { ...x, type: "extends" };
      return x;
    }) }),
  },
  {
    id: "typescript/reclassify-import-tier",
    language: "typescript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the T1 bug class: classifier's isImport branch never fired for the dedicated imports kind)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "typescript/drop-import-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges entirely (the T7 bug class: dynamic import('./lazy') landed in the imports array but emitted no edge)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "typescript/drop-type-alias-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_alias RHS references (the T2 bug class: type Fn = (a: Id) => Id referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_alias") }),
  },
  {
    id: "typescript/drop-expression-uses",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops expression-level Uses (the T3 template-interpolation + T4 field-access bug classes: `got ${x}` and this.h.value reads emitted no Uses)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.isTemplateInterpolation || x.metadata?.isFieldAccess)) }),
  },
  {
    id: "typescript/drop-satisfies-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops satisfies_target references (the T5 bug class: cfg satisfies Config referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "satisfies_target") }),
  },
  {
    id: "typescript/reintroduce-shadowed-false-refs",
    language: "typescript",
    defectClass: "relationship-garbage",
    description: "re-adds the scope-blind false reference from functions to property symbols (the T6 bug class: const { name } = u emitted main -> User.name)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.symbols ?? []).filter((s: any) => s.kind === "function").flatMap((s: any) => (r.symbols ?? []).filter((t: any) => !!t.ownerName && t.kind !== "function" && t.kind !== "class" && t.kind !== "interface").map((t: any) => ({ type: "references", source: s.name, target: t.name, confidence: 1, metadata: {} })))] }),
  },
  {
    id: "typescript/drop-cast-assertion-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops cast_target references from angle-bracket type_assertions only (the T8 bug class: <Foo>x referenced nothing while as Foo worked)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata?.relationshipType === "cast_target" && (x.source ?? "") !== (x.target ?? ""))) }),
  },
  {
    id: "typescript/drop-type-argument-refs",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops type_argument references (the T9 bug class: f<Baz>(x) referenced nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.metadata?.relationshipType !== "type_argument") }),
  },
  {
    id: "typescript/drop-override-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "typescript/drop-exports-edges",
    language: "typescript",
    defectClass: "relationship-loss",
    description: "drops exports edges (section B exports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "exports") }),
  },
  {
    id: "typescript/drop-visibility",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "typescript/drop-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "typescript/drop-type-parameters",
    language: "typescript",
    defectClass: "payload-loss",
    description: "drops the typeParameters payload from symbols (section C typeParameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, genericParameters: undefined })) }),
  },
  {
    id: "javascript/reclassify-import-tier",
    language: "javascript",
    defectClass: "evidence-mislabel",
    description: "reclassifies the imports kind from import_based back to usage_contextual (the J1 bug class: classifier had no 'imports' branch)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => String(x.type ?? x.relationshipType) === "imports" ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x) }),
  },
  {
    id: "javascript/drop-import-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops ALL imports dependency edges (the J1/J2 bug class: ES6, require, and dynamic import() dependencies)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "javascript/drop-template-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops template-interpolation Uses (the J3 bug class: `hi ${name}` reads were invisible)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isTemplateInterpolation) }),
  },
  {
    id: "javascript/reintroduce-callee-uses",
    language: "javascript",
    defectClass: "relationship-garbage",
    description: "re-adds the call-callee double-emission: uses edges for every member call (the J4 bug class: svc.fetch() emitted calls AND uses)",
    transform: r => ({ ...r, relationships: [...(r.relationships ?? []), ...(r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) === "calls" && typeof (x.metadata ?? {}).calleeExpression === "string" && (x.metadata.calleeExpression).includes(".")).map((x: any) => { const parts = (x.metadata.calleeExpression).split("."); return { type: "uses", source: parts[0], target: parts[parts.length - 1], confidence: 0.6, metadata: { isFieldAccess: true } } })] }),
  },
  {
    id: "javascript/drop-static-calls",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops calls attributed to class scope (the J5 bug class: static-block and field-initializer calls)",
    transform: r => {
      const classNames = new Set((r.symbols ?? []).filter((s: any) => s.kind === "class" && !s.ownerName).map((s: any) => s.name))
      return { ...r, relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type ?? x.relationshipType) === "calls" && classNames.has(x.source))) }
    },
  },
  {
    id: "javascript/global-instanceof-source",
    language: "javascript",
    defectClass: "relationship-mislabel",
    description: "reverts instanceof reference sources to the global placeholder (the J6 bug class: top-level consts attributed to global)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).relationshipType === "instanceof_check" ? { ...x, source: "global" } : x) }),
  },
  {
    id: "javascript/drop-destructure-symbols",
    language: "javascript",
    defectClass: "symbol-loss",
    description: "drops module-level destructured binding symbols (the J7 bug class: const { a } = obj emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.metadata ?? {}).isDestructured) }),
  },
  {
    id: "javascript/drop-jsx-uses",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops JSX component Uses edges (the J8 bug class: <Button/> emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).jsxElement) }),
  },
  {
    id: "javascript/drop-override-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "javascript/drop-instantiates-edges",
    language: "javascript",
    defectClass: "relationship-loss",
    description: "drops instantiates edges (section B instantiates pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "instantiates") }),
  },
  {
    id: "javascript/drop-visibility",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "javascript/drop-parameters",
    language: "javascript",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function/method symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/drop-generic-macro-symbols",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops prop/event symbols from the type-literal generic macro form (the V1 bug class: defineProps<{ id: string }>() emitted nothing)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isProp || (s.metadata ?? {}).isEmit)) }),
  },
  {
    id: "vue/drop-template-member-uses",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the V2 bug class: {{ count }}, :label, @click emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "vue/reduplicate-contains",
    language: "vue",
    defectClass: "relationship-duplication",
    description: "re-adds duplicate contains edges for script-side class members (the V3 bug class: sub-analyzer contains + vue pass = 2x)",
    transform: r => {
      const rels = r.relationships ?? []
      const dupes = rels.filter((x: any) => String(x.type ?? x.relationshipType) === "contains" && (x.metadata ?? {}).evidenceClass === "structural")
      return { ...r, relationships: [...rels, ...dupes] }
    },
  },
  {
    id: "vue/drop-contains-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops all contains edges (section B contains pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "contains") }),
  },
  {
    id: "vue/drop-import-edges",
    language: "vue",
    defectClass: "relationship-loss",
    description: "drops imports edges (section B imports pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "imports") }),
  },
  {
    id: "vue/drop-complexity",
    language: "vue",
    defectClass: "payload-loss",
    description: "zeroes the complexity payload on script functions (section C complexity pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: undefined })) }),
  },
  {
    id: "vue/drop-visibility",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "vue/drop-parameters",
    language: "vue",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "vue/reemit-shadowed-uses",
    language: "vue",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers that shadow members (the V4 bug class: v-for loop vars and slot props produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const comp = rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source
      const source = typeof comp === "string" ? comp : "template-scope-shadow"
      const extra = ["item", "row"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "vue/drop-union-emit-names",
    language: "vue",
    defectClass: "symbol-loss",
    description: "drops non-first union emit names (the V1b bug class: (e: 'save' | 'close') kept only save)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s.metadata ?? {}).isEmit && s.name === "close")) }),
  },
  {
    id: "svelte/drop-template-member-uses",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops template-expression Uses edges (the S1 bug class: {count}, label={label}, {#each items} emitted nothing)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => !(x.metadata ?? {}).isTemplateExpression) }),
  },
  {
    id: "svelte/reemit-shadowed-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for template-LOCAL identifiers (the vue V4 bug class: each loop vars and await then/catch vars produced false uses)",
    transform: r => {
      const rels = r.relationships ?? []
      const source = (rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source) || "template-member-uses"
      const extra = ["row", "i", "value", "err"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-rune-props",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds the JS sub-analyzer's destructured Variables for $props() bindings (the S2 bug class: let { a } = $props() declared a twice)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.metadata ?? {}).isSvelteProp ? { ...s, name: undefined } : s).filter((s: any) => s.name !== undefined).concat((r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isSvelteProp).map((s: any) => ({ ...s, name: s.name + "", kind: "variable", ownerName: undefined, metadata: { ...s.metadata, isSvelteProp: undefined, fromRunes: undefined, isDestructured: true } }))) }),
  },
  {
    id: "svelte/drop-overrides-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops overrides edges (section B overrides pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "overrides") }),
  },
  {
    id: "svelte/drop-references-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops references edges (section B references pin)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "references") }),
  },
  {
    id: "svelte/drop-uses-edges",
    language: "svelte",
    defectClass: "relationship-loss",
    description: "drops uses edges incl. template-expression uses (section B uses pin + S1)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type ?? x.relationshipType) !== "uses") }),
  },
  {
    id: "svelte/drop-parameters",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the parameters payload from function symbols (section C parameters pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "svelte/drop-visibility",
    language: "svelte",
    defectClass: "payload-loss",
    description: "drops the visibility payload from symbols (section C visibility pin)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, visibility: undefined })) }),
  },
  {
    id: "svelte/reemit-shadowed-member-uses",
    language: "svelte",
    defectClass: "scope-blindness",
    description: "re-emits Uses for each-loop / {@const} bindings that collide with a SAME-NAMED MEMBER (the S5 bug class: {#each rows as row} or {@const total = r.id} leaked fake uses -> member row/item/total)",
    transform: r => {
      const rels = r.relationships || []
      const source = (rels.find((x: any) => x.type === "instantiates" || x.type === "uses")?.source) || "each-shadow-collision"
      const extra = ["row", "item", "total"].map(name => ({
        source, target: name, type: "uses", confidence: 0.95,
        metadata: { isTemplateExpression: true },
      }))
      return { ...r, relationships: [...rels, ...extra] }
    },
  },
  {
    id: "svelte/reduplicate-reactive-targets",
    language: "svelte",
    defectClass: "symbol-duplication",
    description: "re-adds duplicate symbols for $: reactive targets (the S6 bug class: the same variable assigned from multiple $: blocks declared once PER BLOCK)",
    transform: r => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        ...(r.symbols ?? []).filter((s: any) => (s.metadata ?? {}).isReactiveDeclaration).map((s: any) => ({ ...s })),
      ],
    }),
  },
  {
    id: "groovy/drop-class-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops every class symbol",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => s.kind !== "class") }),
  },
  {
    id: "groovy/drop-array-access",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Uses edges for array reads/writes (#419 groovy G1 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isArrayAccess) }),
  },
  {
    id: "groovy/drop-ctor-delegation",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops Calls edges for super()/this() constructor delegation (#419 groovy G2 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "constructor_invocation") }),
  },
  {
    id: "groovy/drop-pattern-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops pattern type references (instanceof + switch case) (#419 groovy G3 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !["instanceof_expression", "case_pattern"].includes(String(x.metadata?.relationshipType))) }),
  },
  {
    id: "groovy/drop-method-refs",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops method_reference type edges (Foo::bar) (#419 groovy G4 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "method_reference") }),
  },
  {
    id: "groovy/drop-cast-types",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops cast_expression type edges ((String) o) (#419 groovy G5 bug class)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => (x.metadata ?? {}).relationshipType !== "cast_type") }),
  },
  {
    id: "groovy/drop-record-symbols",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops record class symbols and record components (#419 groovy G6 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => !((s.metadata ?? {}).isRecord || (s.metadata ?? {}).nodeType === "record_component")) }),
  },
  {
    id: "groovy/drop-annotation-types",
    language: "groovy",
    defectClass: "symbol-loss",
    description: "drops annotation_type_declaration symbols (#419 groovy G7 bug class)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).filter(s => (s.metadata ?? {}).nodeType !== "annotation_type_declaration") }),
  },
  {
    id: "groovy/drop-import-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops the imports dependency edges (isGroovyImport references) — #419 groovy G8 imports pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => !(x.metadata ?? {}).isGroovyImport) }),
  },
  {
    id: "groovy/drop-wildcard-flag",
    language: "groovy",
    defectClass: "metadata-loss",
    description: "clears isWildcard on import edges (wildcard imports lose the flag — groovy G8 companion bug)",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => (x.metadata ?? {}).isGroovyImport ? { ...x, metadata: { ...x.metadata, isWildcard: false } } : x) }),
  },
  {
    id: "groovy/drop-parameters",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the parameters payload from method symbols — #383 Matrix 1b parameters pin (groovy cell PENDING -> #383)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: undefined })) }),
  },
  {
    id: "groovy/drop-varargs-type",
    language: "groovy",
    defectClass: "payload-loss",
    description: "drops the [] erasure suffix and name fix on varargs parameters (String... parts back to anonymous/String)",
    transform: r => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, parameters: (s.parameters ?? []).map((p: any) => ({ ...p, name: p.name === "parts" ? "anonymous" : p.name, type: p.type === "String[]" ? "String" : p.type })) })) }),
  },
  {
    id: "groovy/drop-contains-edges",
    language: "groovy",
    defectClass: "relationship-loss",
    description: "drops contains edges for type/member/field containment — #419 groovy section B contains pin",
    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter(x => x.type !== "contains") }),
  },
]

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "fixture-baseline.json"), "utf8"))
  const mutationLog: { mutant: string; injectedAt: string; caughtBy: string; detail: string }[] = []
  const checks: { id: string; description: string; status: "pass" | "fail"; detail?: string }[] = []
  let survivors = 0

  // cache clean-run results per language once
  const cleanResults = new Map<string, Awaited<ReturnType<typeof runLang>>>()
  async function clean(lang: string) {
    if (!cleanResults.has(lang)) cleanResults.set(lang, await runLang(lang))
    return cleanResults.get(lang)!
  }

  for (const m of MUTANTS) {
    const base = await clean(m.language)
    const real = await realAnalyzer(m.language)
    const mutant = {
      analyze: async (...args: any[]) => m.transform(await real.analyze(...args)),
      // SFC languages (vue/svelte) run through engine parseFile in runLang;
      // runLang applies this transform to the parseFile result so mutants are
      // exercised on the real production path.
      transform: m.transform,
    }
    const mutated = await runLang(m.language, mutant)
    // Caught = more failing fixtures OR more distinct problems inside
    // already-failing fixtures (a defect landing in broken code is still a defect).
    const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details.filter(d => !d.ok).map((d: any) => d.fixture)
      .filter(f => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
      .join(", ")
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new failures: " + caughtBy : ""})`)
    checks.push({ id: `mutation-${m.id.replace("/", "-")}`, description: m.description, status: caught ? "pass" : "fail", detail: `${base.fail} -> ${mutated.fail}` })
    mutationLog.push({ mutant: m.id, injectedAt: new Date().toISOString(), caughtBy: caughtBy || "(none)", detail: `${m.defectClass}: ${base.fail} -> ${mutated.fail} fixture failures` })
    if (!caught) survivors++
  }

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F4",
    title: "Mutation-testing harness",
    claimLevel: "L1",
    layers: ["fixtures", "mutation"],
    checks,
    limitations: [
      { description: "mutants wrap analyzer output rather than rewriting analyzer source; equivalent at the suite level but not a compiler-level injection" },
      { description: "mutation coverage currently spans java + groovy (the wave languages); other languages add mutants when their waves start" },
    ],
    mutationLog,
    data: { summary: { mutantsRun: MUTANTS.length, caught: MUTANTS.length - survivors, survived: survivors } },
  })

  if (survivors > 0) {
    console.error(`\n${survivors} SURVIVING MUTANT(S) - the suite cannot detect real defects. Fix the suite before trusting any green.`)
    process.exit(2)
  }
  console.log(`\nall ${MUTANTS.length} mutants caught - the gates can fail`)
}

main().catch(e => { console.error(e); process.exit(1) })
