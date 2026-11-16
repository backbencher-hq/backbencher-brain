// M49 W9 — F6 adjudication part 2: are the java/js/cpp/go dead literals
// REDUNDANT (a live sibling covers the shape) or SOLE-ARM (real gap)?
// Dumps the real node names for each shape the literal names.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Record<string, { wasm: string; cases: Array<[string, string]> }> = {
  java: {
    wasm: "tree-sitter-java.wasm",
    cases: [
      ["comment inside args", "class A { void f() { g(1 /* c */, 2); } }"],
      ["line comment file", "// hi\nclass B { }"],
      ["annotation bare", "class C { @Override void m() {} }"],
      ["annotation qualified", "class D { @org.spring.Service void m() {} }"],
      ["annotation on @interface", "@interface Ann { String value(); }"],
    ],
  },
  cpp: {
    wasm: "tree-sitter-cpp.wasm",
    cases: [
      ["template type param", "template <typename T> struct S { T v; };"],
      ["template value param", "template <class T, int N> struct Q {};"],
      ["template template param", "template <template<class> class C> struct R {};"],
      ["compound assign", "void f(){ int a = 0; a += 1; a -= 2; }"],
      ["typename qualified", "typename S<int>::X y;"],
      ["typename in fn scope", "template<class T> void g(){ typename T::X v; }"],
    ],
  },
  go: {
    wasm: "tree-sitter-go.wasm",
    cases: [
      ["selector expr", "package p\ntype S struct{ f int }\nfunc g(){ s := S{}; _ = s.f }"],
      ["compound assign", "package p\nfunc f(){ a := 0; a += 1; a = 2; _ = a }"],
      ["field decl", "package p\ntype S struct{ f int }"],
    ],
  },
  javascript: {
    wasm: "tree-sitter-javascript.wasm",
    cases: [
      ["object method + getter", "const o = { m() {}, get g() { return 1 }, x: 1 };"],
      ["class method", "class C { m() {} }"],
      ["member access", "const y = o.x;"],
    ],
  },
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  for (const lang of Object.keys(CASES)) {
    const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", CASES[lang].wasm)))
    const raw = new Set<string>()
    for (let i = 0; i < grammar.nodeTypeCount; i++) {
      const n = grammar.nodeTypeForId(i)
      if (n) raw.add(n)
    }
    const parser = new P()
    parser.setLanguage(grammar)
    console.log(`\n########## ${lang} (grammar types: ${raw.size}) ##########`)
    for (const [label, src] of CASES[lang].cases) {
      const tree = parser.parse(src)
      const lines: string[] = []
      const walk = (n: any, d: number) => {
        if (d > 9) return
        lines.push("  ".repeat(d) + n.type + " :: " + JSON.stringify(String(n.text).slice(0, 34)))
        for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
      }
      walk(tree.rootNode, 0)
      console.log(`### ${label}\n    ${JSON.stringify(src)}\n${lines.join("\n")}`)
    }
  }
}

main()
