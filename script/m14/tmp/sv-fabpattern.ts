// What exactly do lines 2035-2038 add to the oracle output?
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
  const lines = src.split("\n")

  // Context around the culprit
  console.log("context 2020-2045:")
  for (let i = 2019; i < 2045; i++) console.log((i + 1) + ": " + lines[i])

  const withL = lines.join("\n")
  const withoutL = lines.slice(0, 2034).concat(lines.slice(2038)).join("\n")
  const e1 = mod.deriveTreeEdges(p.parse(withL).rootNode, "typescript") as any[]
  const e2 = mod.deriveTreeEdges(p.parse(withoutL).rootNode, "typescript") as any[]
  const key = (x: any) => x.label + "|" + x.from + "|" + x.target
  const s2 = new Set(e2.map(key))
  const added = e1.filter((x) => !s2.has(key(x)))
  console.log("\nedges ADDED by lines 2035-2038 (" + added.length + "):")
  for (const e of added.slice(0, 25)) console.log("  " + e.label + ": " + e.from + " -> " + e.target)
}
main()
