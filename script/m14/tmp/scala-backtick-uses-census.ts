import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  let total = 0, quoted = 0
  const ex: string[] = []
  for (const f of files) {
    const fp = path.join(CORPUS_ROOT, repo, f)
    const res: any = analyzer.analyze(parser.parse(fs.readFileSync(fp, "utf8")).rootNode, fs.readFileSync(fp, "utf8"), fp)
    for (const r of res.relationships ?? []) {
      if (r.type !== "uses") continue
      total++
      if (String(r.target).includes("`")) { quoted++; if (ex.length < 8) ex.push(`  ${f}:${r.line_number}  ${r.source} -> ${JSON.stringify(r.target)}`) }
    }
  }
  console.log(`# ${repo}: ${total} uses rows, ${quoted} whose TARGET carries backticks`)
  for (const e of ex) console.log(e)
}
main().catch((e) => { console.error(e); process.exit(1) })
