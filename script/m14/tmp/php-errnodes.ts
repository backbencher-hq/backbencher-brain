// Dump ERROR/MISSING nodes with their lines, so a fixture that does not parse
// cleanly is fixed rather than pinned.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const file = process.argv[2]!
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  let n = 0
  const walk = (node: any) => {
    if (node.type === "ERROR" || node.isMissing) {
      n++
      const line = src.slice(0, node.startIndex).split("\n").length
      console.log(`#${n} ${node.isMissing ? "MISSING " : "ERROR "}${node.type} line=${line} span=${node.startIndex}-${node.endIndex} text=${JSON.stringify(node.text.slice(0, 80))}`)
      console.log(`     ${JSON.stringify(lines[line - 1] ?? "")}`)
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i))
  }
  walk(root)
  console.log("total error nodes:", n)
}
main()
