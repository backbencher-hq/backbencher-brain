import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const src = fs.readFileSync(process.argv[3], "utf8")
const t = parser.parse(src)
const walk = (n: any, d: number, path: string) => {
  if (n.startPosition.row + 1 > 60 && n.type !== "program" && n.startPosition.row + 1 < 216 && d > 2) { }
  if (d <= 3 || /ERROR|juxt|command/.test(n.type)) console.log(`${"  ".repeat(d)}${n.type} [${n.startPosition.row+1}:${n.startPosition.column+1}] ${JSON.stringify(n.text.slice(0,50))}`)
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d+1, path)
}
walk(t.rootNode, 0, "")
