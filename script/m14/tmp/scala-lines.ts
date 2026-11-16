// Line-number census for the scala lane.
//
// The question is not "are lines present" but "which rows have none, and is that
// absence a specific class". Kotlin's method is to COUNT and not assume, so this
// counts per label and per confidence, and prints the node types and metadata of
// the rows that carry no line.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const drawFile = process.argv[3]

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = drawFile
    ? fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    : walkFiles(path.join(CORPUS, repo)).sort().slice(0, 400)

  const total: Record<string, number> = {}
  const withLine: Record<string, number> = {}
  const zeroLine: Record<string, number> = {}
  const zeroKinds: Record<string, number> = {}
  let symTotal = 0
  let symNoRange = 0

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const res: any = analyzer.analyze(parser.parse(src).rootNode, src, fp)
    for (const s of res.symbols ?? []) {
      symTotal++
      if (!s.range || !s.range.startLine) symNoRange++
    }
    for (const r of res.relationships ?? []) {
      const t = String(r.type)
      total[t] = (total[t] ?? 0) + 1
      if (r.line_number === undefined || r.line_number === null) {
        zeroLine[t] = (zeroLine[t] ?? 0) + 1
        const k = `${t} declaredOn=${r.metadata?.declaredOn ?? "-"} relType=${r.metadata?.relationshipType ?? "-"}`
        zeroKinds[k] = (zeroKinds[k] ?? 0) + 1
      } else {
        if (r.line_number === 0) zeroLine[t] = (zeroLine[t] ?? 0) + 1
        withLine[t] = (withLine[t] ?? 0) + 1
      }
    }
  }
  console.log(`# ${repo}: ${files.length} files`)
  console.log(`# symbols: ${symTotal}, without a range: ${symNoRange}`)
  console.log("# relationships by label (total / with a line / with no line or 0):")
  for (const t of Object.keys(total).sort()) {
    console.log(`   ${t.padEnd(13)} ${String(total[t]).padStart(7)} / ${String(withLine[t] ?? 0).padStart(7)} / ${String(zeroLine[t] ?? 0).padStart(6)}`)
  }
  console.log("# the no-line rows, by shape:")
  for (const [k, v] of Object.entries(zeroKinds).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(7)}  ${k}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
