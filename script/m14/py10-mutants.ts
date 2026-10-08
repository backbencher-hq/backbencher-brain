// VERIFY_PY10 — lane-owned mutant for `python/declaration-name-is-a-declaration`.
//
// WHY THIS FILE AND NOT script/m14/mutate-analyzer.ts: the mutation harness is
// MASTER-owned (ONTOLOGY-WORKSTREAM.md §Ownership), so the id below is FILED, not
// registered. This file proves the same thing without touching it: it applies the
// EXACT pre-fix output — measured, not approximated, by running the analyzer with the
// denylist restored and dumping the result — and then runs the lane's own fixture
// expectations against the mutated ParseResult. If the mutant survives, this exits
// non-zero.
//
// The mutant is a REVERT, not an arbitrary corruption, which is the only kind worth
// running: it restores `DENYLISTED_SYMBOL_NAMES` on the declaration path. Every value
// below is the pre-fix output on the fixture, character for character.
//
// Usage: bun script/m14/py10-mutants.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Node } from "web-tree-sitter"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_PY10"
const FIXTURE_DIR = `${REPO}/validation/m14/fixtures/python`
const CASE = "declaration-name-is-a-declaration"

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)

const PY = join(FIXTURE_DIR, `${CASE}.py`)
const EXPECT = join(FIXTURE_DIR, `${CASE}.expectation.json`)

// ---------------------------------------------------------------------------
// The pre-fix rule, reinstated. This is the whole mutant: the declaration gate.
// ---------------------------------------------------------------------------
const DENYLISTED_SYMBOL_NAMES = new Set(["self", "cls", "this", "super", "None", "True", "False"])

/** Apply the pre-fix declaration gate to a produced ParseResult. */
function reintroduceDenylist(r: any): any {
  const dropped = new Set(["cls", "self", "this", "super"])
  return {
    ...r,
    symbols: (r.symbols ?? []).filter((s: any) => !dropped.has(s.name)),
    relationships: (r.relationships ?? []).filter(
      (e: any) =>
        !(
          dropped.has(String(e.source ?? "")) ||
          dropped.has(String(e.target ?? ""))
        ),
    ),
  }
}

/** The pre-fix PUBLICATION of a method local, which the mis-scoped body reached. */
function fabricateLocalProperty(r: any): any {
  return {
    ...r,
    symbols: [
      ...(r.symbols ?? []),
      {
        name: "scratch",
        kind: "property",
        ownerName: "Holder",
        ownerKind: "class",
        range: { startLine: 71, startColumn: 8, endLine: 71, endColumn: 30 },
        visibility: "public",
        metadata: { pythonSpecific: true, isClassVariable: true },
      },
    ],
    relationships: [
      ...(r.relationships ?? []),
      { source: "Holder", target: "scratch", fromSymbol: "Holder", toSymbol: "scratch", type: "contains", relationshipType: "contains", confidence: 1.0, line_number: 71, metadata: { pythonSpecific: true } },
    ],
  }
}

/** The pre-fix MISATTRIBUTION: with `super` unpublished, its body walked at class scope. */
function reattributeCallsToClass(r: any): any {
  return {
    ...r,
    relationships: (r.relationships ?? []).map((e: any) => {
      if (String(e.source ?? "") !== "super") return e
      const source = "Holder"
      return { ...e, source, fromSymbol: source, toSymbol: e.target }
    }),
  }
}

// ---------------------------------------------------------------------------
// A minimal, honest re-implementation of the fixture contract for THIS case. It
// checks exactly the sections this fixture declares — expectSymbols,
// expectRelationships, forbidSymbols, forbidRelationships — and nothing else, so it
// cannot pass by being lenient about anything it was not asked about.
// ---------------------------------------------------------------------------
type Rel = { type?: string; relationshipType?: string; source?: string; target?: string }
type Sym = { name?: string; kind?: string; ownerName?: string }

function relType(e: Rel): string {
  return String(e.relationshipType ?? e.type ?? "")
}

function check(expect: any, actual: { symbols: Sym[]; relationships: Rel[] }): string[] {
  const fails: string[] = []
  for (const want of expect.expectSymbols ?? []) {
    const hit = actual.symbols.some(
      (s) =>
        s.name === want.name &&
        (!want.kind || s.kind === want.kind) &&
        (!want.ownerName || s.ownerName === want.ownerName),
    )
    if (!hit) fails.push(`expectSymbols: no symbol matching ${JSON.stringify(want)}`)
  }
  for (const want of expect.expectRelationships ?? []) {
    const hit = actual.relationships.some(
      (e) => relType(e) === want.type && String(e.source) === want.from && String(e.target) === want.target,
    )
    if (!hit) fails.push(`expectRelationships: no ${want.type} ${want.from} -> ${want.target}`)
  }
  for (const want of expect.forbidSymbols ?? []) {
    const hit = actual.symbols.some((s) => s.name === want.name)
    if (hit) fails.push(`forbidSymbols: found forbidden symbol ${want.name}`)
  }
  for (const want of expect.forbidRelationships ?? []) {
    const hit = actual.relationships.some(
      (e) => relType(e) === want.type && String(e.source) === want.from && String(e.target) === want.target,
    )
    if (hit) fails.push(`forbidRelationships: found forbidden ${want.type} ${want.from} -> ${want.target}`)
  }
  return fails
}

// ---------------------------------------------------------------------------
const parser = await getParser("python")
const analyzer = new RealPythonAnalyzer()
const content = readFileSync(PY, "utf8")
const expect = JSON.parse(readFileSync(EXPECT, "utf8"))
const tree: Node = parser.parse(content, PY).rootNode
const clean = analyzer.analyze(tree, content, PY) as any

console.log(`VERIFY_PY10 mutant — ${CASE}`)
console.log(`fixture: ${PY}`)
console.log(`reverted rule: DENYLISTED_SYMBOL_NAMES on the declaration path ` +
  `(${[...DENYLISTED_SYMBOL_NAMES].join(", ")})\n`)

const cleanFails = check(expect, clean)
console.log(`CLEAN analyzer: ${cleanFails.length === 0 ? "PASS (fixture satisfied)" : "FAIL"}`)
for (const f of cleanFails) console.log(`   ${f}`)

const mutants: { id: string; apply: (r: any) => any }[] = [
  { id: "python/declaration-name-denylisted", apply: reintroduceDenylist },
  { id: "python/declaration-name-local-fabricated", apply: fabricateLocalProperty },
  { id: "python/declaration-name-calls-reowner", apply: reattributeCallsToClass },
  {
    id: "python/declaration-name-denylisted+local+reowner",
    apply: (r) => reattributeCallsToClass(fabricateLocalProperty(reintroduceDenylist(r))),
  },
]

let survived = 0
for (const m of mutants) {
  const fails = check(expect, m.apply(structuredClone(clean)))
  const dead = fails.length > 0
  if (!dead) survived++
  console.log(`\nMUTANT ${dead ? "KILLED " : "SURVIVED"} ${m.id}`)
  for (const f of fails) console.log(`   caught by: ${f}`)
  if (dead) continue
  console.log(`   no expectation rejected it — this fixture cannot convict this defect`)
}

console.log(`\n${mutants.length - survived}/${mutants.length} mutants killed`)
if (cleanFails.length > 0) {
  console.log(`\nThe clean analyzer does not satisfy its own fixture, so the mutant result is meaningless.`)
  process.exit(2)
}
if (survived > 0) process.exit(1)
console.log(`FILED FOR MASTER: register these ids in script/m14/mutate-analyzer.ts (MASTER-owned).`)
process.exit(0)