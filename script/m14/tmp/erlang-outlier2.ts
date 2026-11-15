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
    ["ER3 (current)", new RealErlangAnalyzer()],
    ["  minus contains-pass", new (await import(path.join(D, "ablate-noown.ts"))).RealErlangAnalyzer()],
    ["  minus edge emission", new (await import(path.join(D, "ablate-nopush.ts"))).RealErlangAnalyzer()],
    ["  minus type-refs", new (await import(path.join(D, "ablate-notype.ts"))).RealErlangAnalyzer()],
    ["  minus pattern-climb", new (await import(path.join(D, "ablate-nopat.ts"))).RealErlangAnalyzer()],
    ["  minus param payload", new (await import(path.join(D, "ablate-noparam.ts"))).RealErlangAnalyzer()],
    ["  minus isMissing read", new (await import(path.join(D, "ablate-ismissing.ts"))).RealErlangAnalyzer()],
    ["  minus scope Set lookups", new (await import(path.join(D, "ablate-scopecheck.ts"))).RealErlangAnalyzer()],
    ["  minus exit markers", new (await import(path.join(D, "ablate-exitmark.ts"))).RealErlangAnalyzer()],
    ["pre-ER3", new old.RealErlangAnalyzer()],
  ]
  const warm = "f() -> ok.\n"
  for (const [, a] of variants) a.analyze(parser.parse(warm)!.rootNode, warm, "w.erl")
  for (const f of process.argv.slice(2)) {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)!
    let nodes = 0
    const dfs = (n: any) => { nodes++; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dfs(c) } }
    dfs(tree.rootNode)
    console.log(`\n${path.basename(f)} — ${nodes} nodes`)
    for (const [name, a] of variants) {
      let best = Number.POSITIVE_INFINITY
      for (let r = 0; r < 2; r++) { const t0 = Date.now(); a.analyze(tree.rootNode, content, f); best = Math.min(best, Date.now() - t0) }
      console.log(`  ${name.padEnd(22)} ${String(best).padStart(6)} ms  ${((best * 1000) / nodes).toFixed(1)} us/node`)
    }
    tree.delete()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
