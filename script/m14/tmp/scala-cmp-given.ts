import fs from "node:fs"
import path from "node:path"
import { deriveScalaContainsTruth } from "../differential"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const fp = process.argv[2]
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(fp, "utf8")
  const root = parser.parse(src).rootNode
  const t = deriveScalaContainsTruth(root).filter(e => e.target.startsWith("given_"))
  const res: any = new RealScalaAnalyzer().analyze(root, src, fp)
  const a = (res.relationships ?? []).filter((r: any) => r.type === "contains" && String(r.target).startsWith("given_"))
  console.log("ORACLE   :", t.map((e: any) => `${e.from}->${e.target}`).join(" "))
  console.log("ANALYZER :", a.map((e: any) => `${e.source}->${e.target}@${e.line_number}`).join(" "))
}
main().catch(e => { console.error(e); process.exit(1) })
