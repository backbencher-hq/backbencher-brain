/**
 * RUBY APPLICABLE SET — the D1 instrument (ALL-OUT-OF-ALL charter §9.1 D1, phase 2 / task-13).
 *
 * Answers three questions with MEASUREMENTS, in one run, so the Ruby lane's D1 claim is a command and
 * not a paragraph — the C lane's template:
 *
 *   1. WHAT CAN THE PINNED GRAMMAR EXPRESS? `wasm/tree-sitter-ruby.wasm` is enumerated through
 *      web-tree-sitter's own Language API (nodeTypeCount / nodeTypeIsNamed / nodeTypeForId), and every
 *      candidacy is answered from that enumeration: a canonical value is APPLICABLE only when the
 *      construct productions it needs are PRESENT, and NON-APPLICABLE values carry the named
 *      productions the enumeration says are ABSENT. Nothing is read from intuition or from the
 *      ten-value matrix.
 *
 *   2. WHAT PINS EACH APPLICABLE VALUE? The lane's own fixture expectations are parsed and every
 *      applicable value must have at least one POSITIVE `expectRelationships` row naming it.
 *
 *   3. CAN THE FIXTURE ACTUALLY GO RED? The real fixture runner is run once per applicable value
 *      through an override analyzer that is the REAL analyzer with exactly that value's edges removed.
 *      A fixture that PASSED at baseline and FAILS with the emission absent is a fixture that can go
 *      RED for that value.
 *
 * RUBY-SPECIFIC RULINGS (grammar-derived, never assumed — the task-13 brief names them):
 *   - `include`/`prepend`/`extend` are MODULE MIXIN composition, not conformance and not superclass
 *     inheritance. The canonical vocabulary has exactly one value for that construct: `mixes_in`
 *     (source = the composing class/module, target = the mixin; Dart's `with` is the measured
 *     population of the same value). So `mixes_in` is APPLICABLE for Ruby, and the family's previous
 *     adaptation (include/prepend -> `implements`, extend -> `extends`) is recorded as the ADAPTED
 *     SEMANTICS that the relabel replaces. `implements` therefore becomes NOT APPLICABLE: Ruby has no
 *     interface/conformance construct — no keyword, no production, no enforcement — and the value it
 *     currently carries here is a mixin wearing the wrong name.
 *   - `class B < A` remains `extends`; a factory `K = Class.new(Base)` (the analyzer's factory path)
 *     also names a superclass and stays `extends`.
 *   - `exports` IS applicable with adapted semantics: Ruby's file-unit export surface (top-level
 *     constants/defs, with `private_constant`/singleton-class refusals) is what a unit makes
 *     reachable, which is exactly the canonical meaning of the value.
 *   - `decorates`/`renders`/`part_of` are NOT APPLICABLE (no decorator/JSX/part-file productions).
 *
 * Usage:
 *   bun run script/m14/ruby-applicable-set.ts [--out <path>]
 *
 * Exit: 0 when every applicable value is implemented, fixture-pinned and demonstrably RED-able and
 *       every not-applicable value has no emission; 1 otherwise (the finding is the output).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const OUT_FLAG = process.argv.indexOf("--out")
const OUT = OUT_FLAG >= 0 && process.argv[OUT_FLAG + 1] ? path.resolve(process.argv[OUT_FLAG + 1]) : null

const { runLang, getParser } = await import("./run-fixtures")

const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "ruby")
const ANALYZER = path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts")
const WASM = path.join(ROOT, "wasm", "tree-sitter-ruby.wasm")

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE CANONICAL VALUES, and which ones this lane claims are applicable
// ─────────────────────────────────────────────────────────────────────────────────────────────
const APPLICABLE: Record<string, {
  constructs: string[]
  rule: string
  emissionSymbol: string
}> = {
  calls: {
    constructs: ["call", "argument_list", "block"],
    rule: "a `call` whose callee is not a builtin (the pinned grammar has exactly ONE call node type — `command`/`command_call` cannot occur); bare identifiers in expression position that are not locals are calls with `bareCall: true`; the source is the enclosing method, else the owner, else the file-scope sentinel.",
    emissionSymbol: "Calls",
  },
  uses: {
    constructs: ["instance_variable", "call"],
    rule: "instance-variable READS (`memberRead`) and ActiveRecord association macros (`activerecordMacro`); writes — including compound-assignment LHS — stay silent.",
    emissionSymbol: "Uses",
  },
  contains: {
    constructs: ["class", "module", "method", "singleton_method", "assignment", "do_block"],
    rule: "one edge per OWNED symbol (methods/constants/DSL-block members), from `ownerName`; a factory-declared type (`K = Class.new(Base) do belongs_to :acct end`) owns the block's members, a bare `Class.new do … end` named by nothing owns nothing (the oracle's NAMABLE-OWNER rule is the analyzer's too).",
    emissionSymbol: "Contains",
  },
  imports: {
    constructs: ["call", "string", "string_content"],
    rule: "`require`/`require_relative`/`load`/`autoload` — one `imports` edge per required path (file-level, `requireMethod` metadata, `resolution: file-relative | load-path`) and the same fact as a `references` row; the `imports[]` payload channel is written one-for-one with the edge.",
    emissionSymbol: "Imports",
  },
  references: {
    constructs: ["constant", "scope_resolution", "call"],
    rule: "constant/scope-resolution mentions in read/type positions, plus the require/load path strings (the `references` half of the load-fact pair).",
    emissionSymbol: "References",
  },
  exports: {
    constructs: ["assignment", "method", "singleton_method", "call"],
    rule: "ADAPTED SEMANTICS, declared: Ruby has no export keyword, but a FILE UNIT has a reachable surface — top-level constants/defs, source = the file unit, with the measured refusals (singleton-class members, `private_constant`, reopens/duplicates are one unit, unnameable symbols).",
    emissionSymbol: "Exports",
  },
  extends: {
    constructs: ["class", "call"],
    rule: "`class B < A` when the base is a statically nameable constant path (the edge's line is the base type node, #825), plus the factory spelling `K = Class.new(Base)` (both ends written).",
    emissionSymbol: "Extends",
  },
  mixes_in: {
    constructs: ["call", "module", "class"],
    rule: "CANONICAL mixin composition, relabelled from the family's previous adaptation: `include M` / `prepend M` compose M into the class's ancestor chain and `extend M` composes it into the singleton class — source = the composing class/module, target = the mixin, `metadata.mixinRole` records which keyword; dynamic (lowercase/computed) arguments emit nothing (mixin targets must be statically nameable constants).",
    emissionSymbol: "MixesIn",
  },
  overrides: {
    constructs: ["method", "class"],
    rule: "a subclass method redefining a base-class method: 0.95 when the base method is verifiable from local declarations or the project companion index, 0.5 with `reasonCode: first-parent-guess` when the base is external and unverifiable (the declared-cause channel).",
    emissionSymbol: "Overrides",
  },
  instantiates: {
    constructs: ["call", "constant"],
    rule: "`X.new` on a constant receiver; a receiverless `new` names the enclosing class (`resolvedTarget: enclosing-class`); expression/variable receivers emit nothing (RB-A).",
    emissionSymbol: "Instantiates",
  },
}

const NOT_APPLICABLE: Record<string, {
  needs: string[]
  reason: string
  vocabularyRuling: string
}> = {
  implements: {
    needs: ["interface", "implements_clause", "super_interfaces", "conformance"],
    reason: "Ruby has no interface/conformance construct — no keyword, no production, no enforcement; duck typing is not a declared conformance. The edges this lane used to publish under `implements` are `include`/`prepend` module composition, which the canonical vocabulary spells `mixes_in`.",
    vocabularyRuling: "canonical value, NOT APPLICABLE to Ruby after the RUBY-D1 relabel (the previous adaptation is recorded, not erased: implements 17 edges at the cap-50 baseline become mixes_in, delta measured).",
  },
  decorates: {
    needs: ["decorator", "annotation", "annotation_declaration"],
    reason: "no decorator/annotation production exists in the pinned Ruby grammar; `attr_reader`/`attr_accessor` macros are DSL CALLS (the analyzer carries the ActiveRecord macros as `uses`), not applied decorators — a macro names no callable that wraps the declaration.",
    vocabularyRuling: "extended value, NOT APPLICABLE to Ruby.",
  },
  renders: {
    needs: ["jsx_element", "jsx_self_closing_element", "jsx_opening_element"],
    reason: "no JSX/element-construction production exists in the pinned Ruby grammar; ERB/HTML templates are other languages/files and are routed to their own analyzers.",
    vocabularyRuling: "extended value (TSX/JSX), NOT APPLICABLE to Ruby.",
  },
  part_of: {
    needs: ["part_directive", "part_of_directive", "part_clause"],
    reason: "Ruby's file-inclusion construct is `require`/`load`, which creates load/binding scope and is published as `imports`+`references`; there is no shared-scope part-file directive that imports nothing (the distinction `part_of` exists to draw).",
    vocabularyRuling: "extended value (Dart `part`/`part of`), NOT APPLICABLE to Ruby.",
  },
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2 · THE PINNED GRAMMAR, enumerated (constructs, not intuition)
// ─────────────────────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3 · FIXTURE PINS — read from the fixtures' own expectation rows
// ─────────────────────────────────────────────────────────────────────────────────────────────
function readFixtureExpectations(): Array<{ fixture: string; rows: any[]; forbidRows: any[] }> {
  const out: Array<{ fixture: string; rows: any[]; forbidRows: any[] }> = []
  for (const f of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!f.endsWith(".expectation.json")) continue
    const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8"))
    out.push({ fixture: `ruby/${f.replace(".expectation.json", "")}`, rows: exp.expectRelationships ?? [], forbidRows: exp.forbidRelationships ?? [] })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4 · IMPLEMENTATION SITES — read from the analyzer source
// ─────────────────────────────────────────────────────────────────────────────────────────────
function implementationSites(): Record<string, number[]> {
  const src = fs.readFileSync(ANALYZER, "utf8").split("\n")
  const sites: Record<string, number[]> = {}
  for (const [value, row] of Object.entries(APPLICABLE)) {
    const needle = `RelationshipType.${row.emissionSymbol}`
    const hits: number[] = []
    for (let i = 0; i < src.length; i++) {
      if (!src[i].includes(needle)) continue
      if (src[i].includes("!==") || src[i].includes("===")) continue
      // An emission site is either the `type:` property that pushes the value, or the selector
      // that CHOOSES it for a shared push (this file's mixin block computes `const relType = …`
      // and pushes `type: relType`, which is one site, not zero).
      const isPush = src[i].includes("type:")
      const isSelector = src[i].includes("= ASTEngine.") || src[i].includes(": ASTEngine.")
      if (!isPush && !isSelector) continue
      hits.push(i + 1)
    }
    sites[value] = hits
  }
  return sites
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5 · RED PROOF — real runner, real analyzer, one value removed
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function makeMutant(value: string): Promise<any> {
  const parser = await getParser("ruby")
  const mod: any = await import(path.join(ROOT, "src/ast/real-ruby-analyzer.ts"))
  const real = new mod.RealRubyAnalyzer()
  const ctor: any = real?.constructor
  if (typeof ctor?.setGrammar === "function") {
    try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* main pass only */ }
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────────────────────
const grammar = await enumerateGrammar()
const namedSet = new Set(grammar.namedTypes)
const tokenSet = new Set(grammar.anonymousTokens)

