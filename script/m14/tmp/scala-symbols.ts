import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const fp = process.argv[2]
const re = process.argv[3] ? new RegExp(process.argv[3]) : null
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(fp, "utf8")
  const res: any = new RealScalaAnalyzer().analyze(parser.parse(src).rootNode, src, fp)
  for (const s of res.symbols) {
    if (re && !re.test(s.name) && !re.test(String(s.ownerName))) continue
    console.log(`  ${s.name}  kind=${s.kind} owner=${s.ownerName ?? "-"} line=${s.range?.startLine} type=${s.metadata?.type ?? "-"}`)
  }
  console.log(`  -- ${res.symbols.length} symbols`)
}
main().catch(e => { console.error(e); process.exit(1) })
