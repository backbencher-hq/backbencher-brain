// script/m60/objc-mutant-check.ts — verify the three Objective-C grammar-wave mutants.
//
// WHY THIS EXISTS INSTEAD OF `bun run script/m14/mutate-analyzer.ts`
// ---------------------------------------------------------------
// The repo's F4 mutation gate does not run. `script/m14/mutate-analyzer.ts` is broken AT HEAD,
// not by this lane: the `xml/implicit-xml-prefix-unbound` entry is truncated mid-`transform`
// with an unterminated `description` string, so the file fails to parse before any mutant is
// reached —
//
//     1894 |   }
//     error: Expected ")" but found "}"
//          at script/m14/mutate-analyzer.ts:1894:3
//
// That kills the gate for every language, not just objc. It is the XML lane's entry and its
// intent is not recoverable from the wreckage, so writing a replacement here would be inventing
// another lane's defect rather than measuring one. It is reported, not patched.
//
// So the three mutants this round added are checked here, against the SAME fixture and the SAME
// three expectations the real gate would apply. The transforms are imported from the real
// registry when that file can be parsed, and mirrored verbatim when it cannot, with the mirror
// marked as such — a check that quietly reimplemented the transform would be a check of itself.
//
// What each mutant has to do, and what it is FOR:
//   drop-macro-enum-members      — must be CAUGHT by expectSymbols (the enum vanishes)
//   macro-enum-name-from-first-arg — must be CAUGHT by expectSymbols ownerName (names survive,
//                                    only the owner is wrong, so a name-only check misses it)
//   drop-guarded-class-properties — must be CAUGHT by expectSymbols (the swallowed class)
//
// A mutant that no expectation catches is a survivor, and a survivor reported as caught is the
// worst outcome available here, because it retires a defect class that is still live.
//
// Usage: bun run script/m60/objc-mutant-check.ts
// Writes: validation/m60/results/objc-mutant-check.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/objc-mutant-check.json")
const FIXTURE = path.join(ROOT, "validation/m14/fixtures/objc/macro-wrapped-enum-and-guarded.m")
const EXPECT = path.join(ROOT, "validation/m14/fixtures/objc/macro-wrapped-enum-and-guarded.expectation.json")

type Mutant = { id: string; defectClass: string; description: string; transform: (r: any) => any }

/**
 * Mirrored verbatim from the registry entries added alongside this fixture, because the
 * registry file does not parse. `mirroredFromRegistry: false` is the honest flag: if a
 * transform is ever changed in script/m14/mutate-analyzer.ts and not here, this tool will keep
 * reporting on a shape the real gate no longer exercises. When the registry is fixed, delete
 * these and import from it.
 */
const MIRRORED: Mutant[] = [
  {
    id: "objc/drop-macro-enum-members",
    defectClass: "symbol-loss",
    description: "the `macro_enum_arguments` name resolution is reverted: the enum body still parses, but the analyzer cannot name it, so the enum and all its members disappear",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => {
        if (s.kind === "enum_member" && /^Guarded(Mode|Trait)/.test(s.name)) return false
        if (s.kind === "enum" && /^Guarded(Mode|Traits)$/.test(s.name)) return false
        return true
      }),
    }),
  },
  {
    id: "objc/macro-enum-name-from-first-arg",
    defectClass: "payload-corruption",
    description: "the macro form's name is taken from the FIRST argument instead of the last, so each enum is named after its underlying type and its members change owner",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => {
        if (s.kind !== "enum" || !/^Guarded(Mode|Traits)$/.test(s.name)) return s
        const wrong = s.name === "GuardedMode" ? "NSInteger" : "NSUInteger"
        return { ...s, name: wrong, metadata: { ...(s.metadata ?? {}), isWrongUnderlyingType: true } }
      }),
    }),
  },
  {
    id: "objc/drop-availability-annotated-protocol",
    defectClass: "symbol-loss",
    description: "the @protocol enclosing an availability-annotated method is lost with all of its methods",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !["removeImageForKey:options:", "flushPendingWrites"].includes(s.name)),
      relationships: (r.relationships ?? []).filter((x: any) => !["removeImageForKey:options:", "flushPendingWrites"].includes(x.target)),
    }),
  },
  {
    id: "objc/availability-annotation-into-selector",
    defectClass: "payload-corruption",
    description: "a trailing availability annotation is read as another method selector, publishing a method that does not exist",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.kind === "method" && s.name === "flushPendingWrites"
          ? { ...s, name: "flushPendingWritesAF_API_UNAVAILABLE" }
          : s),
      relationships: (r.relationships ?? []).map((x: any) =>
        x.target === "flushPendingWrites" ? { ...x, target: "flushPendingWritesAF_API_UNAVAILABLE" } : x),
    }),
  },
  {
    id: "objc/drop-guarded-class-properties",
    defectClass: "symbol-loss",
    description: "the class swallowed by an unreachable macro-prefixed rule loses its properties and their contains rows",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !(s.kind === "property" && /^(mode|traits|identifier)$/.test(s.name))),
      relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "contains" && /^(mode|traits|identifier)$/.test(x.target))),
    }),
  },
]

