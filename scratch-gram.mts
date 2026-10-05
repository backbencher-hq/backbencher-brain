import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => "$HOME/mcp/bb-lanes/json/node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await Language.load("$HOME/mcp/bb-lanes/json/wasm/tree-sitter-json.wasm")
const p = new Parser()
p.setLanguage(lang)
const show = (label: string, src: string) => {
  const t = p.parse(src)
  const r = t.rootNode
  console.log(label, "->", r.type, r.namedChildCount, JSON.stringify(r.namedChildren.map((c: any) => c.type)))
}
show("two objects", '{"a":1}\n{"b":2}')
show("comment then object", '// hi\n{"a":1}')
show("array+object", '[1]\n{"a":1}')
show("object+string", '{"a":1}\n"tail"')
show("trailing newline only", '{"a":1}\n')
show("comment between", '{"a":1}\n// mid\n{"b":2}')
show("two arrays", '[1]\n[2]')
show("scalar then object", '3\n{"a":1}')
const t3 = p.parse('{"a":1,"a":2}')
const o = t3.rootNode.namedChild(0)
console.log("dupkeys pairs:", o.namedChildCount, JSON.stringify(o.namedChildren.map((c: any) => c.type)))