import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse("let loc = typeof<Foo>.Assembly.Location")
const st: any[] = [tree.rootNode]
while (st.length) { const n = st.pop()
  if (["types","simple_type","typed_expression","static_type","long_identifier_or_op"].includes(n.type))
    console.log(`${n.type}  parent=${n.parent?.type}  text=${JSON.stringify(n.text)}`)
  for (let i=0;i<n.namedChildCount;i++){const c=n.namedChild(i); if(c) st.push(c)} }