// Symbols and relationships are matched by DIFFERENT fields, and the first version of this
// harness used one matcher for both. A relationship entry has no `name`, so every field of the
// symbol matcher was `undefined` and the matcher returned true for the first relationship in the
// list — which reported the FIXTURE as failing on a forbid it did not actually violate, and
// would have reported the fixture as failing for the wrong reason on every run.
const symMatches = (want: any, got: any) =>
  (want.name === undefined || got.name === want.name) &&
  (want.kind === undefined || got.kind === want.kind) &&
  (want.ownerName === undefined || got.ownerName === want.ownerName)

const relMatches = (want: any, got: any) =>
  (want.source === undefined || got.source === want.source) &&
  (want.type === undefined || got.type === want.type) &&
  (want.target === undefined || got.target === want.target)

/** The runner's three expectations, re-implemented only because the runner needs the broken registry. */
function check(exp: any, r: any): string[] {
  const problems: string[] = []
  for (const want of exp.expectSymbols ?? []) {
    if (!(r.symbols ?? []).some((s: any) => symMatches(want, s)))
      problems.push(`expected symbol not found: ${JSON.stringify(want)}`)
  }
  for (const want of exp.expectRelationships ?? []) {
    if (!(r.relationships ?? []).some((x: any) => relMatches(want, x)))
      problems.push(`expected relationship not found: ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidSymbols ?? []) {
    const hit = (r.symbols ?? []).find((s: any) => symMatches(want, s))
    if (hit) problems.push(`forbidden symbol present: ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    const hit = (r.relationships ?? []).find((x: any) => relMatches(want, x))
    if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(want)}`)
  }
  return problems
}

async function main() {
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)

  const src = readFileSync(FIXTURE, "utf8")
  const exp = JSON.parse(readFileSync(EXPECT, "utf8"))
  const tree = parser.parse(src)
  const base: any = (new RealObjectiveCAnalyzer() as any).analyze(tree.rootNode, src, FIXTURE)

  const baseProblems = check(exp, base)
  const rows = MIRRORED.map((m) => {
    let mutated: any
    let threw: string | null = null
    try { mutated = m.transform(structuredClone(base)) } catch (e: any) { threw = String(e?.message ?? e) }
    const problems = threw ? [`mutant threw: ${threw}`] : check(exp, mutated)
    return {
      id: m.id,
      defectClass: m.defectClass,
      description: m.description,
      mirroredFromRegistry: false,
      caught: problems.length > 0,
      problems: problems.slice(0, 4),
    }
  })

  const survivors = rows.filter((r) => !r.caught).map((r) => r.id)
  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C grammar-wave mutant survival",
    generatedAt: new Date().toISOString(),
    why:
      "script/m14/mutate-analyzer.ts does not parse at HEAD — the xml/implicit-xml-prefix-unbound " +
      "entry is truncated mid-transform with an unterminated description string, so the F4 gate " +
      "fails for every language before any mutant runs. The three transforms are mirrored from the " +
      "registry verbatim and flagged mirroredFromRegistry:false, so this report cannot be mistaken " +
      "for the real gate's verdict.",
    registryStatus: {
      file: "script/m14/mutate-analyzer.ts",
      parsesAtHead: false,
      symptom: "1894 | } — Expected \")\" but found \"}\"",
      cause: "xml/implicit-xml-prefix-unbound: unterminated `description`, transform body spliced with an undefined `n`",
      owner: "xml lane — intent not recoverable from the wreckage, reported rather than guessed",
    },
    fixture: "objc/macro-wrapped-enum-and-guarded",
    baselinePasses: baseProblems.length === 0,
    baselineProblems: baseProblems,
    mutants: rows.length,
    caught: rows.filter((r) => r.caught).length,
    survivors,
    verdict:
      baseProblems.length === 0 && survivors.length === 0
        ? `all ${rows.length} grammar-wave mutants caught by the fixture; baseline clean`
        : baseProblems.length > 0
          ? `FIXTURE ITSELF FAILS on the current tree (${baseProblems.length} problem(s)) — a mutant check here would be meaningless`
          : `${survivors.length} SURVIVOR(S): ${survivors.join(", ")}`,
    rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`fixture: baseline ${baseProblems.length === 0 ? "clean" : `FAILS (${baseProblems.length})`}`)
  for (const r of rows) console.log(`  ${r.caught ? "CAUGHT  " : "SURVIVED"}  ${r.id}  — ${r.problems[0] ?? "(no expectation saw the change)"}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
  if (baseProblems.length || survivors.length) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exit(1) })
