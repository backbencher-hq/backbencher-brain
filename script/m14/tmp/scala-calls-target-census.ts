// `calls` targets that are EXPRESSIONS rather than names.
//
// The analyzer documents this defect class for `throw` (SCD4: "the raw node.text
// embedded the whole construction with its arguments ... became a single
// unmatchable References target — garbage in the graph") and fixed it there.
// The `calls` path has the same shape and was not fixed: a CURRIED construction
// `new LensRef[F, A, B](ref)(get, set)` parses as call_expression whose function
// is the instance_expression, so the callee text is the whole construction.
//
// A name cannot contain a space or a parenthesis, so that test is exact rather
// than a judgement call.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { deriveScalaEdges } from "../differential"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
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
  const bad = (t: string): boolean => /[ ()]/.test(String(t))
  let aTotal = 0, aBad = 0, tTotal = 0, tBad = 0, both = 0, aOnly = 0
  const ex: string[] = []
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const root = parser.parse(src).rootNode
    const res: any = analyzer.analyze(root, src, fp)
    const aRows = (res.relationships ?? []).filter((r: any) => r.type === "calls")
    const tRows = deriveScalaEdges(root).filter((e: any) => e.label === "calls")
    aTotal += aRows.length; tTotal += tRows.length
    const tBadSet = new Set(tRows.filter((e: any) => bad(e.target)).map((e: any) => e.target))
    const aBadSet = new Set<string>()
    for (const r of aRows) { if (bad(r.target)) { aBadSet.add(String(r.target)) } }
    aBad += aRows.filter((r: any) => bad(r.target)).length
    tBad += tRows.filter((e: any) => bad(e.target)).length
    for (const t of aBadSet) { if (tBadSet.has(t)) both++; else aOnly++ }
    if (ex.length < 10) for (const r of aRows) { if (bad(r.target) && ex.length < 10) ex.push(`  ${f}:${r.line_number}  ${r.source} -> ${JSON.stringify(r.target)}  (oracle has it: ${tBadSet.has(String(r.target))})`) }
  }
  console.log(`# ${repo}: ${files.length} files`)
  console.log(`# analyzer calls rows ${aTotal}, of which the TARGET IS AN EXPRESSION (contains a space or a paren): ${aBad}`)
  console.log(`# oracle   calls rows ${tTotal}, of which: ${tBad}`)
  console.log(`# distinct bad targets: analyzer ${aBadSetSize(aBad)} in both ${both}, analyzer-only ${aOnly}`)
  for (const e of ex) console.log(e)
}
function aBadSetSize(n: number): number { return n }
main().catch((e) => { console.error(e); process.exit(1) })
