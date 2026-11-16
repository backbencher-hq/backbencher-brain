import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `struct Point { int x; unsigned int count; struct Node *next; NSString *label; };\nenum Color { Red, Green = 3, Blue };\nint helper(int limit, Foo *f, ...);\nint g = LIMIT;\n`
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const dump = (n: any, d: number): void => {
    if (n.isNamed) console.log("  ".repeat(d) + n.type + ((n.type === "identifier" || n.type === "type_identifier") ? ` [${n.text}]` : ""))
    if (d > 5) return
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(root, 0)
}
main()
