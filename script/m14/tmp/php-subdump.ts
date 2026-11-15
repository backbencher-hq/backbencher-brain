import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/php-sub.php", "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "variable_name" && (n.text === "$a" ) && n.startIndex > 60) {
      const chain: string[] = []
      let c: any = n
      while (c) { chain.push(`${c.type}[${c.startIndex}-${c.endIndex}]`); c = c.parent }
      console.log("--- $a @", n.startIndex, chain.slice(0, 6).join(" < "));
      const nx = n.nextSibling
      console.log("    next raw sib:", nx ? `${nx.isNamed ? "" : "'"}${nx.type}'${nx.isNamed ? "" : "'"}` : "null")
      const nn = n.nextNamedSibling
      console.log("    next named sib:", nn ? `${nn.type}[${nn.startIndex}-${nn.endIndex}] '${nn.text.slice(0, 14)}'` : "null")
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
