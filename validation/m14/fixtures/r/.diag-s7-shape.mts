import * as fs from "node:fs"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))
const text = fs.readFileSync(process.argv[2], "utf8")
const tree = parser.parse(text)
const visit = (n: any, d: number): void => {
  const line = n.startPosition.row + 1
  if (line >= 85 && line <= 93 && d < 8) {
    console.log(`${"  ".repeat(d)}line ${line} type=${n.type} named=${n.isNamed} op=${JSON.stringify(String(n.childForFieldName?.("operator")?.text ?? ""))} text=${JSON.stringify(String(n.text).slice(0,50))}`)
  }
  for (let i = 0; i < n.childCount; i++) visit(n.child(i), d + 1)
}
visit(tree.rootNode, 0)
