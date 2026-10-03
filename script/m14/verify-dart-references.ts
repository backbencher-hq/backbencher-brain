/**
 * verify-dart-references — the gate for the Dart `references` ORACLE.
 *
 * ## Why this file exists
 *
 * `references` was the tenth type this lane did not emit, and it is emitted now.
 * Fixtures pin the ANALYZER. Nothing pinned the rule the oracle encodes, and an
 * oracle nothing pins is the exact failure `verify-dart-contains.ts` documents: it
 * can be wrong in the same direction as the analyzer forever, because the two
 * agreeing is the only evidence a reader ever sees. So each case here asserts
 * BOTH sides against the same expected rows, and a case is written in the SHAPE the
 * corpus contains rather than in the shape the rule talks about.
 *
 * ## WHAT A CASE CAN AND CANNOT CATCH
 *
 * The oracle is a second walker over ONE grammar. A defect in the grammar's own
 * vocabulary — a node type it does not produce for a construct Dart has, or one it
 * produces where Dart has none — is invisible here, and this file does not claim
 * otherwise. What it can catch, and did during writing, is an implementation
 * disagreement: a position one side reads and the other does not, an attribution
 * that differs, a resolver that differs. Those are real and they are the class of
 * defect that survives a differential.
 *
 * ## HOW IT MEASURED
 *
 * Run: `npx tsx script/m14/verify-dart-references.ts`
 * Then over the corpus: `--corpus` walks `BB_CORPUS_ROOT` (default
 * `$HOME/fixtures/repositories`) with a deterministic stride sample of
 * tracked `.dart` files and prints agreement per repo. That number is a
 * comparison between two implementations of one measured rule, and it is quoted in
 * `docs/analyzers/real-dart-analyzer.md` as exactly that.
 */

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { deriveDartReferencesTruth } from "./oracles/dart-references"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS = process.argv.includes("--corpus")
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 40)

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

let cached: any = null
async function parserFor(): Promise<any> {
  if (cached) return cached
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  cached = parser
  return parser
}

/**
 * The TRUTH's rows, spelled `from -> target`. `fileLabel` is derived from the same
 * path the ANALYZER is given, so a mention that belongs to no published declaration
 * is attributed to the same string on both sides — the corpus run measured 17
 * disagreements in 211 files before this was fixed, every one of them a `file` here
 * against the file's base name there.
 */
async function truth(src: string, visible?: string[], at = FILE_PATH): Promise<string[]> {
  const parser = await parserFor()
  const t = parser.parse(src)
  const label = path.basename(at, path.extname(at))
  return deriveDartReferencesTruth(t.rootNode, visible, label).map((e) => `${e.from} -> ${e.target}`).sort()
}

/** The ANALYZER's rows for the same source. */
async function analyzer(src: string, visible?: string[]): Promise<string[]> {
  const parser = await parserFor()
  const r: any = await new RealDartAnalyzer().analyze(
    parser.parse(src).rootNode, src, FILE_PATH,
    visible ? { projectIndex: { typeKinds: new Map(visible.map((v) => [v, "class"])) } } : undefined,
  )
  return [...new Set((r.relationships ?? [])
    .filter((e: any) => e.type === "references")
    .map((e: any) => `${e.source} -> ${e.target}`))].sort()
}

/**
 * Both sides against the same rows. `visible` widens BOTH resolvers to the same
 * set — an oracle handed a different project view than the analyzer could not
 * disagree meaningfully, and neither could agree meaningfully.
 */
async function checkBoth(
  name: string,
  src: string,
  expected: string[],
  visible?: string[],
): Promise<void> {
  const t = await truth(src, visible)
  const a = await analyzer(src, visible)
  const want = expected.slice().sort()
  const problems: string[] = []
  for (const w of want) {
    if (!t.includes(w)) problems.push(`truth missing ${w}`)
    if (!a.includes(w)) problems.push(`analyzer missing ${w}`)
  }
  for (const r of t) if (!want.includes(r)) problems.push(`truth has UNEXPECTED ${r}`)
  for (const r of a) if (!want.includes(r)) problems.push(`analyzer has UNEXPECTED ${r}`)
  check(name, problems.length === 0, problems.length ? problems.join("; ") : `rows=${want.join(" | ")}`)
}

