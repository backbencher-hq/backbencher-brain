// Node-exact bisect: remove declarations by their REAL tree ranges.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = "/home/ishaq2321/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ts = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const chunk = fs.readFileSync(FILE, "utf8").split("\n").slice(2000, 2250).join("\n")
  const p = new P(); p.setLanguage(ts)
  const root = p.parse(chunk).rootNode
  const hits = (code: string) => (mod.deriveTreeEdges(p.parse(code).rootNode, "typescript") as any[])
    .filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))

  const top: any[] = []
  for (let i = 0; i < root.namedChildCount; i++) top.push(root.namedChild(i))
  console.log("top-level nodes in chunk:")
  top.forEach((n, i) => {
    const name = n.childForFieldName?.("name")?.text ?? n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")?.text ?? ""
    console.log("  [" + i + "] " + n.type + " :: " + (n.type.match(/declaration|statement/) ? name : n.text.slice(0, 50)))
  })

  // Remove each declaration node by exact range; report hit count
  for (let i = 0; i < top.length; i++) {
    const n = top[i]
    if (!/declaration|export_statement/.test(n.type)) continue
    const code = chunk.slice(0, n.startIndex) + chunk.slice(n.endIndex)
    const h = hits(code)
    console.log(`minus [${i}] ${n.type} (${(n.childForFieldName?.("name")?.text ?? "?")}): hits=${h.length}`)
  }
}
main()
