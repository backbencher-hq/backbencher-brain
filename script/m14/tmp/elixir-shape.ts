import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILE = arg("file")!, LINE = Number(arg("line"))
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  const root = p.parse(fs.readFileSync(FILE, "utf8")).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.startPosition.row + 1 === LINE && (n.type === "call" || n.type === "parenblock")) {
      const dump = (x: any, d = 0): string => `${"  ".repeat(d)}${x.type}${x.isNamed ? "" : " (anon)"} [${x.startPosition.row + 1}] ${JSON.stringify(x.text.slice(0, 40))}\n` + x.children.map((c: any) => dump(c, d + 1)).join("")
      console.log(dump(n))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main()
