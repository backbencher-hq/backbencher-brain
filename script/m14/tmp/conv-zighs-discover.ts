import * as fs from "fs"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
import { RealHaskellAnalyzer } from "../../../src/ast/real-haskell-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  // zig
  {
    const lang = await L.load(fs.readFileSync("wasm/tree-sitter-zig.wasm"))
    const parser = new P(); parser.setLanguage(lang)
    const az = new RealZigAnalyzer()
    const src = [
      "const W = struct {",
      "    x: i32,",
      "    fn get(self: W) i32 {",
      "        return self.x;",
      "    }",
      "};",
      "fn go2() void {",
      "    log(\"save\");",
      "}",
    ].join("\n") + "\n"
    const t = parser.parse(src)
    const r: any = az.analyze(t.rootNode, src, "probe.zig")
    process.stdout.write("=== zig (parseError=" + (t.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((r.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(r.metadata?.detectedFrameworks) + "\n")
  }
  // haskell
  {
    const lang = await L.load(fs.readFileSync("wasm/tree-sitter-haskell.wasm"))
    const parser = new P(); parser.setLanguage(lang)
    const az = new RealHaskellAnalyzer()
    const src = [
      "module M (target) where",
      "",
      "target :: Int",
      "target = 42",
      "",
      "go :: IO ()",
      "go = log \"save\"",
    ].join("\n") + "\n"
    const t = parser.parse(src)
    const r: any = az.analyze(t.rootNode, src, "probe.hs")
    process.stdout.write("=== haskell (parseError=" + (t.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((r.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(r.metadata?.detectedFrameworks) + "\n")
    process.stdout.write("exports: " + JSON.stringify((r.exports ?? []).map((e: any) => e.name)) + "\n")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
