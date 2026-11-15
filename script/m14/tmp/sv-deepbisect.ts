// Deep bisect: inside `declare module 'svelte/motion'` body.
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

  const find = (n: any, t: string): any => {
    if (n.type === t) return n
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); const r = c && find(c, t); if (r) return r }
    return null
  }
  const moduleNode = find(root, "module")
  const body = moduleNode.namedChildren.find((c: any) => c.type === "statement_block")
  console.log("module body children: " + body.namedChildCount)
  for (let i = 0; i < body.namedChildCount; i++) {
    const n = body.namedChild(i)
    const code = chunk.slice(0, n.startIndex) + chunk.slice(n.endIndex)
    const h = hits(code)
    const tag = n.childForFieldName?.("name")?.text ?? n.text.slice(0, 45).replace(/\n/g, " ")
    if (h.length === 0) console.log(`KILLS: [${i}] ${n.type} :: ${JSON.stringify(tag)}`)
  }
  console.log("(no KILLS lines = edge survives every single-node removal)")
}
main()
