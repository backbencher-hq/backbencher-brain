import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  for (const [f, ts] of [
    ["<corpus-root>/bb_tests/repositories/zls/src/analyser/InternPool.zig", ["f80"]],
    ["<corpus-root>/bb_tests/repositories/zls/tests/analysis/result_location_type.zig", ["bar", "baz"]],
  ] as const) {
    const src = fs.readFileSync(f, "utf8")
    const root = await parse(f)
    const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
    const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
      if (pred(n)) out.push(n)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
      return out
    }
    for (const t of ts) {
      for (const n of findAll(root, (x) => x.text === t && x.type === "identifier").slice(0, 4)) {
        const chain: string[] = []
        let p: any = n
        while (p) { chain.push(p.type); p = p.parent }
        console.log(t, "@" + n.startIndex, "<-", chain.slice(1, 7).join(" < "))
      }
    }
    console.log("--- syms:", JSON.stringify((r.symbols ?? []).filter((s: any) => ["f80", "bar", "baz"].includes(s.name)).map((s: any) => s.name + ":" + s.kind + (s.ownerName ? "(" + s.ownerName + ")" : ""))));
  }
}
main()