const fixtures = readFixtureExpectations()
const sites = implementationSites()

const constructSurface: Record<string, any> = {}
for (const [value, row] of Object.entries(APPLICABLE)) {
  const present: string[] = []
  const absent: string[] = []
  for (const c of row.constructs) (namedSet.has(c) || tokenSet.has(c) ? present : absent).push(c)
  constructSurface[value] = {
    applicable: absent.length === 0,
    constructs: row.constructs,
    present,
    absent,
    rule: row.rule,
    implementationSites: (sites[value] ?? []).map((line) => `src/ast/real-ruby-analyzer.ts:${line}`),
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

const baseline = await runLang("ruby")
const baselineFail = new Set(baseline.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
const redProof: Record<string, any> = {}
for (const value of Object.keys(APPLICABLE)) {
  const mutant = await makeMutant(value)
  const mutated = await runLang("ruby", mutant)
  const mutatedFail = new Set(mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
  const wentRed: string[] = []
  for (const f of mutatedFail) if (!baselineFail.has(f)) wentRed.push(String(f))
  redProof[value] = {
    baselinePass: baseline.pass, baselineFail: baseline.fail,
    mutatedPass: mutated.pass, mutatedFail: mutated.fail,
    fixturesThatWentRed: wentRed.sort(),
    redProven: wentRed.length > 0,
  }
}

// A NOT-APPLICABLE value must have NO emission: count them through the real analyzer over the whole
// fixture corpus (positive evidence of absence, not an assumption).
const notApplicableEmission: Record<string, { edges: number; fixtures: string[] }> = {}
{
  const parser = await getParser("ruby")
  const mod: any = await import(path.join(ROOT, "src/ast/real-ruby-analyzer.ts"))
  const analyzer = new mod.RealRubyAnalyzer()
  const ctor: any = analyzer?.constructor
  if (typeof ctor?.setGrammar === "function") { try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* main pass only */ } }
  for (const value of Object.keys(NOT_APPLICABLE)) notApplicableEmission[value] = { edges: 0, fixtures: [] }
  for (const f of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!f.endsWith(".rb")) continue
    const content = fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")
    const tree = parser.parse(content)
    let res: any
    try { res = await analyzer.analyze(tree.rootNode, content, `fixtures/ruby/${f}`) } catch { continue }
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? "")
      if (t in notApplicableEmission) { notApplicableEmission[t].edges++; if (!notApplicableEmission[t].fixtures.includes(f)) notApplicableEmission[t].fixtures.push(f) }
    }
    try { tree.delete?.() } catch { /* polite */ }
  }
}

