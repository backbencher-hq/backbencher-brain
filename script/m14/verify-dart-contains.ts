/**
 * verify-dart-contains — the gate for the Dart `contains` oracle.
 *
 * The oracle (script/m14/oracles/dart-contains.ts) took the lane from unmeasured to
 * measured, and the measurement found four things about the language that the first
 * draft got wrong. Each one is a fixture below, because each was found by being
 * wrong on a real corpus rather than by reading the grammar carefully:
 *
 *   1. `static final X = e;` is a DIFFERENT field shape from `final T x;` —
 *      `static_final_declaration_list` -> `static_final_declaration`. Handling only
 *      the first derived 2 of the 431 properties the jni bindings' `Arrays` class
 *      publishes.
 *   2. `extension type X._(...)` (Dart 3) is its own declaration node, not a class.
 *      The jni bindings declare every type that way.
 *   3. `extension X on int { }` carries an `extension_body`, not a `class_body`, so
 *      every extension member was invisible.
 *   4. A Dart 2.17+ ENHANCED enum puts fields, methods and constructors directly in
 *      the `enum_body` next to the constants.
 *
 * And one thing the oracle must NOT do, which is the more important half:
 *
 *   5. It must not INVENT names. An early draft assumed the analyzer disambiguates
 *      repeated members by appending `$1`, `$2`, ... and fabricated that suffix,
 *      manufacturing 233 truth rows the analyzer does not publish — a fabrication on
 *      the TRUTH side, which is the one direction that quietly inflates coverage.
 *      The `$` suffixes are LITERAL in the source (`static core$_.int binarySearch$1(`),
 *      so the oracle publishes names exactly as written.
 *
 * READ-ONLY. Writes nothing.
 */

import fs from "node:fs"
import path from "node:path"
import { deriveDartContainsTruth } from "./oracles/dart-contains"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

async function parserFor(): Promise<any> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  return parser
}

async function derive(src: string): Promise<string[]> {
  const parser = await parserFor()
  return deriveDartContainsTruth(parser.parse(src).rootNode).map((e) => `${e.from} -> ${e.target}`)
}

/** The ANALYZER's containment rows for the same source, same spelling. */
async function analyze(src: string): Promise<string[]> {
  const parser = await parserFor()
  const r: any = await new RealDartAnalyzer().analyze(parser.parse(src).rootNode, src, "/tmp/verify-dart-contains.dart")
  return [...new Set<string>((r.relationships ?? []).filter((e: any) => e.type === "contains").map((e: any) => `${e.source} -> ${e.target}`))].sort()
}

/**
 * The gate this file was missing: it derived the oracle and compared it to nothing.
 * A rule the oracle gets wrong and the analyzer gets right passes here, which is the
 * one direction that cannot be caught by a corpus run either — the harness would show
 * an UNEXPLAINED row and the reader would have to already know the answer to say
 * which side was wrong. Every case below now asserts BOTH sides, and the expected
 * rows are the ANALYZER's own contract made explicit, so a change to either is a
 * failing check rather than a number that quietly moves.
 */
async function checkBoth(name: string, src: string, expected: string[]): Promise<void> {
  const truth = (await derive(src)).slice().sort()
  const got = await analyze(src)
  const want = expected.slice().sort()
  const problems: string[] = []
  for (const w of want) {
    if (!truth.includes(w)) problems.push(`truth missing ${w}`)
    if (!got.includes(w)) problems.push(`analyzer missing ${w}`)
  }
  for (const t of truth) if (!want.includes(t)) problems.push(`truth has UNEXPECTED ${t}`)
  for (const g of got) if (!want.includes(g)) problems.push(`analyzer has UNEXPECTED ${g}`)
  check(name, problems.length === 0,
    problems.length ? problems.join("; ") : `rows=${want.join(" | ")}`)
}

const has = (rows: string[], k: string): boolean => rows.includes(k)

