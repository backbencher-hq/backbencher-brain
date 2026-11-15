import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm".replace("cpp", "zig")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  for (const f of ["/home/ishaq2321/bb_tests/repositories/zls/tests/analysis/result_location_type.zig", "/home/ishaq2321/bb_tests/repositories/zls/src/analyser/InternPool.zig"]) {
    const src = fs.readFileSync(f, "utf8")
    const root = await parse(f)
    const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
    console.log("=== " + path.basename(f));
    for (const e of (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses" && /^(bar|baz|f80)$/.test(x.target))) {
      // find identifier nodes with this target text and print chains near the source fn
      console.log(`  ${e.source}->${e.target}`);
    }
    // locate all bare identifier occurrences of bar/baz/f80 with chains
    const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
      if (pred(n)) out.push(n)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
      return out
    }
    for (const n of findAll(root, (x) => x.type === "identifier" && /^(bar|baz|f80)$/.test(x.text))) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log(`  @${n.startIndex} ${n.text} <- ${chain.slice(1, 5).join(" < ")}`);
    }
  }
}
main()
