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
    `function f() { const file = 1; use(file) }`,
    `function f() { try {} catch (e) { use(e) } }`,
    `function f() { try {} catch ({ msg }) { use(msg) } }`,
  ]) {
    const p = new P(); p.setLanguage(lang)
    const tree = p.parse(src)
    const out: string[] = []
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "variable_declarator") {
        out.push(`variable_declarator: field"name"=${n.childForFieldName("name") ? n.childForFieldName("name").text : "NULL"} field"left"=${n.childForFieldName("left") ? n.childForFieldName("left").text : "NULL"} field"value"=${n.childForFieldName("value") ? n.childForFieldName("value").text : "NULL"}`)
      }
      if (n.type === "catch_clause") {
        const f0 = n.namedChild(0)
        out.push(`catch_clause: first named child=${f0 ? f0.type : "none"} (is body? ${f0 ? f0.type === "statement_block" : "-"})`)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    console.log(src.slice(13).padEnd(44) + " | " + out.join(" ; "))
  }
}
main()
