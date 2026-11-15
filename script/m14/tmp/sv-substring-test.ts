// Decisive: strip SpringOptions/SpringUpdateOptions and comment blocks —
// if the edge dies, it was born from a prefix/substring match (oracle bug).
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
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)

  const hits = (code: string) => {
    const e = mod.deriveTreeEdges(p.parse(code).rootNode, "typescript")
    return (e as any[]).filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))
  }

  const noOpts = src.replace(/SpringOptions/g, "ZzzOptions").replace(/SpringUpdateOptions/g, "ZzzUpdateOptions")
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const both = noComments.replace(/SpringOptions/g, "ZzzOptions").replace(/SpringUpdateOptions/g, "ZzzUpdateOptions")

  console.log("opts renamed   ->", JSON.stringify(hits(noOpts)))
  console.log("comments gone  ->", JSON.stringify(hits(noComments)))
  console.log("both           ->", JSON.stringify(hits(both)))
}
main()
