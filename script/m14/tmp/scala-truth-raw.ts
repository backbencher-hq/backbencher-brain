import fs from "node:fs"
import path from "node:path"
import { deriveTreeEdges, deriveScalaEdges } from "../differential"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const fp = process.argv[2]
const want = process.argv[3] ?? "overrides"
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(fp, "utf8")
  const root = parser.parse(src).rootNode
  const t = [...deriveTreeEdges(root, "scala"), ...deriveScalaEdges(root)]
  const rows = t.filter((e: any) => e.label === want)
  const byLabel: Record<string, number> = {}
  for (const e of t) byLabel[e.label] = (byLabel[e.label] ?? 0) + 1
  console.log(`truth labels: ${JSON.stringify(byLabel)}`)
  for (const e of rows.slice(0, 20)) console.log(`  ${e.from} -> ${e.target}`)
  console.log(`  -- ${rows.length} ${want} truth rows`)
}
main().catch((e) => { console.error(e); process.exit(1) })
