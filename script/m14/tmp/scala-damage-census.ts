// Are all 513 damaged scala3 files REPORTED as damaged?
//
// The full-corpus run reported 513 files whose tree carries `hasError`, and a first
// pass concluded all 513 were "reported with NO diagnostic" — which would undo
// SDJ-7. That conclusion was the INSTRUMENT's fault: it looked for
// `res.diagnostics` and `res.parseErrors`, while the analyzer surfaces the
// file-level report on `metadata.errors` (real-scala-analyzer.ts:226). This measures
// the real question: for every damaged file, does the analyzer publish at least one
// error, and does it name a node when one exists?
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = process.argv[2] ?? "scala3"
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const ROOTDIR = "/home/ishaq2321/bb_tests/repositories"
  const files = walk(path.join(ROOTDIR, CORPUS))
  let clean = 0, damaged = 0, reported = 0, silent = 0, named = 0, fileLevelOnly = 0
  const silentEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    const isDamaged = !!root.hasError
    if (!isDamaged) { clean++; continue }
    damaged++
    let res: any
    try { res = analyzer.analyze(root, src, f) } catch { silent++; continue }
    const errs = res?.metadata?.errors ?? []
    if (errs.length) {
      reported++
      // does it name a real node, or is it the file-level fallback?
      if (errs.some((e: any) => e?.range && (e.range.startIndex > 0 || e.range.endIndex > 0))) named++
      else fileLevelOnly++
    } else { silent++; if (silentEx.length < 8) silentEx.push(path.relative(path.join("/home/ishaq2321/bb_tests/repositories", CORPUS), f)) }
  }
  console.log(`# scala damaged-file reporting — ${CORPUS}\n`)
  console.log(`- files: ${files.length}   clean: ${clean}   damaged: ${damaged}`)
  console.log(`- damaged files REPORTED (metadata.errors non-empty): ${reported} (${((reported / Math.max(1, damaged)) * 100).toFixed(1)}%)`)
  console.log(`  - naming a specific node: ${named}`)
  console.log(`  - file-level only (SDJ-7's hasError-without-ERROR case): ${fileLevelOnly}`)
  console.log(`- **damaged files reported SILENT: ${silent}**`)
  if (silentEx.length) { console.log(`  examples:`); for (const e of silentEx) console.log(`    ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
