import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `class Counter {
  int value = 0;
  final String label;
  Counter(this.value);
  Counter.zero() : value = 0;
  factory Counter.make() => Counter(1);
  void increment() { value++; }
  static int get max => 10;
  set scale(double s) {}
}
enum Color { red, green, blue }
mixin Logged { void log() {} }
extension NumX on int { int twice() => this * 2; }
`
const root = p.parse(src).rootNode
const sub = (n: any, d: number): void => {
  console.log("  ".repeat(d) + `${n.type}${n.namedChildCount === 0 ? "" : ""}  ${JSON.stringify(n.text.slice(0, 52))}`)
  for (const c of n.namedChildren ?? []) sub(c, d + 1)
}
sub(root, 0)
