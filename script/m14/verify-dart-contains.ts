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

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

async function derive(src: string): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  return deriveDartContainsTruth(parser.parse(src).rootNode).map((e) => `${e.from} -> ${e.target}`)
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

  console.log("")
  if (failures === 0) {
    console.log("the dart contains oracle derives every declared container shape and invents nothing")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })