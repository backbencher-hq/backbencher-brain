// How often does a scala file with `rootNode.hasError` publish NO diagnostic?
//
// The analyzer's error path is
//   if (rootNode.hasError) { walk for (type === "ERROR" || isMissing) and push }
// so a file the grammar flags as damaged but materialises as NEITHER an ERROR nor
// a MISSING node yields ZERO diagnostics and is reported clean. Measured over
// both corpora, because "the guard exists" is not the same claim as "the guard
// fires on every damaged file".

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
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

  let total = 0
  let hasErrorFiles = 0
  let reported = 0
  let silent = 0
  const silentEx: string[] = []
  let errorNodes = 0
  let missingNodes = 0

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    total++
    const root = parser.parse(src).rootNode
    let en = 0
    let mn = 0
    const w = (n: any): void => {
      if (n.type === "ERROR") en++
      if (n.isMissing || n.type === "MISSING") mn++
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
      if (n.type === "ERROR") for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) w(c) }
    }
    w(root)
    errorNodes += en
    missingNodes += mn
    if (!root.hasError) continue
    hasErrorFiles++
    const res: any = analyzer.analyze(root, src, fp)
    if ((res.errors ?? []).length > 0) reported++
    else {
      silent++
      if (silentEx.length < 8) silentEx.push(`    ${f}   (ERROR nodes ${en}, MISSING nodes ${mn})`)
    }
  }
  console.log(`# ${repo}: ${total} files`)
  console.log(`#   rootNode.hasError true ......... ${hasErrorFiles}`)
  console.log(`#   of those, a DIAGNOSTIC published ${reported}`)
  console.log(`#   of those, SILENT .............. ${silent}`)
  console.log(`# ERROR nodes ${errorNodes}, MISSING nodes ${missingNodes} across all files`)
  if (silentEx.length) {
    console.log("# the silent ones:")
    for (const e of silentEx) console.log(e)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
