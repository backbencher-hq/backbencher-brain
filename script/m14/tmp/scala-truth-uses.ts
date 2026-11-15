import fs from "node:fs"
import path from "node:path"
import { deriveScalaUsesTruth } from "../differential"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const fp = process.argv[2]
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(fp, "utf8")
  const rows = deriveScalaUsesTruth(parser.parse(src).rootNode)
  const want = process.argv[3] ?? ""
  for (const r of rows) if (!want || r.from === want) console.log(`  ${r.from} -> ${r.target}`)
  console.log(`  -- ${rows.length} truth uses rows`)
}
main().catch((e) => { console.error(e); process.exit(1) })
