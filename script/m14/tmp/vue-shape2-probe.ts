import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-javascript.wasm"))
  const p = new P(); p.setLanguage(lang)
  const dump = (n: any, d: number, out: string[]) => {
    out.push("  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + " = " + JSON.stringify(n.text.slice(0, 36)))
    for (let i = 0; i < n.childCount && i < 10; i++) dump(n.child(i), d + 1, out)
  }
  for (const src of [`const o = { data: () => ({ count: 0 }) }`, `const o = { data: function() { return { count: 0 }; } }`]) {
    const out: string[] = []
    dump(p.parse(src).rootNode, 0, out)
    console.log("=== " + src.slice(0, 30) + " ===\n" + out.slice(0, 26).join("\n"))
  }
}
main()
