import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("/tmp/bb-wasm_tree-sitter-c_tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const real = readFileSync("/home/ishaq2321/bb_tests/repositories/sqlite/src/tclsqlite.c", "utf8").split("\n").slice(274, 280).join("\n")
const mine = readFileSync("validation/m14/fixtures/c/macro-forward-read.c", "utf8").split("\n").filter(l => l.startsWith("static int M60_API") || l.startsWith("static int m60_two")).join("\n")
for (const [label, src] of [["REAL tclsqlite L275-280", real], ["MINE", mine]] as Array<[string,string]>) {
  console.log(`\n=== ${label} ===`)
  console.log(src)
  const t = parser.parse(src)
  const walk = (n: any, d: number): void => {
    console.log(`${"  ".repeat(d)}${n.type}${n.childCount === 0 ? ` "${n.text.slice(0, 40)}"` : ""}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
  }
  walk(t.rootNode, 0)
}
