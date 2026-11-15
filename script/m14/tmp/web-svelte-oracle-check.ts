// Oracle vs analyzer on the corpus file: who says what about the getter call?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = "/home/ishaq2321/bb_tests/repositories/svelte/packages/svelte/tests/runtime-runes/samples/class-state-raw/main.svelte"

async function main() {
  console.log("START")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANGS: Record<string, any> = {}
  LANGS.js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))

  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(LANGS.js)
  // script content (between <script> and </script>)
  const m = src.match(/<script>([\s\S]*?)<\/script>/)!
  const root = p.parse(m[1]).rootNode
  const mod: any = await import("/home/ishaq2321/mcp/backbencher-brain/script/m14/differential.ts")
  console.log("PARSED, top children:", root.namedChildCount); const edges = mod.deriveTypeScriptEdges(root) as any[]
  console.log("edges total:", (edges as any[]).length); console.log("edges total:", (edges as any[]).length); const calls = edges.filter((x: any) => x.label === "calls")
  for (const c of calls) console.log("oracle calls:", c.from, "->", c.target)
}
main()
