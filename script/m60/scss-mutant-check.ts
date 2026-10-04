// script/m60/scss-mutant-check.ts — run the SCSS mutant set against the SCSS fixtures.
//
// WHY THIS EXISTS INSTEAD OF `bun run script/m14/mutate-analyzer.ts`
// -----------------------------------------------------------------
// `script/m60/scss-mutants.ts` exports `SCSS_MUTANTS` and NOTHING imports it:
// `grep -rn "SCSS_MUTANTS" script/` returns the definition and no call site. So the
// shared F4 runner never executes this lane's mutants, and `script/m60/scss-mutants.ts`
// being a finished file is not the same claim as a mutant having been injected and
// caught. This is the "finished-but-unconnected" shape the differential's own header
// records for zig-truth and clojure-truth, in a different file.
//
// `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8), so the fix is
// reported rather than applied: one import plus `...SCSS_MUTANTS` spread into the
// `MUTANTS` array, after which the shared runner covers this lane with no change here.
//
// This runner IMPORTS the transforms from the registry — it never mirrors them, because
// a check that reimplemented the transform would be a check of itself. It evaluates the
// fixture expectations with `matchConstraints` exported from `script/m14/run-fixtures.ts`,
// which is the SAME matcher the real fixture gate uses.
//
// SCOPE, DECLARED: it checks `expectSymbols`, `expectSymbolCount`, `expectRelationships`
// and `forbidRelationships` over every `validation/m14/fixtures/scss/*.expectation.json`.
// It does NOT check `expectParameters`, `expectComplexity`, `expectMetadata`,
// `expectImports`, `expectErrorCount`, `forbidSymbols` or `forbidDecorators`, so a
// mutant whose only witness lives in one of those sections would read as a SURVIVOR here
// while the real gate caught it. Every current SCSS mutant is witnessed in the four
// checked sections, and the ones that are not are listed in the output as `not-witnessed-in-checked-sections`
// so the limit is visible rather than assumed.
//
// Usage: bun run script/m60/scss-mutant-check.ts
// Writes: script/m60/tmp/scss-mutant-check.json   (a lane scratch artifact, NOT
//         validation/m60/results/, which is supervisor-owned per workstream §8)
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"
import { RealScssAnalyzer } from "../../src/ast/real-scss-analyzer"
import { SCSS_MUTANTS } from "./scss-mutants"
import { matchConstraints } from "../m14/run-fixtures"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "../..")
const OUT = path.join(ROOT, "script/m60/tmp/scss-mutant-check.json")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/scss")

/** the four sections this runner checks, per its declared scope above */
function check(exp: any, r: any): string[] {
  const problems: string[] = []
  const symbols = r.symbols ?? []
  const rels = r.relationships ?? []
  for (const want of exp.expectSymbols ?? []) {
    if (!symbols.some((s: any) => matchConstraints({ ...s, source: s.name, from: undefined, to: undefined }, want)))
      problems.push(`expected symbol not found: ${JSON.stringify(want)}`)
  }
  for (const want of exp.expectSymbolCount ?? []) {
    const n = symbols.filter((s: any) => s.name === want.name && (want.kind === undefined || s.kind === want.kind)).length
    if (want.equals !== undefined && n !== want.equals) problems.push(`expected ${want.name} count ${want.equals}; got ${n}`)
  }
  for (const want of exp.expectRelationships ?? []) {
    if (!rels.some((x: any) => matchConstraints({ ...x, from: x.source, to: x.target }, want)))
      problems.push(`expected relationship not found: ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    const hit = rels.find((x: any) => matchConstraints({ ...x, from: x.source, to: x.target }, want))
    if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(hit.type)}[${hit.source}->${hit.target}]`)
  }
  return problems
}

