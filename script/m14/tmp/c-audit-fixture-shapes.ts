import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const SHAPES: Array<[string, string]> = [
  ["member call wrapped", "int f(Tally *t, int n) {\n  return t\n      ->record(n);\n}\n"],
  ["plain call wrapped", "int g(void) {\n  return helper\n      (2);\n}\n"],
  ["specifier keyword/tag split", "struct\nCounters {\n  int hits;\n};\n"],
  ["call across two lines in assignment", "void h(void) {\n  int r = compute(1,\n      2);\n}\n"],
]
for (const [name, src] of SHAPES) {
  const tree = parser.parse(src)
  const nodes: string[] = []
  const walk = (n: any): void => {
    if (["call_expression", "field_expression", "struct_specifier", "identifier", "field_identifier"].includes(n.type)) {
      nodes.push(`${n.type}@${n.startPosition.row + 1}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(tree.rootNode)
  console.log(`${name}: hasError=${tree.rootNode.hasError} :: ${nodes.join(" ")}`)
}
