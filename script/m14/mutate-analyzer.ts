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
