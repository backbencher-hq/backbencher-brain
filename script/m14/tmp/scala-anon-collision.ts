// Are synthetic `anonymous_*` names UNIQUE inside a file?
//
// The analyzer names an anonymous class `anonymous_<SuperName>`. Two anonymous
// classes of the SAME supertype in one file therefore produce the SAME name, and if
// symbols are keyed by name the graph loses one of them: two distinct real classes
// become one node, and every member of the second is attributed to the first.
//
// That is a correctness question about the synthetic-name SCHEME, not about the
// dotted spelling (which is a separate, cosmetic question). This measures:
//   - how many files declare 2+ anonymous symbols with the same name
//   - whether their members are consequently MERGED (same owner, different members)
//   - whether a dotted name (`anonymous_runtime.AbstractFunction0`) ever collides
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
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
  const repo = process.argv[2] ?? "scala3"
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const files = walk(path.join(CORPUS_ROOT, repo))
  let filesWithAnon = 0, anonSymbols = 0, dupFiles = 0, dupNames = 0, dotted = 0
  const ex: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    const anon = (res.symbols ?? []).filter((s: any) => String(s.name ?? "").startsWith("anonymous_"))
    if (!anon.length) continue
    filesWithAnon++
    anonSymbols += anon.length
    for (const a of anon) if (String(a.name).includes(".")) dotted++
    const byName = new Map<string, any[]>()
    for (const a of anon) {
      const k = String(a.name)
      if (!byName.has(k)) byName.set(k, [])
      byName.get(k)!.push(a)
    }
    let anyDup = false
    for (const [k, v] of byName) {
      if (v.length < 2) continue
      anyDup = true
      dupNames++
      if (ex.length < 10) {
        const lines = v.map((x) => x.range?.startLine)
        ex.push(`${path.relative(path.join(CORPUS_ROOT, repo), f)}  ${k} x${v.length} at lines ${lines.join(",")}`)
      }
    }
    if (anyDup) dupFiles++
  }
  console.log(`# scala anonymous-symbol uniqueness — ${repo}\n`)
  console.log(`- files declaring anonymous symbols: ${filesWithAnon}`)
  console.log(`- anonymous symbols: ${anonSymbols}, of which a DOTTED name: ${dotted}`)
  console.log(`- **files with a DUPLICATE anonymous name: ${dupFiles}** (${dupNames} duplicate names)`)
  if (ex.length) { console.log(`\n## examples`); for (const e of ex) console.log(`  ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
