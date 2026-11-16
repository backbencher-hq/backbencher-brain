// Classify the fresh ts-lane MISSING: Spring.subscribe -> Readable.subscribe
// overrides in packages/svelte/types/index.d.ts. What does the file declare,
// what does the analyzer emit, what does the oracle derive?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ts = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))

  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)
  const root = p.parse(src).rootNode

  // Show the Spring class declaration + subscribe method + Readable decl
  const lines = src.split("\n")
  const show: number[] = []
  lines.forEach((ln, i) => {
    if (/class Spring|interface Readable|subscribe/.test(ln)) show.push(i)
  })
  for (const i of show.slice(0, 14)) console.log((i + 1) + ": " + lines[i].trim().slice(0, 110))

  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "index.d.ts", {})
  const rels = (r.relationships ?? [])
  const spr = rels.filter((x: any) => String(x.from).includes("Spring") || String(x.target).includes("Spring"))
  console.log("\nSpring-related relationships:")
  for (const e of spr.slice(0, 20)) console.log("  " + e.type + ": " + e.from + " -> " + e.target)
  const ovr = rels.filter((x: any) => x.type === "overrides")
  console.log("\ntotal overrides edges in file: " + ovr.length)
  for (const e of ovr.slice(0, 8)) console.log("  " + e.from + " -> " + e.target)
}
main()
