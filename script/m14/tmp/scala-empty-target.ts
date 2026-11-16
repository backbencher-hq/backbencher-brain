// Does scala publish any relationship with an EMPTY target?
//
// The line-accuracy census surfaced one: `import <:<.*` in a semanticdb test — a
// wildcard import of a TYPE OPERATOR, where the only name written is the operator
// itself. Normalised, that target is empty, so the edge names nothing: it cannot be
// resolved, hovered, or followed. An edge with no endpoint is not a relationship, and
// it inflates the edge count.
//
// This counts them, by label, and names the source shapes that produce them.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { normTarget } from "../differential"
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
  const byLabel = new Map<string, number>()
  const ex: string[] = []
  let total = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    for (const r of res.relationships ?? []) {
      const t = String(r.target ?? "")
      if (t.trim() !== "" && normTarget(t) !== "") continue
      total++
      const l = String(r.type)
      byLabel.set(l, (byLabel.get(l) ?? 0) + 1)
      if (ex.length < 12) {
        const ln = r.line_number ?? 0
        const line = src.split("\n")[ln - 1] ?? ""
        ex.push(`${path.relative(path.join(CORPUS_ROOT, repo), f)}:${ln}  ${l}  target=${JSON.stringify(t)}   | ${line.trim().slice(0, 70)}`)
      }
    }
  }
  console.log(`# scala relationships with an EMPTY or unresolvable target — ${repo}\n`)
  console.log(`- **${total} edges name nothing**`)
  if (byLabel.size) { console.log(`\n## by label`); for (const [k, v] of [...byLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`) }
  if (ex.length) { console.log(`\n## examples`); for (const e of ex) console.log(`  ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