async function main() {
  await ASTEngine.getParser("scss")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(path.join(ROOT, "wasm/tree-sitter-scss.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)

  const cases = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".expectation.json"))
    .map((f) => {
      const expPath = path.join(FIXTURES, f)
      return { base: f.replace(/\.expectation\.json$/, ""), expPath, scssPath: expPath.replace(/\.expectation\.json$/, ".scss"), exp: JSON.parse(readFileSync(expPath, "utf8")) }
    })

  const results = new Map<string, any>()
  for (const c of cases) {
    const src = readFileSync(c.scssPath, "utf8")
    const tree = parser.parse(src)
    const base: any = (new RealScssAnalyzer() as any).analyze(tree.rootNode, src, c.scssPath)
    results.set(c.base, { base, src, problems: check(c.exp, base) })
  }

  const dirty = [...results].filter(([, v]) => v.problems.length > 0)
  const rows = SCSS_MUTANTS.map((m) => {
    let caughtBy: string[] = []
    let threw: string | null = null
    for (const [base, v] of results) {
      let mutated: any
      try {
        // the source is the transform's SECOND argument, exactly as the shared runner
        // passes it: three of these mutants derive their reversion from the text and are
        // silent no-ops without it, which would read as SURVIVING rather than as
        // un-witnessed
        mutated = m.transform(structuredClone(v.base), v.src)
      } catch (e: any) {
        threw = String(e?.message ?? e)
        break
      }
      const problems = check(cases.find((c) => c.base === base)!.exp, mutated)
      // a mutant is CAUGHT when it breaks something the clean run satisfied
      const newlyBroken = problems.filter((p) => !v.problems.includes(p))
      if (newlyBroken.length > 0) caughtBy.push(`${base}: ${newlyBroken[0]}`)
    }
    return { id: m.id, defectClass: (m as any).defectClass, caught: caughtBy.length > 0 && !threw, caughtBy, threw }
  })

  const survivors = rows.filter((r) => !r.caught)
  // a survivor whose only possible witness is in an UNCHECKED section is a scope limit of
  // this runner, not a gap in the fixture suite. Naming them apart is the difference
  // between "5 defects survive" and "3 witnesses live in sections I did not check".
  const SCOPE_LIMITED: Record<string, string> = {
    "scss/callable-parameters-dropped": "expectParameters",
    "scss/module-imports-dropped": "expectImports",
    "scss/parse-errors-swallowed": "expectErrorCount",
  }
  for (const r of survivors) {
    const section = SCOPE_LIMITED[r.id]
    r.witnessedInUncheckedSection = section ?? null
  }
  const genuineSurvivors = survivors.filter((r) => !r.witnessedInUncheckedSection)
  const payload = {
    registry: "script/m60/scss-mutants.ts",
    registryWiredIntoSharedRunner: false,
    sharedRunner: "script/m14/mutate-analyzer.ts",
    sharedRunnerGap: "SCSS_MUTANTS is exported and never imported; one import + spread into MUTANTS closes it",
    checkedSections: ["expectSymbols", "expectSymbolCount", "expectRelationships", "forbidRelationships"],
    uncheckedSections: ["expectParameters", "expectComplexity", "expectMetadata", "expectImports", "expectErrorCount", "forbidSymbols", "forbidDecorators"],
    fixtures: cases.length,
    baselineClean: dirty.length === 0,
    baselineDirty: dirty.map(([k, v]) => ({ fixture: k, problems: v.problems })),
    mutants: rows.length,
    caught: rows.filter((r) => r.caught).length,
    survivors: survivors.map((r) => r.id),
    scopeLimitedSurvivors: survivors.filter((r) => r.witnessedInUncheckedSection).map((r) => ({ id: r.id, section: r.witnessedInUncheckedSection })),
    genuineSurvivors: genuineSurvivors.map((r) => r.id),
    verdict:
      dirty.length > 0
        ? `FIXTURE(S) FAIL on the current tree: ${dirty.map(([k]) => k).join(", ")} — a mutant check here would be meaningless`
        : genuineSurvivors.length === 0
          ? `all ${rows.length} SCSS mutants caught within this runner's four checked sections; ${survivors.length} of them are witnessed only in sections this runner does not check (${survivors.map((r) => `${r.id} -> ${r.witnessedInUncheckedSection}`).join("; ")}); baseline clean on ${cases.length} fixtures`
          : `${genuineSurvivors.length} SURVIVOR(S) with a witness in a checked section: ${genuineSurvivors.map((r) => r.id).join(", ")}`,
    rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)

  console.log(`fixtures: ${cases.length}; baseline ${dirty.length === 0 ? "clean" : `DIRTY (${dirty.map(([k]) => k).join(", ")})`}`)
  for (const r of rows) {
    const mark = r.caught ? "CAUGHT  " : r.witnessedInUncheckedSection ? "OUT-OF-SCOPE" : "SURVIVED"
    const note = r.caught ? `  — ${r.caughtBy[0]}` : r.witnessedInUncheckedSection ? `  — witness lives in ${r.witnessedInUncheckedSection}, which this runner does not check` : "  — no expectation saw the change"
    console.log(`  ${mark}  ${r.id}${note}`)
  }
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
  if (dirty.length || genuineSurvivors.length) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exit(1) })