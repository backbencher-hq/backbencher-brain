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
const CASES: Record<string, string> = {
  C1_top_level_calls: `System.Console.WriteLine("hi");
int x = 40 + 2;
`,
  C2_generic_call: `class A {
    void M() {
        var y = Helper.Gen<int>(1);
    }
}
`,
  C3_nullcond_call: `class A {
    void M() {
        var y = helper?.Get(1);
    }
}
`,
  C4_complexity_shapes: `class A {
    int M(int? v, bool b) {
        try {
            if (b) return 1;
        } catch {
            return 2;
        }
        return v ?? 3;
    }
}
`,
  C5_explicit_iface: `interface IFoo { void M(); }
class A : IFoo {
    void IFoo.M() { }
}
`,
}
async function main() {
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const rels = (r.relationships ?? []).map((x: any) => `${x.type}[${x.source}->${x.target}]`)
    const syms = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)
    console.log(`=== ${name} err=${root.hasError}\n  syms: ${JSON.stringify(syms)}\n  rels: ${JSON.stringify(rels)}\n  cx: ${JSON.stringify(r.metadata?.cyclomaticComplexity)}`)
  }
}
main()
