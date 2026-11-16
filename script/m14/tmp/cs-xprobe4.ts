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
    R1_bare_reads: `class Widget {
    static int Max = 100;
    int count;
    int Get() { return Max + count; }
}
`,
    R2_shadowing: `class Widget {
    static int Max = 100;
    int Get(int Max) { return Max; }
}
`,
    R3_patterns: `class Widget {
    static int Limit = 5;
    bool Check(object o) {
        if (o is Point p) { return true; }
        switch (o) {
            case Point q when q.X > 0: return true;
            default: return false;
        }
    }
}
`,
    R4_out_decon: `class Widget {
    static int Def = 7;
    void M() {
        int v;
        Helper(out v, out int w);
        (int a, int b) = (1, 2);
        (v, w) = (a, b);
        _ = v + w + a + b;
    }
}
`,
    R5_query_lambda: `using System.Linq;
class Widget {
    static int K = 1;
    void M() {
        var q = from x in src select x;
        Func<int,int> f = (p) => p + K;
        var h = (int z) => z;
    }
}
`,
    R6_designators: `class Widget {
    static int G = 1;
    void M(P p) {
        var q = p with { X = 1 };
        var a = new { Y = 2, Z = G };
        var s = nameof(G);
        var t = typeof(Widget);
    }
}
`,
    R7_setter_value: `class Widget {
    int value;
    int _v;
    int P { get { return value; } set { _v = value; } }
}
`,
    R8_inherit_nested: `class Base {
    protected static int Shared = 1;
}
class Derived : Base {
    int M() { return Shared; }
    class Inner {
        int N() { return Shared; }
    }
}
`,
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}`)
  }
}
main()
