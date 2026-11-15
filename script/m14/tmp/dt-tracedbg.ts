import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const f = "/home/ishaq2321/bb_tests/repositories/proxicall/lib/ui/screens/ems/employee_dashboard.dart"
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  // replicate oracle helpers minimally: find declined node, print full ancestor chain + siblings
  const walk = (n: any): void => {
    if (n.type === "identifier" && n.text === "declined") {
      const chain: string[] = []
      let c: any = n
      while (c) { chain.push(`${c.type}[${c.startIndex}-${c.endIndex}]`); c = c.parent }
      console.log("declined chain:", chain.slice(0, 10).join(" < "))
      const par = n.parent
      if (par) {
        console.log("siblings of declined:");
        for (let i = 0; i < par.childCount; i++) {
          const s = par.child(i)
          console.log(`  [${i}] named=${s.isNamed} type=${s.type} text=${s.text.slice(0, 20)}`);
        }
        const nx = n.nextNamedSibling
        console.log("nextNamedSibling:", nx ? `${nx.type} '${nx.text.slice(0, 30)}'` : "null")
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
