import * as WTS from "web-tree-sitter"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const src of [
    `function f() { try {} catch (err) { return err } }`,
    `function f() { try {} catch { return 1 } }`,
    `function f() { try {} catch ({ a, b }) { return a } }`,
    `function f() { try {} catch ([x]) { return x } }`,
  ]) {
    const p = new P(); p.setLanguage(lang)
    const tree = p.parse(src)
    const cc = (function find(n: any): any { if (n.type === "catch_clause") return n; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { const r = find(c); if (r) return r } } return null })(tree.rootNode)
    const parts: string[] = []
    for (let i = 0; i < cc.childCount; i++) { const c = cc.child(i); parts.push(`[${i}] ${c.type}${c.isNamed ? "" : " (anon)"}`) }
    console.log(`${src.slice(28).padEnd(28)} children: ${parts.join("  ")}`)
  }
}
main()
