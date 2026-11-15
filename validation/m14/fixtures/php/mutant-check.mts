/**
 * PROOF RUNNER for `script/m14/php-mutants.ts` — injects each mutant and requires the
 * PHP fixture suite to catch it.
 *
 * ## Why the mutants cannot simply be written down
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8), and `PHP_MUTANTS`
 * is not in it — the wiring is reported in that file's header, not applied. A registry
 * nothing imports proves nothing: `script/m60/scss-mutants.ts` records that exact shape
 * ("a finished file is not the same claim as a mutant having been injected and caught").
 *
 * So this runner INJECTS each transform for real and evaluates every
 * `validation/m14/fixtures/php/*.expectation.json` against the MUTATED result, using the
 * same `matchConstraints` the production fixture gate uses — imported, never reimplemented,
 * because a check that mirrored the matcher would be a check of itself.
 *
 * A mutant that SURVIVES is reported as a failure, which is the outcome that matters: a
 * pin that cannot fail is a false assurance.
 *
 * SCOPE, DECLARED, in two parts.
 *
 * SECTIONS. It checks `expectSymbols`, `expectSymbolCount`, `expectRelationships`,
 * `expectRelationshipCount`, `expectExports`, `forbidSymbols`, `forbidRelationships` and
 * `forbidExports`. The two COUNT sections were added after a measured disagreement: the
 * `php/re-walk-recovered-subtrees` mutant duplicates edges, this runner called it a SURVIVOR
 * while `script/m14/mutate-analyzer.ts` called it CAUGHT, and the difference was scope —
 * every section this runner checked matched "at least one", which a duplicate never fails.
 * It does NOT check imports, comments, complexity, patterns, metadata or error counts, so a
 * mutant witnessed only in one of THOSE would still read as a survivor here while the real
 * gate caught it. A scope gap is not a licence to disagree: when this runner and the
 * production gate disagree about a mutant, the SCOPE is what gets fixed, as it was here.
 *
 * FIXTURES. It SKIPS any expectation declaring `crossFileOverride` (php:
 * `cross-file-override`), because that path needs `AnalyzeContext.overrideCompanion` —
 * an index built from a NAMED sibling file's symbols and their visibility, with a
 * unanimity rule for `private`. Reimplementing that here would be mirroring shared
 * logic, and a mutant check that mirrors the matcher is a check of itself. Those
 * fixtures are covered by the production runner (`bun run script/m14/run-fixtures.ts
 * --lang php`, MEASURED 25 pass / 0 fail on 2026-10-07; the `23/23` this line used to read was
 * two fixtures stale, and a count in a header is a claim like any other) and the skip is
 * printed, never silent. The 25 counts the fixture FILE; this runner evaluates 24 of them and
 * prints the one it skips.
 *
 * Usage: npx tsx validation/m14/fixtures/php/mutant-check.mts
 * Writes:   /tmp/opencode/php-mutant-check.json  (a lane scratch artifact, not
 *           validation/m60/results/, which is supervisor-owned per workstream §8)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"
import { loadWebTreeSitter } from "../../../../src/util/wasm"
import { RealPhpAnalyzer } from "../../../../src/ast/real-php-analyzer"
import { PHP_MUTANTS } from "../../../../script/m14/php-mutants"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/php")
const OUT = "/tmp/opencode/php-mutant-check.json"

const SECTIONS = ["expectSymbols", "expectSymbolCount", "expectRelationships", "expectRelationshipCount", "expectExports", "forbidSymbols", "forbidRelationships", "forbidExports"] as const

/** Every problem the checked sections report for one analyzer result. */
function problemsFor(exp: any, r: any): string[] {
  const problems: string[] = []
  const symbols = (r.symbols ?? []).map((s: any) => ({ ...s, source: s.name, from: undefined, to: undefined }))
  const rels = (r.relationships ?? []).map((x: any) => ({ ...x, from: x.source, to: x.target }))
  const exportsList = (r.exports ?? []) as any[]
  for (const want of exp.expectSymbols ?? []) {
    if (!symbols.some((s: any) => matchConstraints(s, want))) problems.push(`expectSymbols ${JSON.stringify(want)}`)
  }
  for (const want of exp.expectRelationships ?? []) {
    if (!rels.some((x: any) => matchConstraints(x, want))) problems.push(`expectRelationships ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    const { note, comment, ...constraint } = want as any
    const hit = rels.filter((x: any) => matchConstraints(x, constraint))
    if (hit.length) problems.push(`forbidRelationships ${JSON.stringify(constraint)} matched ${hit.length} edge(s)`)
  }
  for (const want of exp.expectExports ?? []) {
    if (!exportsList.some((e: any) => matchConstraints(e, want))) problems.push(`expectExports ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidExports ?? []) {
    const { note, comment, ...constraint } = want as any
    const hit = exportsList.filter((e: any) => matchConstraints(e, constraint))
    if (hit.length) problems.push(`forbidExports ${JSON.stringify(constraint)} matched ${hit.length} entry(ies)`)
  }
  for (const want of exp.forbidSymbols ?? []) {
    const { note, comment, ...constraint } = want as any
    const hit = symbols.filter((s: any) => matchConstraints(s, constraint))
    if (hit.length) problems.push(`forbidSymbols ${JSON.stringify(constraint)} matched ${hit.length} symbol(s)`)
  }
  // COUNT SECTIONS — added this round, and the reason is a mutant that SURVIVED here while the
  // production gate CAUGHT it. `php/re-walk-recovered-subtrees` duplicates edges (the recovered
  // member's call is emitted twice, under two sources) and `php/recovery-swallowed-members` pins
  // that with `expectRelationshipCount`, exactly and at zero. Every section this runner checked
  // matches "at least one", so a duplicate is invisible to all of them: the harness reported
  // "1 mutant survived" and `BB_MUTANT_ONLY=php/re-walk-recovered-subtrees bun
  // script/m14/mutate-analyzer.ts` reported `CAUGHT` on the same tree. Two harnesses disagreeing
  // about one mutant is a scope defect in the smaller one, not a disagreement about the code, so
  // the count sections are checked here too. `equals` on its own means "exactly N of this
  // constraint", which is also the only channel that can assert ZERO of a shape an
  // at-least-one row elsewhere requires one of.
  for (const want of exp.expectSymbolCount ?? []) {
    const n = symbols.filter(
      (s: any) =>
        s.name === want.name &&
        (want.ownerName === undefined || s.ownerName === want.ownerName) &&
        (want.kind === undefined || s.kind === want.kind),
    ).length
    if (n !== want.equals) problems.push(`expectSymbolCount ${JSON.stringify(want)} — got ${n}`)
  }
  for (const want of exp.expectRelationshipCount ?? []) {
    const { equals, note, comment: _c, ...constraint } = want as any
    const n = rels.filter((x: any) => matchConstraints(x, constraint)).length
    if (n !== equals) problems.push(`expectRelationshipCount ${JSON.stringify(constraint)} — got ${n}, want ${equals}`)
  }
  return problems
}

// `loadWebTreeSitter` returns the web-tree-sitter MODULE and installs the WASI shim,
// but it does NOT leave the core initialised for a direct `new Parser()` — the core
// `init()` has to be awaited on the Parser class itself with a cwd-independent
// `locateFile`, or the constructor throws "cannot construct a Parser before calling
// init()". Both halves are needed; doing only the first is the failure.
const wts: any = await loadWebTreeSitter()
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm"))))

// ---------------------------------------------------------------- reachability self-check
//
// WHY THIS IS HERE AND WHY IT IS NOT `verify-orphaned-mutants.ts`. That gate checks the SPREAD
// of the exported `PHP_MUTANTS` constant into the shared registry, and it reads the FIRST
// `export const *_MUTANTS` in the file. This file declares THREE groups — `PHP_MUTANTS`,
// `PHP_RECEIVER_OWNER_MUTANTS` and `PHP_PROJECTION_MUTANTS` — and only the first is examined, so
// a group that is declared and EXPORTED but never pushed into `PHP_MUTANTS` is invisible to it:
// the gate stays green, the group's mutants stop running, and nothing anywhere says so. That is
// not hypothetical — adding the projection group by replacing the receiver-owner push line made
// the three receiver-owner mutants unreachable for one commit-less edit, and the only reason it
// was caught is that the shared runner's output was grepped for their ids and came back empty.
// So the count is asserted HERE, at runtime, against the file's own declarations.
{
  const src = readFileSync(path.join(ROOT, "script/m14/php-mutants.ts"), "utf8")
  const declared = [...src.matchAll(/^\s*id:\s*["'`]([^"'`]+)["'`]/gm)].map((m) => m[1])
  const live = PHP_MUTANTS.map((m) => String((m as any).id))
  const unreachable = declared.filter((id) => !live.includes(id))
  const duplicates = live.filter((id, i) => live.indexOf(id) !== i)
  if (declared.length === 0) {
    console.error("mutant-check: php-mutants.ts declares no mutant ids — the reachability check would assert nothing")
    process.exit(2)
  }
  if (unreachable.length || duplicates.length || live.length !== declared.length) {
    console.error("mutant-check: REACHABILITY FAILED — a declared mutant group is not pushed into PHP_MUTANTS")
    console.error(`  declared in file : ${declared.length} (${declared.join(", ")})`)
    console.error(`  reachable at run : ${live.length}`)
    if (unreachable.length) console.error(`  DECLARED BUT UNREACHABLE: ${unreachable.join(", ")}`)
    if (duplicates.length) console.error(`  DUPLICATE IDS: ${[...new Set(duplicates)].join(", ")}`)
    console.error("  A group that is exported and counted but never pushed does not run, which is a pin that")
    console.error("  cannot fail. Fix the push in script/m14/php-mutants.ts; do not relax this check.")
    process.exit(2)
  }
  console.log(`reachability: ${live.length} declared = ${declared.length} reachable, no duplicate ids`)
}

const cases: { id: string; file: string; exp: any; clean: any[] }[] = []
const skipped: { fixtureId: string; reason: string }[] = []
for (const f of readdirSync(FIXTURES).sort()) {
  if (!f.endsWith(".expectation.json")) continue
  const exp = JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8"))
  if (exp.language !== "php") continue
  if (exp.crossFileOverride) {
    skipped.push({ fixtureId: String(exp.fixtureId ?? f), reason: "needs AnalyzeContext.overrideCompanion; covered by run-fixtures.ts --lang php" })
    continue
  }
  const phpFile = path.join(FIXTURES, f.replace(/\.expectation\.json$/, ".php"))
  let src = ""
  try {
    src = readFileSync(phpFile, "utf8")
  } catch {
    continue
  }
  const tree = parser.parse(src)
  const analyzer = new RealPhpAnalyzer()
  const result: any = analyzer.analyze(tree!.rootNode as any, src, phpFile)
  cases.push({ id: String(exp.fixtureId ?? f), file: f, exp, clean: [result] })
}

if (cases.length === 0) {
  console.error("mutant-check: no php fixtures were evaluated — the run would assert nothing")
  process.exit(2)
}

// ---------------------------------------------------------------- the clean baseline
console.log(`mutant-check: ${cases.length} php fixtures evaluated, ${PHP_MUTANTS.length} mutants`)
for (const sk of skipped) console.log(`  skipped ${sk.fixtureId}: ${sk.reason}`)
console.log("")
console.log("CLEAN RUN — must be 0 problems, or the fixtures are not pinning what they claim")
let cleanProblems = 0
for (const c of cases) {
  const p = problemsFor(c.exp, c.clean[0])
  cleanProblems += p.length
  if (p.length) console.log(`  FAIL ${c.id}: ${p.length} problem(s)\n       ${p.slice(0, 3).join("\n       ")}`)
}
console.log(`  ${cleanProblems === 0 ? "ok" : "FAIL"}  clean baseline: ${cleanProblems} problem(s)`)

// ---------------------------------------------------------------- inject each mutant
const rows: any[] = []
let survivors = 0
for (const m of PHP_MUTANTS) {
  let caughtBy: string[] = []
  let problems = 0
  for (const c of cases) {
    let mutated: any
    try {
      mutated = m.transform(c.clean[0])
    } catch (err: any) {
      console.log(`  ERROR ${m.id}: transform threw — ${err?.message ?? err}`)
      problems++
      continue
    }
    const p = problemsFor(c.exp, mutated)
    if (p.length > 0) {
      caughtBy.push(c.id)
      problems += p.length
    }
  }
  const survived = caughtBy.length === 0
  if (survived) survivors++
  rows.push({ id: m.id, defectClass: (m as any).defectClass, survived, caughtBy, problems })
  console.log("")
  console.log(`  ${survived ? "SURVIVED" : "caught  "}  ${m.id}`)
  console.log(`      ${survived ? "NO FIXTURE CAUGHT IT — the pin is a false assurance" : `caught by ${caughtBy.length} fixture(s): ${caughtBy.join(", ")}`}`)
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: cases.map((c) => c.id), skipped, checkedSections: SECTIONS, cleanProblems, survivors, rows }, null, 2))

console.log("")
console.log(`checked sections: ${SECTIONS.join(", ")}`)
console.log(`artifact: ${OUT}`)
console.log("")
if (cleanProblems > 0 || survivors > 0) {
  console.log(`FAILED — ${survivors} mutant(s) survived, ${cleanProblems} clean problem(s)`)
  process.exit(1)
}
console.log(`all ${PHP_MUTANTS.length} mutants caught, clean baseline 0 problems`)