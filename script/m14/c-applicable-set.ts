/**
 * C APPLICABLE SET — the D1 instrument (ALL-OUT-OF-ALL programme, charter §9.1 D1).
 *
 * Answers three questions with MEASUREMENTS, in one run, so the C lane's D1 claim is a
 * command and not a paragraph:
 *
 *   1. WHAT CAN THE PINNED GRAMMAR EXPRESS? The pinned `wasm/tree-sitter-c.wasm` is
 *      enumerated through web-tree-sitter's own Language API (nodeTypeCount /
 *      nodeTypeIsNamed / nodeTypeForId), and every candidacy is answered from that
 *      enumeration: a relationship value is APPLICABLE only when the construct
 *      productions it needs are PRESENT, and NON-APPLICABLE values carry the named
 *      productions the enumeration says are ABSENT. Nothing here is read from intuition
 *      or from the ten-value matrix.
 *
 *   2. WHAT PINS EACH APPLICABLE VALUE? The lane's own fixture expectations are parsed
 *      and every applicable value must have at least one POSITIVE `expectRelationships`
 *      row naming it (a fixture with no such row is a value nothing can go red for).
 *
 *   3. CAN THE FIXTURE ACTUALLY GO RED? The fixture runner is the real one
 *      (`runLang`/`matchConstraints` imported from script/m14/run-fixtures.ts), run once
 *      per applicable value through an override analyzer that is the REAL analyzer with
 *      exactly that value's edges removed. A fixture that PASSED at baseline and FAILS
 *      with the emission absent is a fixture that can go RED for that value — a pin that
 *      cannot fail proves nothing, so this is measured rather than assumed.
 *
 * The mutated analyzer is a WRAPPER over a fresh RealCAnalyzer with the grammar handoff
 * reproduced (the runner skips its own handoff when an override is supplied, so the
 * wrapper does it), i.e. the only difference between the baseline run and the mutated run
 * is the one relationship value under test.
 *
 * Usage:
 *   bun run script/m14/c-applicable-set.ts                 # JSON to stdout
 *   bun run script/m14/c-applicable-set.ts --out <path>    # JSON to a file too
 *
 * Exit: 0 when every applicable value is implemented, fixture-pinned and demonstrably
 *       RED-able; 1 when any of those three is missing (the finding is the output, not a
 *       crash).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const OUT_FLAG = process.argv.indexOf("--out")
const OUT = OUT_FLAG >= 0 && process.argv[OUT_FLAG + 1] ? path.resolve(process.argv[OUT_FLAG + 1]) : null

const { runLang, getParser } = await import("./run-fixtures")

const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "c")
const ANALYZER = path.join(ROOT, "src", "ast", "real-c-analyzer.ts")
const WASM = path.join(ROOT, "wasm", "tree-sitter-c.wasm")

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE CANONICAL VALUES, and which ones this lane claims are applicable
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// The canonical vocabulary is the 14 emitted values in src/ast/types.ts:RelationshipType
// (ten canonical + four extended). The APPLICABLE set below is not copied from the matrix:
// each row is decided by the grammar enumeration in section 2 and recorded with the
// construct productions it rests on. `overrides` carries an ADAPTED reason because C has
// no inheritance — the construct it names here is macro redefinition, and the adapted
// semantics are declared in the row rather than folded into "C has inheritance".
const APPLICABLE: Record<string, {
  constructs: string[]          // grammar productions the value's construct needs
  rule: string                  // what the construct is, in the analyzer's terms
  emissionSymbol: string        // RelationshipType.<member> used at the emission sites
}> = {
  calls: {
    constructs: ["call_expression", "argument_list"],
    rule: "call_expression with an identifier / field_expression / function-pointer callee (the callee is the named target; a call-shaped DECLARATION is not a call — #912).",
    emissionSymbol: "Calls",
  },
  uses: {
    constructs: ["field_expression", "identifier", "assignment_expression", "update_expression"],
    rule: "a READ of an in-file declared name: field reads (field_expression) and bare identifier reads; assignment-LHS / update targets are writes and are pinned as uses per #960, never silently dropped.",
    emissionSymbol: "Uses",
  },
  contains: {
    constructs: ["struct_specifier", "union_specifier", "enum_specifier", "field_declaration", "field_declaration_list", "enumerator", "enumerator_list"],
    rule: "container → member: struct/union → field (property), enum → enumerator (enum_member); the container is a published symbol and the member is owned by it.",
    emissionSymbol: "Contains",
  },
  imports: {
    constructs: ["preproc_include", "system_lib_string", "string_literal"],
    rule: "preproc_include → the include path, published as the `imports` kind (import_based evidence tier). The target is a module path, not a symbol, by construction of the type.",
    emissionSymbol: "Imports",
  },
  references: {
    constructs: ["type_identifier", "sizeof_expression", "cast_expression", "parameter_declaration", "field_declaration", "type_definition"],
    rule: "a TYPE mention in a type position (declared types, sizeof/cast type operands, declarator type fields), targeted at the file's declared type; a value identifier in a value position is `uses`, not `references`.",
    emissionSymbol: "References",
  },
  exports: {
    constructs: ["linkage_specification", "storage_class_specifier", "attribute_specifier", "attribute_declaration", "preproc_def", "preproc_function_def"],
    rule: "three emission forms: (A) extern-linkage markers defined in the file and applied to a declaration, (B) GNU/attribute spellings behind a marker macro, (C) compound-statement declarations the recovery pass carries — a marker on a LOCAL declaration and a non-agreeing platform arm are REFUSED (#989).",
    emissionSymbol: "Exports",
  },
  overrides: {
    constructs: ["preproc_def", "preproc_function_def", "preproc_call", "preproc_if", "preproc_ifdef", "preproc_elif", "preproc_else"],
    rule: "ADAPTED SEMANTICS, declared: C has no inheritance. The construct the value carries here is REDEFINITION — two definitions in mutually exclusive preprocessor arms (C 6.9p5), or `#undef X` then `#define X` (C 6.10.3p2). Emitted with metadata.relationshipType `c_redefinition` and metadata.shape (`conditional-redefinition` / `undef-redefine`); an unconditional second definition is a constraint violation and is REFUSED.",
    emissionSymbol: "Overrides",
  },
  instantiates: {
    constructs: ["call_expression", "cast_expression", "sizeof_expression", "type_identifier"],
    rule: "an ALLOCATION whose produced type is stated by the source: `(T *)malloc(...)` reads the cast, else `sizeof(T)` in the argument list; the target must be a type the file DECLARES, so `void *` allocates no named type (#962/#989).",
    emissionSymbol: "Instantiates",
  },
}

const NOT_APPLICABLE: Record<string, {
  needs: string[]               // productions that would have to exist
  reason: string
  vocabularyRuling: string
}> = {
  extends: {
    needs: ["class_specifier", "class_declaration", "base_class_clause", "superclass", "extends_clause", "extends_interfaces"],
    reason: "C has no class and no superclass slot: none of the productions above exists in the pinned grammar, so no declaration can write an IS-A relation.",
    vocabularyRuling: "canonical value, NOT APPLICABLE to C (C-D1). The prior lane's cross-grammar control recorded: the identical probe finds base_class_clause in tree-sitter-cpp, superclass in tree-sitter-groovy, extends_clause in tree-sitter-scala — a zero here is a reading, not a blind probe (script/m14/spec/c-completeness.json `coverage.excluded`).",
  },
  implements: {
    needs: ["interface_declaration", "super_interfaces", "implements_clause", "class_interface_clause"],
    reason: "no interface/conformance production exists in the pinned C grammar; there is nothing a declaration could satisfy.",
    vocabularyRuling: "canonical value, NOT APPLICABLE to C (C-D1); cross-grammar control in the same spec block (interface_declaration in c_sharp/groovy/java, interface_type in go).",
  },
  decorates: {
    needs: ["decorator", "annotation", "annotation_declaration", "marker_annotation", "decorator_expression"],
    reason: "C has no decorator/annotation production. It DOES have `attribute_specifier`/`attribute_declaration` (GNU and C23 attributes), and they are adjudicated here rather than ignored: an attribute names no declaration of its own (it is a keyword/macro-written specifier, not an applied callable), and the analyzer records linkage/storage-class attributes as SYMBOL METADATA — the same ruling the java lane applied to annotations (references+isAnnotation, decorates reserved for runtime callable decorators). No C fixture expects an `attribute`-shaped edge, and none exists to derive.",
    vocabularyRuling: "extended value, NOT APPLICABLE to C.",
  },
  renders: {
    needs: ["jsx_element", "jsx_self_closing_element", "jsx_opening_element", "jsx_attribute"],
    reason: "no JSX/element-construction production exists in the pinned C grammar; C never creates a component-element pair.",
    vocabularyRuling: "extended value (TSX/JSX), NOT APPLICABLE to C.",
  },
  mixes_in: {
    needs: ["mixin", "mixins", "with_clause", "mixin_application_class"],
    reason: "no mixin/with production exists in the pinned C grammar.",
    vocabularyRuling: "extended value (Dart `with`), NOT APPLICABLE to C.",
  },
  part_of: {
    needs: ["part_directive", "part_of_directive", "part_clause"],
    reason: "C's file-inclusion construct is `#include`, which IS a module/binding edge and is published as `imports`; there is no part-file directive that shares one scope without importing (the construct `part_of` exists to distinguish).",
    vocabularyRuling: "extended value (Dart `part`/`part of`), NOT APPLICABLE to C.",
  },
}

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
      fixture: `c/${f.replace(".expectation.json", "")}`,
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
      // A TERNARY emission (`type: cond ? …References : …Uses`) is still one property, so the
      // test is "the line writes a `type:` property naming this value", not "the line equals it".
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
async function makeMutant(value: string): Promise<any> {
  const parser = await getParser("c")
  const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
  const real = new mod.RealCAnalyzer()
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
    implementationSites: (sites[value] ?? []).map((line) => `src/ast/real-c-analyzer.ts:${line}`),
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
const baseline = await runLang("c")
const baselineFail = new Set(baseline.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
const redProof: Record<string, any> = {}
for (const value of Object.keys(APPLICABLE)) {
  const mutant = await makeMutant(value)
  const mutated = await runLang("c", mutant)
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
  if ((constructSurface[value].implementationSites ?? []).length === 0) findings.push(`${value}: NO implementation site (no RelationshipType.${APPLICABLE[value].emissionSymbol} occurrence in src/ast/real-c-analyzer.ts)`)
  if (fixturePins[value].positiveFixtures.length === 0) findings.push(`${value}: NO fixture carries a positive expectation row for it`)
  if (!redProof[value].redProven) findings.push(`${value}: fixture-pinned but NO fixture went RED when the emission was removed`)
}
for (const value of notApplicableValues) {
  if (!notApplicableSurface[value].grammarAbsenceProven) findings.push(`${value}: claimed NOT APPLICABLE but the grammar carries ${notApplicableSurface[value].productionsFound.join(", ")}`)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/c-applicable-set.ts",
  measuredAt: new Date().toISOString(),
  language: "c",
  admissibilityRule: "APPLICABLE iff every construct production the value needs exists in the pinned grammar's own enumeration AND the analyzer has an emission site AND at least one fixture carries a positive expectation row AND that fixture goes RED when the emission is removed. A value failing any conjunct is a finding, not a note.",
  canonicalVocabulary: [...applicableValues, ...notApplicableValues],
  applicableValues,
  notApplicableValues,
  grammar,
  constructSurface,
  notApplicableSurface,
  fixturePins,
  fixtureBaseline: {
    command: "imported runLang('c') from script/m14/run-fixtures.ts (the real runner)",
    pass: baseline.pass,
    fail: baseline.fail,
    failingFixtures: [...baselineFail].sort(),
  },
  redProof,
  redProofMethod: "the REAL analyzer wrapped so exactly one relationship value's edges are removed; the runner's own getParser grammar handoff is reproduced in the wrapper. baseline vs mutated are the same runner, same fixtures, same analyzer except for the removed value.",
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
