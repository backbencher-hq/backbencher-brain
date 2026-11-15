import * as WTS from "web-tree-sitter"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const src of [
    `function f() { for (const file of files) { use(file) } }`,
    `function f() { for (let k in obj) { use(k) } }`,
    `function f() { for (const [a, b] of pairs) { use(a) } }`,
  ]) {
    const p = new P(); p.setLanguage(lang)
    const tree = p.parse(src)
    const fi = (function find(n: any): any { if (n.type === "for_in_statement") return n; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { const r = find(c); if (r) return r } } return null })(tree.rootNode)
    const parts: string[] = []
    if (fi) {
      for (let i = 0; i < fi.childCount; i++) { const c = fi.child(i); parts.push(`${c.isNamed ? c.type : `"${c.type}"`}${c.text.length < 18 ? `=${c.text}` : ""}`) }
    }
    console.log(src.slice(13))
    console.log(`  for_in_statement children: ${parts.join("  ")}`)
  }
}
main()
