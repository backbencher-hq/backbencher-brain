import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  for (const [name, src] of Object.entries({
    fileclass: `file class Hidden { void M() { } }\npublic class Shown { }\n`,
    usingstatic: `using static System.Math;\nclass A { double M() { return Sqrt(4); } }\n`,
  })) {
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    console.log(`=== ${name} err=${root.hasError}`);
    console.log("  syms:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}:${s.visibility}`)));
    console.log("  exports:", JSON.stringify((r.exports ?? []).map((e: any) => e.name)));
    console.log("  imports:", JSON.stringify((r.imports ?? []).map((i: any) => i.module)));
    console.log("  rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type) === "calls").map((x: any) => `${x.source}->${x.target}`)));
  }
}
main()
