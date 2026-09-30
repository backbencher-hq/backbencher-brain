// csharp/oracle-regressions — the two shapes that made the ORACLE wrong, in one small file.
//
// WHY THIS EXISTS. CS-D9 and CS-D10b were both defects in `deriveCSharpEdges`, and both were found
// by F5 on a 120-file corpus rotation — roughly ten minutes per run, on a box that is routinely at
// load 30+. An oracle fix with no cheap gate is a fix that can be undone by the next edit to the
// same function and discovered ten minutes later, or not at all. Fixtures cannot help here:
// fixtures assert what the ANALYZER emits, and both defects were in the TRUTH. The only gate for
// an oracle is a derivation, and this file makes that derivation run in about a second.
//
// The three shapes, each annotated with what the wrong rule produced:
//
//   1. D9  A base whose name is declared as an INTERFACE somewhere else in the corpus. The oracle
//         tested its corpus-wide interface companion BEFORE the file's own declaration, so a
//         local class lost to a name seen in another file. `Corpus`/`Local` are the trick: the
//         probe passes a companion containing `Local`, and the file declares `Local` as a class.
//         Precedence must put the file first, or `class Derived : Local` reads as `implements`.
//
//   2. D10 A base list whose CONSTRUCTOR ARGUMENT LIST is a sibling. The raw text of the second
//         child became a base named `(arg)` — not a type.
//
//   3. D10b A record's primary-constructor base, where the arguments are inside the child's own
//         text, so a sibling-only rule cannot see them. `Beast(Name)` must yield `Beast`.
//
// The corpus companion is passed IN, which is what makes case 1 testable at all: the whole defect
// is about a name that is a class HERE and an interface ELSEWHERE, and a self-contained file
// cannot express "elsewhere".
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const FIXTURE = path.join(ROOT, "validation/m14/oracle-cases/csharp-oracle-regressions.cs")

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))

  const src = fs.readFileSync(FIXTURE, "utf8")
  const root = parser.parse(src).rootNode
  // The corpus companion that broke D9: `Local` is an interface SOMEWHERE ELSE.
  const companion = new Set(["Local", "ISomewhereElse"])
  const edges = (mod.deriveCSharpEdges(root, companion) ?? []).filter(
    (e: any) => e.label === "extends" || e.label === "implements",
  )
  const key = (e: any) => `${e.label} ${e.from} -> ${e.target}`
  // `Set<string>` is load-bearing, not decoration: `mod` is typed `any`, so `deriveCSharpEdges`
  // returns `any`, `edges` is `any`, and `new Set(anyValue)` infers `Set<unknown>` — which makes
  // every element `unknown` and the filter below a type error. The runtime was always fine;
  // only the checker could see it, which is the whole reason this program exists in a typecheck.
  const have = new Set<string>(edges.map(key))
  console.log("  derived extends/implements:")
  for (const k of [...have].sort()) console.log(`     ${k}`)

  const problems: string[] = []
  const expect = (k: string, why: string): void => { if (!have.has(k)) problems.push(`MISSING  ${k}  — ${why}`) }
  const forbid = (k: string, why: string): void => { if (have.has(k)) problems.push(`PRESENT ${k}  — ${why}`) }

  // 1. D9 — the file's own class declaration outranks the corpus companion
  expect("extends Derived -> Local", "D9: a base declared as a class IN THIS FILE must stay `extends` even when the corpus companion says `Local` is an interface")
  forbid("implements Derived -> Local", "D9 regression: the corpus companion overruled the local declaration, which is the whole defect")
  // 2. D10 — the argument list is a sibling and is not a type
  expect("extends WithArgs -> Base", "D10: the base is the first child")
  forbid("extends WithArgs -> (arg)", "D10 regression: the base_list's argument_list was published as a type")
  // 3. D10b — a record's primary-constructor base carries its arguments in its own text
  expect("extends R -> Beast", "D10b: a primary_constructor_base_type contributes its TYPE")
  forbid("extends R -> Beast(Name)", "D10b regression: the base name carried the constructor's arguments")
  // control: an unknown external at index > 0 is conventionally an interface
  expect("implements Multi -> ISomewhereElse", "control: an undeclared later base that is I-prefixed is an interface")
  expect("extends Multi -> Base", "control: the first base of a class is inheritance, not an interface")

  const paren = [...have].filter((k) => /\(/.test(k))
  if (paren.length > 0) problems.push(`paren-named base(s) present: ${paren.join("  ")} — no base type may contain an argument list`)

  if (problems.length > 0) {
    console.log(`\n  PROBLEMS (${problems.length}):`)
    for (const p of problems) console.log(`    ! ${p}`)
    console.log("\nVERDICT: FAIL — the oracle no longer agrees with the tree on these shapes.")
    process.exit(1)
  }
  console.log("\nVERDICT: PASS — the corpus companion does not overrule a local declaration, and no")
  console.log("base name carries a constructor's arguments. One second to run, versus the ten")
  console.log("minutes of F5 that found these in the first place.")
}

if (import.meta.main) await main()
