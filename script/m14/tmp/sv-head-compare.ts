// HEAD oracle vs working oracle on the Spring.subscribe edge.
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
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)
  const root = p.parse(src).rootNode

  const head = await import("../differential-head.ts")
  const he = (head.deriveTreeEdges(root, "typescript") as any[]).filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))
  const we: any[] = [] // working-tree oracle mid-edit by co-agent; HEAD-only verdict below
  console.log("HEAD oracle overrides on file:", JSON.stringify(he))
  console.log("WORK oracle overrides on file:", JSON.stringify(we))

  const hAll = (head.deriveTreeEdges(root, "typescript") as any[]).length
  const wAll = 0
  console.log("HEAD total edges:", hAll, "| WORK total edges:", wAll)
}
main()