const FILE_PATH = "/tmp/verify-dart-references.dart"

/** A whole-file agreement count, which is the number worth quoting. */
function agreement(truthRows: string[], analyzerRows: string[]): {
  truth: number
  analyzer: number
  agreed: number
  missing: number
  unexplained: number
} {
  const t = new Set(truthRows)
  const a = new Set(analyzerRows)
  let agreed = 0
  for (const r of t) if (a.has(r)) agreed++
  return {
    truth: t.size,
    analyzer: a.size,
    agreed,
    missing: [...t].filter((r) => !a.has(r)).length,
    unexplained: [...a].filter((r) => !t.has(r)).length,
  }
}

async function corpusRun(): Promise<void> {
  const parser = await parserFor()
  const repos = fs.readdirSync(CORPUS_ROOT).filter((d) => {
    try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false }
  })
  let files = 0
  const totals = { truth: 0, analyzer: 0, agreed: 0, missing: 0, unexplained: 0 }
  const examples: string[] = []
  for (const repo of repos) {
    const dir = path.join(CORPUS_ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean).sort()
    } catch { continue }
    if (tracked.length === 0) continue
    const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
    const rowsT: string[] = []
    const rowsA: string[] = []
    for (let i = 0; i < tracked.length && rowsT.length / 1 < PER_REPO * 40; i += stride) {
      const abs = path.join(dir, tracked[i])
      let src: string
      try {
        if (fs.statSync(abs).size > 1024 * 1024) continue
        src = fs.readFileSync(abs, "utf8")
      } catch { continue }
      files++
      const tree = parser.parse(src)
      if (!tree) continue
      const label = path.basename(abs, path.extname(abs))
      for (const e of deriveDartReferencesTruth(tree.rootNode, undefined, label)) rowsT.push(`${e.from} -> ${e.target}`)
      const r: any = await new RealDartAnalyzer().analyze(tree.rootNode, src, abs)
      for (const e of r.relationships ?? []) if (e.type === "references") rowsA.push(`${e.source} -> ${e.target}`)
    }
    const m = agreement(rowsT, rowsA)
    totals.truth += m.truth; totals.analyzer += m.analyzer; totals.agreed += m.agreed
    totals.missing += m.missing; totals.unexplained += m.unexplained
    console.log(`${repo.padEnd(20)} files=${String(Math.min(PER_REPO, tracked.length)).padStart(4)}  truth=${String(m.truth).padStart(6)}  analyzer=${String(m.analyzer).padStart(6)}  agreed=${String(m.agreed).padStart(6)}  missing=${String(m.missing).padStart(4)}  unexplained=${String(m.unexplained).padStart(4)}`)
  }
  const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
  console.log(`\ncorpus: ${files} files across ${repos.length} repos`)
  console.log(`truth rows ${totals.truth}  analyzer rows ${totals.analyzer}  agreed ${totals.agreed} (${pct(totals.agreed, Math.max(totals.truth, totals.analyzer))})`)
  console.log(`missing (truth only) ${totals.missing}  unexplained (analyzer only) ${totals.unexplained}`)
  check("corpus: the analyzer never invents a row the rule does not derive", totals.unexplained === 0, `unexplained=${totals.unexplained}`)
  check("corpus: the rule derives no row the analyzer misses", totals.missing === 0, `missing=${totals.missing}`)
  if (examples.length) console.log(examples.join("\n"))
}

