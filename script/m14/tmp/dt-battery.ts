import * as fs from "fs"
import * as path from "path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  named_ctor: `class Foo {\n  Foo();\n  Foo.named();\n}\nvoid m() {\n  var a = Foo.named();\n  var b = Foo();\n}\n`,
  mixin_on_alias: `mixin M on _i1.Base {}\nclass C extends _i1.Smart with _i2.Mixin implements _i3.Iface {}\n`,
  redirect_alias: `class Z {\n  factory Z.make() = _i1.Impl.make;\n}\n`,
  unnamed_ext: `extension on String {\n  String shout() => toUpperCase();\n}\n`,
  super_calls: `class B extends A {\n  B() : super(1);\n  B.named() : super.named(2);\n  void m() { super.foo(); super.toString(); }\n}\n`,
  cascade_getter: `void m() {\n  var x = obj..length;\n  list..add(1)..clear();\n}\n`,
  tearoff: `void m() {\n  var f = obj.method;\n  list.map(foo);\n  run(cb: named);\n}\n`,
  interp: `void m(String name) {\n  print('hello ' + name + suffix);\n}\n`,
  operators: `class Vec {\n  Vec operator +(Vec o) => Vec();\n}\nvoid m(Vec a, Vec b) {\n  var c = a + b;\n  var e = a == b;\n}\n`,
  member_reads: `class C {\n  int count = 0;\n  void m(C other) {\n    var x = count;\n    var y = this.count;\n    var z = other.count;\n    count = x + 1;\n  }\n}\n`,
  cond_chain: `void m(A? a) {\n  a?.b();\n  var x = a?.value;\n  a?.b.c();\n}\n`,
  deep_chain: `void m() {\n  a.b.c();\n  Future.delayed(d, fn);\n  store.box.fetch(k);\n}\n`,
  subscript: `void m(List<int> xs, Map<String, int> m) {\n  var a = xs[0];\n  xs[1] = 5;\n  var b = m['k'];\n}\n`,
  assert_args: `void m() {\n  assert(check(x), 'bad');\n  identical(a, b);\n}\n`,
  enum_args: `enum E {\n  a(1), b(2);\n  const E(int v);\n}\n`,
  static_access: `class C {\n  static int total = 0;\n  static int get count => total;\n}\nvoid m() {\n  var x = C.total;\n  var y = C.count;\n}\n`,
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const only = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (only && name !== only) continue
    const root = await parseSrc(src)
    const r: any = await new RealDartAnalyzer().analyze(root, src, "t.dart")
    const syms = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
    const rels = (r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const ora = mod.deriveDartEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)
    console.log("=== " + name + " err=" + root.hasError)
    console.log("  syms:", JSON.stringify(syms))
    console.log("  rels:", JSON.stringify(rels))
    console.log("  ora: ", JSON.stringify(ora))
  }
}
main()
