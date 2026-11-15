import * as WTS from "web-tree-sitter"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-groovy.wasm")
  const p = new P()
  p.setLanguage(lang)
  const dump = (n: any, depth: number, out: string[]) => {
    out.push("  ".repeat(depth) + n.type + (n.isNamed ? "" : " (anon)") + " = " + JSON.stringify(n.text.slice(0, 40)))
    for (let i = 0; i < n.childCount && i < 12; i++) dump(n.child(i), depth + 1, out)
  }
  for (const src of [`class A {\n def f(o) {\n def y = o as String\n }\n}`, `import static foo.Bar.*\nclass A {}`]) {
    const root = p.parse(src).rootNode
    const out: string[] = []
    dump(root, 0, out)
    console.log("=== " + JSON.stringify(src.slice(0, 30)) + " ===\n" + out.slice(0, 45).join("\n"))
  }
}
main()
