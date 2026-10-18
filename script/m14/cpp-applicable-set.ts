/**
 * CPP APPLICABLE SET — the D1 instrument (ALL-OUT-OF-ALL programme, charter §9.1 D1).
 *
 * The task says the applicable set must come from the PINNED GRAMMAR, "constructs, not
 * intuition". This file answers it with three measurements in one run, so the lane's D1
 * claim is a command and not a paragraph:
 *
 *   1. WHAT CAN THE PINNED GRAMMAR EXPRESS? `wasm/tree-sitter-cpp.wasm` is enumerated
 *      through web-tree-sitter's own Language API (nodeTypeCount / nodeTypeIsNamed /
 *      nodeTypeForId). Every applicability claim is answered from that enumeration: a
 *      canonical value is APPLICABLE only when every construct production it needs is
 *      PRESENT, and a NON-APPLICABLE value must carry the productions whose ABSENCE proves
 *      it. Nothing here is read from the ten-value matrix or from intuition.
 *
 *   2. WHAT PINS EACH APPLICABLE VALUE? The lane's own fixture expectations are parsed and
 *      every applicable value must carry at least one POSITIVE `expectRelationships` row
 *      naming it (a value with no positive row is a value nothing can go RED for), plus the
 *      emission sites read out of `src/ast/real-cpp-analyzer.ts` itself.
 *
 *   3. CAN THE FIXTURE ACTUALLY GO RED? The real fixture runner (`runLang` /
 *      `run-fixtures.ts`) is run once per applicable value through an override analyzer that
 *      is the REAL `RealCppAnalyzer` with exactly that value's edges removed. A fixture that
 *      PASSED at baseline and FAILS with the emission absent is a fixture that can go RED —
 *      measured, never assumed.
 *
 * ## THE RULINGS THIS FILE EXISTS TO PROVE (the four the family asked about)
 *
 *   `extends`         base_class_clause is present, and it is a LIST
 *                     (base_class_clause_repeat1) — MULTIPLE INHERITANCE is one clause with
 *                     N bases, so one `extends` edge per (derived, base) pair is the
 *                     construct's own shape. Grammar-present, fixture-pinned.
 *   `overrides`       virtual_specifier + the `virtual`/`override` tokens + pure_virtual_clause
 *                     are present; C++ expresses method overriding directly, unlike C.
 *   `implements`      THERE IS NO implements-CLAUSE PRODUCTION — recorded as grammar absence
 *                     (`implements_clause`/`class_interface_clause`/`super_interfaces` absent).
 *                     The value is still APPLICABLE to C++ through ADAPTED SEMANTICS that the
 *                     ADAPTED SEMANTICS block below declares: a base whose body declares a
 *                     pure virtual is a contract, and inheriting it IS implementation. The
 *                     analyzer already emits it (site below), the corpus exercises it, and a
 *                     fixture is red-capable — so ruling it non-applicable would be a claim
 *                     the measurements refute.
 *   template
 *   instantiation     `template_instantiation` / `template_declaration` are present but they
 *                     are NOT the `instantiates` value: `instantiates` is OBJECT CREATION
 *                     (`new_expression`), while a template instantiation is a compile-time
 *                     type specialization (no runtime object, no owner). The distinction is
 *                     recorded in the rulings block so a reader cannot mistake one for the
 *                     other by grepping the grammar.
 *   namespace/using   namespace_definition and using_declaration are present; their edges are
 *                     CARRIED BY existing values (contains for namespace -> member,
 *                     references for a using-dependency) and NOT by `imports`, which is
 *                     reserved for `#include` (a module path, not a scope dependency). This is
 *                     the mapping the spec table records and the census counts.
 *
 * Usage:
 *   bun run script/m14/cpp-applicable-set.ts                 # JSON to stdout
 *   bun run script/m14/cpp-applicable-set.ts --out <path>    # JSON to a file too
 *
 * Exit: 0 when every applicable value is implemented, fixture-pinned and demonstrably
 *       RED-able and every ruled value's absence is proven; 1 when any conjunct fails.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const OUT_FLAG = process.argv.indexOf("--out")
const OUT = OUT_FLAG >= 0 && process.argv[OUT_FLAG + 1] ? path.resolve(process.argv[OUT_FLAG + 1]) : null

const { runLang, getParser } = await import("./run-fixtures")

const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "cpp")
const ANALYZER = path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts")
const WASM = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE CANONICAL VALUES — applicability decided by the enumeration in section 2, with
//     the construct productions each value rests on named here.
// ─────────────────────────────────────────────────────────────────────────────────────────
const APPLICABLE: Record<string, {
  constructs: string[]          // grammar productions the value's construct needs
  rule: string                  // what the construct is, in the analyzer's terms
  emissionSymbol: string        // RelationshipType.<member> used at the emission sites
  adaptedSemantics?: string     // set when the value rides a construct of a DIFFERENT name
}> = {
  calls: {
    constructs: ["call_expression", "argument_list"],
    rule: "call_expression whose callee is an identifier / field_expression / qualified_identifier / template_function / function-pointer; a class-type functional construction `T(x)` is a CALL in this family (cpp/call-target-name-surface-924), while `instantiates` is reserved for `new`.",
    emissionSymbol: "Calls",
  },
  uses: {
    constructs: ["field_expression", "identifier", "assignment_expression", "update_expression", "field_initializer"],
    rule: "a READ (and, under the C-family contract pinned by #960, a WRITE) of an in-file declared name: member reads, bare value reads, lambda-capture reads; declaration positions and call callees are excluded by their own rules.",
    emissionSymbol: "Uses",
  },
  contains: {
    constructs: ["class_specifier", "struct_specifier", "union_specifier", "enum_specifier", "namespace_definition", "field_declaration", "function_definition", "declaration_list", "enumerator"],
    rule: "container -> member: namespace/class/struct/union -> member, enum -> enumerator, and a function -> its local type. ONE edge per (owner, name) pair; overloads stay as symbols but the duplicated edge is dropped.",
    emissionSymbol: "Contains",
  },
  imports: {
    constructs: ["preproc_include", "system_lib_string", "string_literal"],
    rule: "preproc_include -> the include path as the module target (`<vector>` / `\"Service.h\"`). The target is a module path, not a symbol, by construction of the type — 0% resolution is its shape, not a failure rate. Namespace aliases and `using` are NOT imports (they are references/contains, see the rulings block).",
    emissionSymbol: "Imports",
  },
  references: {
    constructs: ["type_identifier", "qualified_identifier", "template_type", "cast_expression", "sizeof_expression", "decltype", "using_declaration"],
    rule: "a TYPE mention in a type position, plus the using-dependency (`using ns::name;`). A value identifier in a value position is `uses`, not `references`.",
    emissionSymbol: "References",
  },
  exports: {
    constructs: ["ms_declspec_modifier", "attribute_specifier", "attribute_declaration", "linkage_specification", "preproc_def", "preproc_function_def"],
    rule: "the author's EXPORT marker on a declaration: `__declspec(dllexport)` (MSVC) and `__attribute__((visibility(\"default\")))` (GCC/Clang). A file-scope surface list is a different question and is not this edge.",
    emissionSymbol: "Exports",
  },
  extends: {
    constructs: ["class_specifier", "struct_specifier", "base_class_clause"],
    rule: "class/struct -> each base in its base_class_clause, one edge per base. MULTIPLE INHERITANCE is a LIST in one clause (base_class_clause_repeat1), so `class D : public B, private C` is two edges, not a special case.",
    emissionSymbol: "Extends",
  },
  implements: {
    constructs: ["class_specifier", "struct_specifier", "base_class_clause", "pure_virtual_clause", "virtual_specifier"],
    rule: "ADAPTED SEMANTICS, declared: C++ has no `implements` clause. The construct the value carries is the CONTRACT BASE — a base whose body declares a pure virtual (`virtual R f() = 0;`). One edge per (derived, base) pair where the base is in-file and declares at least one pure virtual; the edge is NOT a duplicate of `extends` (two readings of the same clause: 'inherits from' and 'implements this contract'), and it carries metadata.reasonCode pure-virtual-base + the pure-virtual member list so a consumer can re-derive it. A base with no in-file declaration, or with no pure virtual, emits NO edge (a guess here is the fabrication the workstream exists to prevent).",
    emissionSymbol: "Implements",
    adaptedSemantics: "no implements-clause production exists; the value rides base_class_clause + pure_virtual_clause",
  },
  overrides: {
    constructs: ["virtual_specifier", "pure_virtual_clause", "override", "class_specifier", "field_declaration", "function_declarator"],
    rule: "a derived class's method that overrides a base's virtual method: matched transitively through the in-file base chain by method leaf + normalized parameter-type signature, with the `override`/`final` keyword (when written) carried as an independent evidence class. The target is the DECLARED MEMBER's leaf and the intended base rides metadata.overriddenOwner.",
    emissionSymbol: "Overrides",
  },
  instantiates: {
    constructs: ["new_expression", "new_declarator", "type_identifier"],
    rule: "OBJECT CREATION through `new`: the constructed type is the target, template arguments are stripped (`new std::vector<int>` instantiates vector). A primitive (`char`), a non-class standard typedef (`uint8_t`), a keyword spelling and a template-parameter binding emit NO edge. `instantiates` is NOT template instantiation — see the rulings block.",
    emissionSymbol: "Instantiates",
  },
}

const NOT_APPLICABLE: Record<string, {
  needs: string[]               // productions that would have to exist
  reason: string
  vocabularyRuling: string
}> = {
  decorates: {
    needs: ["decorator", "annotation", "annotation_declaration", "marker_annotation", "decorator_expression"],
    reason: "no decorator/annotation production exists in the pinned C++ grammar. It DOES have attribute_specifier / attribute_declaration / __attribute__ (GNU and C++11 attributes), adjudicated here rather than ignored: an attribute names no callable declaration of its own (it is a keyword/macro-written specifier), and the analyzer records export attributes as the `exports` edge + symbol metadata — the same ruling the java lane applied to annotations (references+isAnnotation; decorates reserved for runtime callable decorators). No cpp fixture expects a `decorates` row and the analyzer emits none.",
    vocabularyRuling: "extended value, NOT APPLICABLE to C++.",
  },
  renders: {
    needs: ["jsx_element", "jsx_self_closing_element", "jsx_opening_element", "jsx_attribute"],
    reason: "no JSX/element-construction production exists in the pinned C++ grammar; C++ never creates a component-element pair.",
    vocabularyRuling: "extended value (TSX/JSX), NOT APPLICABLE to C++.",
  },
  mixes_in: {
    needs: ["mixin", "mixin_application_class", "with_clause"],
    reason: "no mixin/with production exists in the pinned C++ grammar. Multiple inheritance expresses composition of base classes and is carried by `extends`; there is no separate mixin application construct to publish.",
    vocabularyRuling: "extended value (Dart `with`), NOT APPLICABLE to C++.",
  },
  part_of: {
    needs: ["part_directive", "part_of_directive", "part_clause"],
    reason: "C++'s file-inclusion construct is `#include`, which IS a module edge and is published as `imports`; there is no part-file directive that shares one scope without importing (the construct `part_of` exists to distinguish).",
    vocabularyRuling: "extended value (Dart `part`/`part of`), NOT APPLICABLE to C++.",
  },
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1b · CONSTRUCT SURFACE — the C++ constructs the D1 handoff names, mapped to the canonical
//      value(s) that carry them (or RULED as carrying no relationship). Each row's construct
//      is checked against the grammar enumeration in section 2; a row that claims a mapping
//      to a value must name a value that exists above.
// ─────────────────────────────────────────────────────────────────────────────────────────
const CONSTRUCTS: Array<{
  construct: string
  grammars: string[]
  carriedBy: string[]          // canonical values, or [] with a ruling
  ruling: string
}> = [
  { construct: "classes / structs / unions", grammars: ["class_specifier", "struct_specifier", "union_specifier"], carriedBy: ["contains", "extends", "overrides", "implements", "instantiates", "references"], ruling: "a class is a symbol; its members are contains, its bases extends + implements, its virtual overrides are overrides, its constructions instantiates." },
  { construct: "templates (declaration + type arguments)", grammars: ["template_declaration", "template_parameter_list", "template_type", "template_instantiation"], carriedBy: ["references", "instantiates"], ruling: "a template ARGUMENT is a type mention (references); `new X<T>` strips the arguments and instantiates X. A template DECLARATION is a declaration form, not a relationship kind: its members are contained by the enclosing class/namespace, and its parameters are not symbols. `template_instantiation` is a compile-time specialization and is NOT the `instantiates` value (see rulings)." },
  { construct: "namespaces", grammars: ["namespace_definition", "nested_namespace_specifier", "namespace_identifier"], carriedBy: ["contains", "references"], ruling: "namespace -> member is contains; a qualified mention of a namespace-scoped name is references. Namespaces are NOT imports (imports is #include only) and NOT exports (no marker)." },
  { construct: "namespace alias / using-declaration / using-directive", grammars: ["namespace_alias_definition", "using_declaration"], carriedBy: ["references"], ruling: "a using-dependency is published as references (the dependency edge the early residual analysis called the 'using half' of the old single imports bucket). A namespace ALIAS names a namespace, which is not a published declaration, so it emits no edge — measured in the census." },
  { construct: "multiple inheritance", grammars: ["base_class_clause", "base_class_clause_repeat1"], carriedBy: ["extends", "implements"], ruling: "one base_class_clause holds a LIST of bases (base_class_clause_repeat1), so N bases = N extends edges and (for pure-virtual bases) N implements edges. It is not a distinct relationship type." },
  { construct: "virtual / override / pure-virtual methods", grammars: ["virtual_specifier", "pure_virtual_clause", "override", "virtual"], carriedBy: ["overrides", "implements"], ruling: "a derived method overriding a base virtual is overrides; a base that DECLARES a pure virtual is a contract and implementing it is implements. The `override`/`final` keyword is recorded as an evidence class, never invented when absent." },
  { construct: "operator overloads", grammars: ["operator_name", "operator_cast", "destructor_name"], carriedBy: ["contains", "calls", "uses", "references"], ruling: "an operator overload is a declared member (symbol) named `operator+` etc.; it is contained by its class and appears in calls/uses positions exactly like a named method. There is no `overloads` relationship value: overload RELATIONSHIPS are not a canonical kind, and the symbol's kind/name carries the fact." },
  { construct: "lambda expressions (captures)", grammars: ["lambda_expression", "lambda_capture_specifier", "lambda_capture_initializer", "lambda_default_capture"], carriedBy: ["uses"], ruling: "a captured variable is a READ of an in-file name, so a capture is `uses` from the enclosing function/class (the family member-read contract); a capture with an initializer (`[x = y]`) reads y. A lambda expression itself publishes no symbol of its own in this lane, so no contains edge is fabricated for it." },
  { construct: "structured bindings", grammars: ["structured_binding_declarator"], carriedBy: ["uses", "references"], ruling: "a structured binding DECLARES local names (not published symbols) and READS the initializer's object; the binding names are declaration positions, so no uses edge is fabricated for them, and the referenced type is references where the type is a type mention." },
  { construct: "concepts / requires (C++20)", grammars: ["concept_definition", "requires_clause", "requires_expression"], carriedBy: [], ruling: "RULED: grammar-present but carrying NO relationship in this lane's model. A concept is a named constraint entity this analyzer does not publish as a symbol (publishing it would be a new symbol kind, not a relationship), and a requires_clause is a compile-time constraint, not a call/read/inheritance fact. Measured population is carried by the D2 census so this is a count, not a silence; if a future wave publishes concepts, `references` to the concept is the value they would carry." },
  { construct: "friend declarations/definitions", grammars: ["friend_declaration"], carriedBy: ["contains", "uses", "calls", "references"], ruling: "a friend DEFINITION is a free function owned by no class (fixtures friend-definition-published / friend-owner-name-recovery pin this); a friend DECLARATION grants access and publishes no edge of its own." },
  { construct: "preprocessor (#include / #define / conditional arms)", grammars: ["preproc_include", "preproc_def", "preproc_function_def", "preproc_if", "preproc_ifdef"], carriedBy: ["imports", "exports", "overrides"], ruling: "includes are imports; an export MARKER macro applied to a declaration is exports (the marker spelling decides); mutually exclusive conditional definitions are the ADAPTED `overrides` semantics used by the C lane as well (shape carried in metadata)." },
]

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1c · RULINGS — value-collision questions the family asked to see answered by the grammar
//      rather than by prose (template instantiation vs instantiates; implements clause).
// ─────────────────────────────────────────────────────────────────────────────────────────
const RULINGS: Array<{ id: string; question: string; measured: string; verdict: string }> = [
  {
    id: "CPP-R1",
    question: "`implements`: is the canonical value applicable to C++?",
    measured: "the pinned grammar has NO implements-clause production (implements_clause / class_interface_clause / super_interfaces all ABSENT — section 2 proves it). It DOES have class_specifier + base_class_clause + pure_virtual_clause; the analyzer emits implements at a measured site from (derived, pure-virtual base) pairs and the corpus carries them.",
    verdict: "APPLICABLE BY ADAPTED SEMANTICS — a pure-virtual base is a contract. Ruling it non-applicable would contradict the emission and the fixtures; the adapted reading is declared in the value's rule and in script/m14/spec/cpp-completeness.json.",
  },
  {
    id: "CPP-R2",
    question: "template_instantiation vs `instantiates`: the same word, the same value?",
    measured: "`template_instantiation` (a compile-time type specialization, e.g. `Box<int>`) and `new_expression` (runtime object creation) are DIFFERENT productions. The `instantiates` value is emitted from new_expression only; a new of a template type strips `<>` and instantiates the base type name. No value is named after template instantiation, and no constructor-of-template edge is fabricated.",
    verdict: "DISTINCT — a C++ template instantiation carries no relationship; `instantiates` = object creation. Recorded so no future reader derives the value from the wrong node.",
  },
  {
    id: "CPP-R3",
    question: "Are `using` / namespace declarations `imports`?",
    measured: "`imports` is emitted from preproc_include only (site read from source). using_declaration is emitted as a references dependency (the using-half of the early residual analysis) and namespace containment as contains.",
    verdict: "NO — `imports` is a module-path edge (#include); a using-dependency is a symbol/type dependency (references). The census counts both separately so the mapping is a number.",
  },
  {
    id: "CPP-R4",
    question: "Does multiple inheritance need its own value?",
    measured: "base_class_clause's shape is a repeated list of base_class items; the analyzer iterates it and emits one extends (and, where pure virtual, one implements) per base.",
    verdict: "NO — multiple inheritance is N extends edges; the value set already expresses it, and the fixture pins a two-base class.",
  },
]

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2 · THE PINNED GRAMMAR, enumerated (constructs, not intuition)
// ─────────────────────────────────────────────────────────────────────────────────────────
async function enumerateGrammar(): Promise<{
  wasm: string
  sha256: string
  slotCount: number
  namedTypeCount: number
  anonymousTokenCount: number
  namedTypes: string[]
  anonymousTokens: string[]
}> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const bytes = fs.readFileSync(WASM)
  const g = await L.load(bytes)
  const namedTypes: string[] = []
  const anonymousTokens: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const t = g.nodeTypeForId(i)
    if (!t || seen.has(t)) continue
    seen.add(t)
    if (g.nodeTypeIsNamed(i)) namedTypes.push(t)
    else anonymousTokens.push(t)
  }
  return {
    wasm: path.relative(ROOT, WASM),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    slotCount: g.nodeTypeCount,
    namedTypeCount: namedTypes.length,
    anonymousTokenCount: anonymousTokens.length,
    namedTypes: namedTypes.sort(),
    anonymousTokens: anonymousTokens.sort(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3 · FIXTURE PINS — read from the fixtures' own expectation rows, never a hand list
// ─────────────────────────────────────────────────────────────────────────────────────────
interface FixtureExpectation {
  fixture: string
  rows: Array<{ type?: string; from?: string; target?: string }>
  forbidRows: Array<{ type?: string; from?: string; target?: string }>
}
function readFixtureExpectations(): FixtureExpectation[] {
  const out: FixtureExpectation[] = []
  for (const f of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!f.endsWith(".expectation.json")) continue
    const full = path.join(FIXTURES_DIR, f)
    const exp = JSON.parse(fs.readFileSync(full, "utf8"))
    out.push({
      fixture: `cpp/${f.replace(".expectation.json", "")}`,
      rows: exp.expectRelationships ?? [],
      forbidRows: exp.forbidRelationships ?? [],
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 4 · IMPLEMENTATION SITES — read from the analyzer source, so a moved site is visible
// ─────────────────────────────────────────────────────────────────────────────────────────
function implementationSites(): Record<string, number[]> {
  const src = fs.readFileSync(ANALYZER, "utf8").split("\n")
  const sites: Record<string, number[]> = {}
  for (const [value, row] of Object.entries(APPLICABLE)) {
    const needle = `RelationshipType.${row.emissionSymbol}`
    const hits: number[] = []
    for (let i = 0; i < src.length; i++) {
      if (!src[i].includes(needle)) continue
      // An EMISSION site is the property that PUSHES the value (`type: …RelationshipType.X`);
      // a `!==`/`===` comparison over already-built relationships is a filter, not a site.
      if (!src[i].includes("type:")) continue
      if (src[i].includes("!==") || src[i].includes("===")) continue
      hits.push(i + 1)
    }
    sites[value] = hits
  }
  return sites
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 5 · RED PROOF — real runner, real analyzer, one value removed
// ─────────────────────────────────────────────────────────────────────────────────────────
async function makeMutant(lang: string, value: string): Promise<any> {
  const parser = await getParser(lang)
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
  const real = new mod.RealCppAnalyzer()
  // The runner does not perform its grammar handoff when an override analyzer is
  // supplied (an override is assumed to be self-contained); reproduce it here so the
  // ONLY difference from the baseline run is the removed relationship value.
  const ctor: any = real?.constructor
  if (typeof ctor?.setGrammar === "function") {
    try {
      ctor.setGrammar((parser as any).language, (parser as any).constructor)
    } catch {
      /* no grammar available: the mutant keeps the main pass, same contract as the runner */
    }
  }
  return {
    async analyze(root: any, content: string, filePath: string, context: any) {
      const res: any = await real.analyze(root, content, filePath, context)
      if (res && Array.isArray(res.relationships)) {
        res.relationships = res.relationships.filter((r: any) => String(r.type ?? "") !== value)
      }
      return res
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────────────────
const grammar = await enumerateGrammar()
const namedSet = new Set(grammar.namedTypes)
const tokenSet = new Set(grammar.anonymousTokens)

const fixtures = readFixtureExpectations()
const sites = implementationSites()

// Applicability decided by the enumeration: EVERY needed production must be present.
const constructSurface: Record<string, any> = {}
for (const [value, row] of Object.entries(APPLICABLE)) {
  const present: string[] = []
  const absent: string[] = []
  for (const c of row.constructs) {
    if (namedSet.has(c) || tokenSet.has(c)) present.push(c)
    else absent.push(c)
  }
  constructSurface[value] = {
    applicable: absent.length === 0,
    constructs: row.constructs,
    present,
    absent,
    rule: row.rule,
    ...(row.adaptedSemantics ? { adaptedSemantics: row.adaptedSemantics } : {}),
    implementationSites: (sites[value] ?? []).map((line) => `src/ast/real-cpp-analyzer.ts:${line}`),
    implementationSymbol: `RelationshipType.${row.emissionSymbol}`,
  }
}

const notApplicableSurface: Record<string, any> = {}
for (const [value, row] of Object.entries(NOT_APPLICABLE)) {
  const found = row.needs.filter((c) => namedSet.has(c) || tokenSet.has(c))
  notApplicableSurface[value] = {
    applicable: false,
    grammarAbsenceProven: found.length === 0,
    requiredProductions: row.needs,
    productionsFound: found,
    reason: row.reason,
    vocabularyRuling: row.vocabularyRuling,
  }
}

// Construct surface: each named C++ construct, its grammar presence, and the values that
// carry it. A construct whose grammars are absent is a finding (the D1 handoff listed it).
const constructTable: Record<string, any> = {}
for (const row of CONSTRUCTS) {
  const present = row.grammars.filter((c) => namedSet.has(c) || tokenSet.has(c))
  const absent = row.grammars.filter((c) => !(namedSet.has(c) || tokenSet.has(c)))
  const badValue = row.carriedBy.find((v) => !(v in APPLICABLE))
  constructTable[row.construct] = {
    grammarConstructs: row.grammars,
    grammarPresent: present,
    grammarAbsent: absent,
    carriedBy: row.carriedBy,
    ...(badValue ? { invalidCarriedBy: badValue } : {}),
    ruling: row.ruling,
  }
}

// Fixture pins, from the fixtures' own rows.
const fixturePins: Record<string, { positiveFixtures: string[]; positiveRows: number; forbidRows: number }> = {}
for (const value of Object.keys(APPLICABLE)) {
  const positiveFixtures: string[] = []
  let positiveRows = 0
  let forbidRows = 0
  for (const f of fixtures) {
    let hit = false
    for (const r of f.rows) if (String(r.type ?? "") === value) { positiveRows++; hit = true }
    for (const r of f.forbidRows) if (String(r.type ?? "") === value) forbidRows++
    if (hit) positiveFixtures.push(f.fixture)
  }
  fixturePins[value] = { positiveFixtures, positiveRows, forbidRows }
}

// Baseline run, then one mutated run per applicable value.
const baseline = await runLang("cpp")
const baselineFail = new Set(baseline.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
const redProof: Record<string, any> = {}
for (const value of Object.keys(APPLICABLE)) {
  const mutant = await makeMutant("cpp", value)
  const mutated = await runLang("cpp", mutant)
  const mutatedFail = new Set(mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
  const wentRed: string[] = []
  for (const f of mutatedFail) if (!baselineFail.has(f)) wentRed.push(String(f))
  redProof[value] = {
    baselinePass: baseline.pass,
    baselineFail: baseline.fail,
    mutatedPass: mutated.pass,
    mutatedFail: mutated.fail,
    // A fixture that passed at baseline and fails with this value's edges removed is a
    // fixture that CAN go RED for the value.
    fixturesThatWentRed: wentRed.sort(),
    redProven: wentRed.length > 0,
  }
}

const applicableValues = Object.keys(APPLICABLE)
const notApplicableValues = Object.keys(NOT_APPLICABLE)
const findings: string[] = []
for (const value of applicableValues) {
  if (!constructSurface[value].applicable) findings.push(`${value}: construct productions ABSENT from the pinned grammar — ${constructSurface[value].absent.join(", ")}`)
  if ((constructSurface[value].implementationSites ?? []).length === 0) findings.push(`${value}: NO implementation site (no RelationshipType.${APPLICABLE[value].emissionSymbol} emission in src/ast/real-cpp-analyzer.ts)`)
  if (fixturePins[value].positiveFixtures.length === 0) findings.push(`${value}: NO fixture carries a positive expectation row for it`)
  if (!redProof[value].redProven) findings.push(`${value}: fixture-pinned but NO fixture went RED when the emission was removed`)
}
for (const value of notApplicableValues) {
  if (!notApplicableSurface[value].grammarAbsenceProven) findings.push(`${value}: claimed NOT APPLICABLE but the grammar carries ${notApplicableSurface[value].productionsFound.join(", ")}`)
}
for (const [construct, row] of Object.entries(constructTable)) {
  if (row.grammarPresent.length === 0) findings.push(`construct "${construct}": NONE of its grammar productions exist`)
  if (row.invalidCarriedBy) findings.push(`construct "${construct}": carriedBy names a value that is not in the applicable set — ${row.invalidCarriedBy}`)
}
// The rulings are STATEMENTS ABOUT THE GRAMMAR: a ruling whose absence claim is false must fail.
for (const r of RULINGS) {
  if (r.id === "CPP-R1") {
    const absent = ["implements_clause", "class_interface_clause", "super_interfaces"].filter((c) => namedSet.has(c) || tokenSet.has(c))
    if (absent.length > 0) findings.push(`${r.id}: the grammar DOES carry an implements-clause production (${absent.join(", ")}); CPP-R1's grammar-absence evidence is stale`)
  }
  if (r.id === "CPP-R2") {
    const need = ["template_instantiation", "new_expression"].filter((c) => !(namedSet.has(c) || tokenSet.has(c)))
    if (need.length > 0) findings.push(`${r.id}: grammar lacks ${need.join(", ")} — the template-instantiation-vs-instantiates ruling cannot be stated from this grammar`)
  }
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-applicable-set.ts",
  measuredAt: new Date().toISOString(),
  language: "cpp",
  admissibilityRule: "APPLICABLE iff every construct production the value needs exists in the pinned grammar's own enumeration AND the analyzer has an emission site AND at least one fixture carries a positive expectation row AND that fixture goes RED when the emission is removed. A value failing any conjunct is a finding, not a note.",
  canonicalVocabulary: [...applicableValues, ...notApplicableValues],
  applicableValues,
  notApplicableValues,
  grammar,
  constructSurface,
  notApplicableSurface,
  constructTable,
  rulings: RULINGS,
  fixturePins,
  fixtureBaseline: {
    command: "imported runLang('cpp') from script/m14/run-fixtures.ts (the real runner)",
    pass: baseline.pass,
    fail: baseline.fail,
    failingFixtures: [...baselineFail].sort(),
  },
  redProof,
  redProofMethod: "the REAL RealCppAnalyzer wrapped so exactly one relationship value's edges are removed; the runner's own getParser grammar handoff is reproduced in the wrapper. baseline vs mutated are the same runner, same fixtures, same analyzer except for the removed value.",
  findings,
  ok: findings.length === 0,
}

const json = JSON.stringify(report, null, 1) + "\n"
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)
}
process.stdout.write(json)
process.exit(report.ok ? 0 : 1)