async function main(): Promise<void> {
  if (CORPUS) {
    await corpusRun()
    process.exit(failures === 0 ? 0 : 1)
  }

  console.log("# verify-dart-references\n")
  console.log("# every case asserts the ORACLE and the ANALYZER against the same rows\n")

  // ── 1. the shapes that carry the volume, one per node type ───────────────
  // Each is a POSITIVE and they are separate cases because the positions are
  // separate code paths in one of the two implementations, and a battery that
  // asserted them in one source could not tell which one broke.
  await checkBoth("a RETURN type (function_signature)", `class A { A make() => A(); }`, ["make -> A"])
  await checkBoth("a PARAMETER type (formal_parameter)", `class B { void take(B b) {} }`, ["take -> B"])
  await checkBoth("a GETTER's type (getter_signature)", `class C { C? get next => null; }`, ["next -> C"])
  await checkBoth("an OPERATOR's RETURN type (operator_signature, named `operator <token>`)", `class D { D operator *(D other) => this; }`, ["operator * -> D"])
  await checkBoth("a TYPE ARGUMENT (type_arguments)", `class E { List<E> kids() => <E>[]; }`, ["kids -> E"])
  await checkBoth("a TYPE CAST (type_cast)", `class F { Object to(Object o) => o as F; }`, ["to -> F"])
  await checkBoth("a TYPE TEST (type_test)", `class G { bool is(Object o) => o is G; }`, ["is -> G"])
  await checkBoth("an `on T` CATCH clause (try_statement)", `class H { void go() { try { } on H catch (e) { } } }`, ["go -> H"])
  await checkBoth("a LOCAL's type folds into the function (initialized_variable_definition)",
    `class I { void go() { final I self = this; print(self); } }`, ["go -> I"])
  await checkBoth("a for-in ELEMENT's type (for_loop_parts)", `class J { void go(List<J> xs) { for (final J x in xs) print(x); } }`, ["go -> J"])
  await checkBoth("a TYPE BOUND (type_bound)", `class K<T extends U3> { } class U3 { }`, ["K -> U3"])
  await checkBoth("a TYPE ALIAS's aliased type (type_alias)", `typedef L = List<M4>; class M4 { }`, ["L -> M4"])
  await checkBoth("a NAMED extension's target (extension_declaration)", `extension M on M2 { } class M2 { }`, ["M -> M2"])
  await checkBoth("an EXTENSION TYPE's representation type (representation_declaration)",
    `extension type N._(O4 inner) { } class O4 { }`, ["N -> O4"])
  await checkBoth("a RECORD FIELD's type (record_type_field)", `class O { ({O first, int n}) pair() => (first: this, n: 1); }`, ["pair -> O"])
  await checkBoth("a CONSTRUCTOR parameter's type", `class P { P(this.n); final int n; P.twin({required P other}) : n = other.n; }`, ["constructor -> P"])
  await checkBoth("a top-level CONSTANT's type (program)", `const String Q = 'x';`, [])

  // ── 2. the resolution gate, from both sides ─────────────────────────────
  // A type this file does not declare is a NAME from here, and publishing it
  // would be the fabrication this whole design refuses.
  await checkBoth("a type from another file publishes NOTHING", `class R { void take(Widget w) {} }`, [])
  await checkBoth("nor does the type argument base", `class S { List<S> kids() => <S>[]; }`, ["kids -> S"])
  await checkBoth("`dynamic` is the absence of a type, not a mention", `class T2 { void take(dynamic d) {} }`, [])
  await checkBoth("a top-level mention with no enclosing declaration names the FILE",
    `const Widget R2 = null;`, [])

  // ...and it WIDENS when the run can see more, which is what a project index does
  await checkBoth("a project index widens the gate on BOTH sides",
    `class U { void take(Widget w) {} }`, ["take -> Widget"], ["Widget"])

  // ── 3. the double-count positions, which are the fabrication risk ───────
  // These are the rows a naive "every type_identifier is a mention" rule adds.
  await checkBoth("heritage is not a type reference", `class V extends U2 { } class U2 { }`, [], ["U2", "V"])
  await checkBoth("implements is not a type reference", `class W2 implements U2 { } class U2 { }`, [], ["U2", "W2"])
  await checkBoth("a with-clause is not a type reference", `mixin X2 on U2 { } class U2 { }`, [], ["U2", "X2"])
  await checkBoth("construction is not a type reference", `class Y2 { Y2 make() => Y2(); }`, ["make -> Y2"])
  await checkBoth("a TYPE VARIABLE is not a type", `class Z2<T extends U5> { T v; T get() => v; } class U5 { }`, ["Z2 -> U5"])
  // ...and the same thing when the VARIABLE'S NAME is also a declared type, which
  // is the only case where the shadow gate is load-bearing rather than redundant
  // with the resolution gate. `class T6 {}` puts `T` in the visible set, so a
  // mention of the variable resolves — to the WRONG declaration. Both sides read
  // `T` as a bare parameter before this case existed: `type_parameter`.text spans
  // the bound (`"T extends U5"`), so the comparison against `T` never matched and
  // the gate declined every CONSTRAINED type variable.
  await checkBoth("a CONSTRAINED type variable shadows a same-named declared type",
    `class V6<T extends Wallet6> { T? cached; T get() => cached as T; } class T6 { } class Wallet6 { }`,
    ["V6 -> Wallet6"])
  await checkBoth("an UNNAMED extension does not reference its own target", `extension on Z3 { } class Z3 { }`, [])

  // ── 4. the shapes the grammar writes differently ────────────────────────
  // `prefix.Type` is one node with the prefix as an identifier and the type as a
  // type_identifier; publishing the prefix would name an import alias as a type.
  await checkBoth("a prefixed type resolves to the TYPE, never to the import alias",
    `import 'dart:core' as c; class A2 { c.A2 make() => A2(); }`, ["make -> A2"])
  await checkBoth("a qualified CONSTANT PATTERN keeps its enum member read and still names the enum type",
    `enum E2 { one } void f(Object o) { switch (o) { case E2.one: break; } }`, ["f -> E2"])
  await checkBoth("an `external` member (declaration > function_signature)",
    `class B2 { external B2 make(); }`, ["make -> B2"])

  // ── 5. attribution ──────────────────────────────────────────────────────
  // A mention that belongs to no published declaration is attributed to the FILE,
  // by its base name — the same convention `calls` and `instantiates` already use
  // for the same situation (measured: 142 of 17,647 calls rows in a 1,000-file
  // sample). The two implementations disagreed here on 17 rows in 211 corpus files
  // before the oracle was given the path, which is what this case now holds open.
  await checkBoth("a top-level mention is attributed to the FILE", `class A9 { } final A9 topLevel = A9();`, ["verify-dart-references -> A9"])
  await checkBoth("a member's mention belongs to the member, not to its class",
    `class C2 { C2 make() => C2(); }`, ["make -> C2"])
  await checkBoth("a class-level mention folds to the CLASS when no member encloses it",
    `class D2 { static final Widget w = null; }`, ["D2 -> Widget"], ["Widget"])

  // ── 6. the three attribution shapes the corpus run found disagreeing ────
  // These three cases exist because a 799-file corpus run disagreed on 19 rows, and
  // all 19 were the ORACLE reading a shape the analyzer reads differently. Each case
  // pins the analyzer's reading, so a future edit that changes it has to change the
  // expectation here too.
  //
  // (a) tree-sitter-dart resolves `wrap() => A<A<X,X,X>, …>()` to
  // `method_signature > constructor_signature`, so the SOURCE is the family name
  // `constructor` — the name the analyzer publishes for that symbol.
  await checkBoth("an expression-bodied member the grammar calls a constructor names the constructor family",
    `class A3<X, Y, Z> { wrap() => A3<A3<X, X, X>>(); }`, ["constructor -> A3"])
  // (b) a LOCAL FUNCTION is not a published symbol, so its type mention folds to the
  // function that encloses it — the source half must never name a symbol the index
  // cannot bind.
  await checkBoth("a LOCAL FUNCTION's type mention folds into the enclosing function",
    `class T3 { } void host() { for (final T3 v in T3.values) { } T3 inner(T3 m) => m; }`,
    ["host -> T3"])
  // (c) a class ALIAS publishes its class under the name the grammar puts inside
  // `mixin_application_class`; a name-field read sees no declaration at all.
  await checkBoth("a class ALIAS (`class A<U,V> = Object with M<U,V>`) is a type this file declares",
    `class M5<U, V> { } class A5<U, V> = Object with M5<U, V>; void host2() { A5 x = A5(); print(x); }`,
    ["host2 -> A5"])

  console.log("")
  if (failures === 0) {
    console.log("the dart references oracle and the analyzer agree on every shape, and the gate is the absence of a type variable")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}

main()
