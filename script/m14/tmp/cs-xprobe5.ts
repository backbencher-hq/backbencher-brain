import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const cases: Record<string, string> = {
    S1_member_decls: `class Widget {
    static int Max = 100;
    int count;
    static int Multi1 = 1, Multi2 = Max;
    int Get() { return Max + count + Multi1 + Multi2; }
}
`,
    S2_decon_bind: `class Widget {
    static int a = 1;
    static int b = 2;
    void M() {
        (int a, int b) = (3, 4);
        _ = a + b;
    }
    void N() {
        int c = 0, d = 0;
        (c, d) = (a, b);
        _ = c + d;
    }
}
`,
    S3_outvar: `class Widget {
    static int Sharp = 1;
    void M(string s) {
        if (int.TryParse(s, out int v)) { _ = v; }
        int w;
        if (int.TryParse(s, out w)) { _ = w; }
        _ = Sharp;
    }
}
`,
    S4_topattr: `using System;
[MyAttr(Size = 3, Other)]
class Widget {
    static int Size = 10;
    static int Other = 20;
    static int Plain = 30;
    void M() {
        int[] arr = new int[Plain];
    }
}
`,
    S5_preproc: `class Widget {
    static int Prod = 1;
#if DEBUG
    void M() { int x = Prod; }
#endif
    void N() {
#if TRACE
        int y = Prod;
#endif
    }
}
`,
    S6_toplevel_reads: `int top = 41;
System.Console.WriteLine(top + 1);
`,
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}\n  calls: ${JSON.stringify(calls)}`)
  }
}
main()
