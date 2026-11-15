// ER3 — is the quartile curve a super-linear TERM, or a tail of big files that
// both analyzers pay? The same files, the same trees, both analyzers, plus node
// count and max depth, so the per-node cost can be compared like for like.
import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const D = "/home/sano/ishaq/bb_tests/er3-perf"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const old: any = await import(path.join(D, "old-erlang-analyzer.ts"))
  const variants: [string, any][] = [
    ["ER3", new RealErlangAnalyzer()],
    ["pre-ER3", new old.RealErlangAnalyzer()],
  ]
  const warm = "f() -> ok.\n"
  for (const [, a] of variants) a.analyze(parser.parse(warm)!.rootNode, warm, "w.erl")
  const files = process.argv.slice(2)
  console.log("| file | lines | nodes | depth | ER3 ms | ER3 us/node | pre-ER3 ms | pre-ER3 us/node | ratio |")
  console.log("|---|---|---|---|---|---|---|---|---|")
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)!
    let nodes = 0
    let depth = 0
    const dfs = (n: any, d: number) => { nodes++; if (d > depth) depth = d; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dfs(c, d + 1) } }
    dfs(tree.rootNode, 0)
    const out: number[] = []
    for (const [, a] of variants) {
      let best = Number.POSITIVE_INFINITY
      for (let r = 0; r < 2; r++) { const t0 = Date.now(); a.analyze(tree.rootNode, content, f); best = Math.min(best, Date.now() - t0) }
      out.push(best)
    }
    const lines = content.split("\n").length
    console.log(`| ${path.basename(f)} | ${lines} | ${nodes} | ${depth} | ${out[0]} | ${((out[0] * 1000) / nodes).toFixed(1)} | ${out[1]} | ${((out[1] * 1000) / nodes).toFixed(1)} | ${(out[0] / Math.max(1, out[1])).toFixed(2)}x |`)
    tree.delete()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