const applicableValues = Object.keys(APPLICABLE)
const notApplicableValues = Object.keys(NOT_APPLICABLE)
const findings: string[] = []
for (const value of applicableValues) {
  if (!constructSurface[value].applicable) findings.push(`${value}: construct productions ABSENT — ${constructSurface[value].absent.join(", ")}`)
  if ((constructSurface[value].implementationSites ?? []).length === 0) findings.push(`${value}: NO implementation site (no RelationshipType.${APPLICABLE[value].emissionSymbol} emission in src/ast/real-ruby-analyzer.ts)`)
  if (fixturePins[value].positiveFixtures.length === 0) findings.push(`${value}: NO fixture carries a positive expectation row for it`)
  if (!redProof[value].redProven) findings.push(`${value}: fixture-pinned but NO fixture went RED when the emission was removed`)
}
for (const value of notApplicableValues) {
  if (!notApplicableSurface[value].grammarAbsenceProven) findings.push(`${value}: claimed NOT APPLICABLE but the grammar carries ${notApplicableSurface[value].productionsFound.join(", ")}`)
  if (notApplicableEmission[value].edges > 0) findings.push(`${value}: ruled NOT APPLICABLE but the analyzer emits ${notApplicableEmission[value].edges} edge(s) over the fixture corpus (${notApplicableEmission[value].fixtures.join(", ")})`)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/ruby-applicable-set.ts",
  measuredAt: new Date().toISOString(),
  language: "ruby",
  admissibilityRule: "APPLICABLE iff every construct production the value needs exists in the pinned grammar's own enumeration AND the analyzer has an emission site AND at least one fixture carries a positive expectation row AND that fixture goes RED when the emission is removed. A NOT-APPLICABLE value must have zero emissions over the fixture corpus. A value failing any conjunct is a finding, not a note.",
  canonicalVocabulary: [...applicableValues, ...notApplicableValues],
  applicableValues,
  notApplicableValues,
  grammar,
  constructSurface,
  notApplicableSurface,
  notApplicableEmission,
  fixturePins,
  fixtureBaseline: {
    command: "imported runLang('ruby') from script/m14/run-fixtures.ts (the real runner)",
    pass: baseline.pass, fail: baseline.fail,
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
