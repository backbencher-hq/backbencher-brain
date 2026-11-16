// Halves bisect: which REGION of the d.ts makes the oracle emit the edge?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

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

  const hits = (code: string) => (mod.deriveTreeEdges(p.parse(code).rootNode, "typescript") as any[])
    .filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring")).length

  // Split into chunks of 250 lines; each chunk parsed standalone
  for (let i = 0; i < lines.length; i += 250) {
    const chunk = lines.slice(i, i + 250).join("\n")
    const h = hits(chunk)
    if (h > 0) console.log(`lines ${i + 1}-${Math.min(i + 250, lines.length)}: HITS ${h}`)
  }
  console.log("done")
}
main()
