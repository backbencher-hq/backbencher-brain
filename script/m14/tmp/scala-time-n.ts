import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const p = new P(); p.setLanguage(gl)
  const files = walk(path.join("/home/ishaq2321/bb_tests/repositories", process.argv[2] ?? "cats-effect")).slice(0, Number(process.argv[3] ?? 100))
  const a = new RealScalaAnalyzer()
  const t0 = Date.now(); let slowest = 0; let slowFile = ""
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const s = Date.now()
    try { a.analyze(p.parse(src).rootNode, src, f) } catch {}
    const d = Date.now() - s
    if (d > slowest) { slowest = d; slowFile = path.basename(f) }
  }
  console.log(`${files.length} files in ${Date.now() - t0}ms   slowest=${slowest}ms (${slowFile})`)
}
main()