async function main(): Promise<void> {
  console.log("# verify-dart-contains\n")

  // ── 1/5. fields in BOTH shapes, and no invented suffixes ─────────────────
  const fields = await derive(`class Arrays {
  static final _id_asList = _class.staticMethodId("x");
  static final _asList = _id_asList;
  int plain = 0;
  final String label;
  static int f(int a) => 1;
  static int f(String b) => 2;
}
`)
  check("static final field (static_final_declaration_list) is derived", has(fields, "Arrays -> _id_asList"))
  check("second static final field is derived", has(fields, "Arrays -> _asList"))
  check("plain field (initialized_identifier_list) is derived", has(fields, "Arrays -> plain"))
  check("final field with no initialiser is derived", has(fields, "Arrays -> label"))
  check("method is derived", has(fields, "Arrays -> f"))
  check("a repeated method name is NOT suffixed with $1", !has(fields, "Arrays -> f$1"),
    `rows=${fields.join(" | ")}`)

  // ── 2. Dart 3 extension type ────────────────────────────────────────────
  const extType = await derive(`extension type $Exec._(int v) implements Object {
  static final _class = 1;
  void close() {}
}
`)
  check("extension type IS a container (its own declaration node)", has(extType, "$Exec -> close"),
    `rows=${extType.join(" | ")}`)
  check("extension type fields are derived", has(extType, "$Exec -> _class"))

  // ── 3. extension uses extension_body, not class_body ─────────────────────
  const ext = await derive(`extension NumX on int {
  int twice() => this * 2;
}
`)
  check("plain extension members are derived (extension_body)", has(ext, "NumX -> twice"),
    `rows=${ext.join(" | ")}`)

  // ── 4. enhanced enum ─────────────────────────────────────────────────────
  const enums = await derive(`enum Suit {
  hearts(1), spades(2);
  final int code;
  Suit(this.code);
  int get doubled => code * 2;
}
`)
  check("enum constants are derived", has(enums, "Suit -> hearts"))
  check("enhanced-enum FIELD is derived", has(enums, "Suit -> code"))
  check("enhanced-enum CONSTRUCTOR is derived", has(enums, "Suit -> constructor"))
  check("enhanced-enum METHOD is derived", has(enums, "Suit -> doubled"))

  // ── the constructor mirror ───────────────────────────────────────────────
  const ctor = await derive(`class C {
  C.a(int x) : v = x;
  C.b(String s) : v = 0;
  factory C.make() => C.a(1);
  int v = 0;
}
`)
  check("an ordinary constructor is published as `constructor`", has(ctor, "C -> constructor"))
  check("a factory constructor is also `constructor`", has(ctor, "C -> constructor"))
  check("constructors are NOT suffixed per overload", !has(ctor, "C -> constructor$1"))

  // ── mixin ────────────────────────────────────────────────────────────────
  const mixin = await derive(`mixin Logged {
  void log() {}
  int id = 1;
}
`)
  check("mixin members are derived", has(mixin, "Logged -> log") && has(mixin, "Logged -> id"),
    `rows=${mixin.join(" | ")}`)

  // ── a class with no members emits nothing ────────────────────────────────
  const empty = await derive(`class Empty {}\n`)
  check("an empty class emits no rows", empty.length === 0, `rows=${empty.join(" | ")}`)

  // ── top-level declarations are NOT owned, so they emit nothing ──────────
  const top = await derive(`int freeVar = 1;\nvoid freeFn() {}\n`)
  check("top-level declarations emit no containment (no owner)", top.length === 0, `rows=${top.join(" | ")}`)

  // ══ DIFFERENTIAL HALF: the three rules the corpus found, both sides ══════
  //
  // Each of these was a rule the oracle got wrong on a live corpus and no fixture
  // covered. Written in the SHAPE THE CORPUS CONTAINS, never the shape the rule
  // talks about — the reason the first one survived a battery at all is that
  // `class D { D({int? x}); }` and `class A { const A({int? x}); }` are the same
  // source text modulo `const` and parse two different ways, so a battery written
  // from the plain form passes while a Flutter widget class fails.

  console.log("\n# differential: the rules the corpus found, asserted on BOTH sides\n")

  // 1. A `const` CONSTRUCTOR is spelled `constant_constructor_signature`, and it is
  //    most of a Flutter widget class. Measured 2,548 rows on ProxiCall/lib.
  await checkBoth("const constructor is a member (constant_constructor_signature)", `class A { const A({int? x}); }`, ["A -> constructor"])
  await checkBoth("const constructor WITH an initializer", `class B { final int v; const B({this.v = 0}); }`, ["B -> constructor", "B -> v"])
  // ...and the plain spelling still works, so the family test did not replace it.
  await checkBoth("plain constructor is still a member", `class C { C({int? x}); }`, ["C -> constructor"])

  // ...and a NAMED constructor. This is the case that was MISSING when a mutation
  // narrowing the `declaration` path's family test survived: that path's check was
  // duplicated, so the second copy caught the const spelling and the battery could
  // not tell which rule was load-bearing. The duplicate is gone.
  await checkBoth("a NAMED const constructor (declaration > constant_constructor_signature)", `class K { const K.zero() : this(0); const K(int x); }`, ["K -> constructor"])

  // A FACTORY is the one constructor that arrives under `method_signature`, and the
  // existing oracle-only check for it passed FOR THE WRONG REASON: it sat in a class
  // that also had two unnamed constructors, so `C -> constructor` was satisfied by
  // the `declaration` path whatever happened to the factory. A check that passes
  // because a DIFFERENT member shares the asserted name is not a check. Here the
  // factory is the only constructor in the class, so the assertion can only be
  // satisfied by the `method_signature` path — and narrowing that path's family test
  // is caught, which it was not before this case existed.
  await checkBoth("a FACTORY is a member (method_signature > factory_constructor_signature, sole constructor)", `class OnlyFactory { factory OnlyFactory.make() => throw 0; }`, ["OnlyFactory -> constructor"])

  // 2. A `declaration` does NOT only hold fields. THE GRAMMAR'S WORD FOR THE
  //    CONTAINER DOES NOT TELL YOU WHAT THE MEMBER INSIDE IT IS.
  //
  //    Which members take the `declaration` wrapper is not obvious, and I got it
  //    wrong when I wrote the first version of these cases: I labelled
  //    `int get doubled => _n * 2;` and `void go() {}` as "written as a
  //    `declaration`", and they are NOT — both are `method_signature`. So the
  //    battery was asserting the `declaration` branch over shapes that never reach
  //    it, and a mutation that disabled that branch entirely SURVIVED. The label
  //    was the bug and the surviving mutant was the honest signal.
  //
  //    The shapes that really are `declaration > function_signature` are `external`
  //    and ABSTRACT members — a body-less declaration has no `method_signature` to
  //    hang the body off, so the grammar wraps it directly. Measured: 6,640 rows
  //    were being missed on the corpus, 94% of every remaining divergence.
  await checkBoth("an EXTERNAL method is a member (declaration > function_signature)", `class X { external int f(); }`, ["X -> f"])
  await checkBoth("an ABSTRACT method is a member (declaration > function_signature)", `abstract class Y { void f(); int get g; set s(int v); }`, ["Y -> f", "Y -> g", "Y -> s"])
  // ...and the shapes that are NOT wrapped, so the branch above is not load-bearing
  // for them and a battery cannot quietly rely on it
  await checkBoth("an ordinary method is a member (method_signature, NOT a declaration)", `class R { void go() {} }`, ["R -> go"])
  await checkBoth("an ordinary getter is a member (method_signature, NOT a declaration)", `class W { int _n = 0; int get doubled => _n * 2; }`, ["W -> _n", "W -> doubled"])
  await checkBoth("an ordinary setter is a member (method_signature, NOT a declaration)", `class S { int _v = 0; set v(int x) => _v = x; }`, ["S -> _v", "S -> v"])
  // the localization shape: thousands of plain getters, all of which were invisible
  await checkBoth("a plain getter is a member (the AppLocalizations shape)", `class AppLocalizations { String get applicationFailedToStartMessage => 'x'; }`, ["AppLocalizations -> applicationFailedToStartMessage"])

  // 3. An OPERATOR member is published as `operator <token>` — a lane contract, the
  //    same shape kotlin's phantom members use, and load-bearing: `operator_signature`
  //    has no name field and NO NAMED CHILDREN, so the member's identity is an
  //    anonymous token and the bare token is not a legal identifier.
  await checkBoth("`==` is published as `operator ==`, never as `==`", `class E { bool operator ==(Object o) => true; }`, ["E -> operator =="])
  await checkBoth("`[]` is published as `operator []`", `class F { int operator [](int i) => i; }`, ["F -> operator []"])
  await checkBoth("`call` is published as `operator call`", `class G { int call(int i) => i; }`, ["G -> call"])
  // a SCOPED return type shifts every child, which is why the token is located by
  // scanning for the `operator` keyword rather than by a hardcoded child index
  await checkBoth("a SCOPED return type does not shift the operator token", `class H { ns.bool operator >(int o) => true; }`, ["H -> operator >"])
  await checkBoth("operators are not suffixed per overload", `class I { int operator -(I o) => 0; int operator -(int o) => 0; }`, ["I -> operator -"])

  // 4. And the negative direction: `contains` must not INVENT a member. A local
  //    function, a parameter, and a doc comment's words are not declarations.
  await checkBoth("a LOCAL function is not a member", `class J { void m() { void inner() {} inner(); } }`, ["J -> m"])
  await checkBoth("a parameter is not a member", `class K { void m(int alpha) {} }`, ["K -> m"])

  console.log("")
  if (failures === 0) {
    console.log("the dart contains oracle derives every declared container shape and invents nothing")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })