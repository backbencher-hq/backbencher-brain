// Reduce the +1 corpus regression introduced by the assignment-scoped command
// chain (GrailsApplicationPostProcessor.groovy, first error row 313).
// Runs the same shapes against two wasms so the delta is attributable.
import * as fs from "fs"

const [w1, w2] = [process.argv[2] ?? "/tmp/g841-r3.wasm", process.argv[3] ?? "wasm/tree-sitter-groovy.wasm"]

const cases: { cls: string; src: string }[] = [
  { cls: "A. local var dotted read (the reported line)", src: "class C {\n  void m() {\n    String[] p = ac.environment.activeProfiles\n  }\n}\n" },
  { cls: "B. for-in typed + dotted read local", src: "class C {\n  void m() {\n    String[] p = ac.env.activeProfiles\n    for (P plugin in pm.allPlugins) {\n      continue\n    }\n  }\n}\n" },
  { cls: "C. typed for-in only", src: "class C {\n  void m(pm) {\n    for (P plugin in pm.allPlugins) {\n      continue\n    }\n  }\n}\n" },
  { cls: "D. array-typed local, no init read", src: "class C {\n  void m(ac) {\n    String[] p = ac.env.active\n  }\n}\n" },
  { cls: "E. plain local scalar dotted 3-seg", src: "class C {\n  void m(ac) {\n    def p = ac.env.active\n  }\n}\n" },
  { cls: "F. assignment dotted 3-seg", src: "class C {\n  void m(ac) {\n    x = ac.env.active\n  }\n}\n" },
  { cls: "G. if with negated call + continue", src: "class C {\n  void m(a, b) {\n    for (p in a) {\n      if (!p.supported() || !p.enabled(b)) {\n        continue\n      }\n    }\n  }\n}\n" },
  { cls: "H. new + method chain on next line", src: "class C {\n  void m(r, a) {\n    new Adapter(r, a, a.env, g.getClass())\n      .register(g)\n  }\n}\n" },
  { cls: "I. assignment to dotted left from call", src: "class C {\n  void m(o) {\n    o.a.b = c()\n  }\n}\n" },
  { cls: "J. assignment where RHS is single call", src: "class C {\n  void m() {\n    x = f()\n  }\n}\n" },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const results: Record<string, string[]> = {}
  for (const wasm of [w1, w2]) {
    const lang = await L.load(fs.readFileSync(wasm))
    const parser = new P()
    parser.setLanguage(lang)
    results[wasm] = cases.map((c) => ((parser.parse(c.src).rootNode as any).hasError ? "FAIL" : "OK"))
  }
  console.log(`${"shape".padEnd(46)} base  cand`)
  cases.forEach((c, i) => {
    const [a, b] = [results[w1][i], results[w2][i]]
    const mark = a !== b ? "  <== DIFF" : ""
    console.log(`${c.cls.padEnd(46)} ${a.padEnd(5)} ${b}${mark}`)
  })
}
main()
