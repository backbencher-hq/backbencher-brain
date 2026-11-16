// Which of the `references` sub-sites does the analyzer actually EXERCISE on a
// draw? A rule the corpus never reaches is unproven, not proven-correct: the
// battery cannot make it load-bearing and the fixture must pin it instead.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2]
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
  const bySub: Record<string, number> = {}
  const byMeta: Record<string, number> = {}
  let total = 0
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const res: any = analyzer.analyze(parser.parse(src).rootNode, src, fp)
    for (const r of res.relationships ?? []) {
      if (r.type !== "references") continue
      total++
      const k = r.metadata?.relationshipType ?? "(none)"
      bySub[k] = (bySub[k] ?? 0) + 1
      const d = r.metadata?.declaredOn ?? "-"
      const bk = `${k} <- ${d}`
      byMeta[bk] = (byMeta[bk] ?? 0) + 1
    }
  }
  console.log(`# ${repo} draw ${files.length} files: ${total} references edges`)
  for (const [k, v] of Object.entries(bySub).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(7)}  relationshipType=${k}`)
  }
  console.log("--- by declaredOn ---")
  for (const [k, v] of Object.entries(byMeta).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(7)}  ${k}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
