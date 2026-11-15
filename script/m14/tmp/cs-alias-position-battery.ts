// C2a probe battery: WHERE can a `global::`-qualified name reach a published target in csharp?
//
// The corpora contain the qualifier in only two positions (49 instantiates, 2 extends), so a
// corpus-only measurement cannot rule on the rest — a position the corpora never exercise is
// exactly the shape that hides. This writes one snippet per TYPE-NAME POSITION the C# language
// has, runs the lane's real analyzer, and prints every published relationship whose target
// still carries the qualifier, plus every symbol whose declared type does.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = `
using PlainAlias = System.Collections.ArrayList;
using QualifiedAlias = global::System.Collections.ArrayList;
using static System.Math;
using static global::System.Math;
using System;
using Alias = global::System.Collections.ArrayList;
using static global::System.Math;

namespace Probe
{
    public interface IThing { }

    [global::System.Serializable]
    public class Holder : global::System.Collections.ArrayList, global::Probe.IThing
        where T : global::System.IComparable
    {
        private global::System.Collections.ArrayList field;
        private global::System.Collections.Generic.List<global::System.String> gen;
        private global::System.String[] arr;
        private global::System.Int32? nul;

        public global::System.String Ret(global::System.Int32 p) { return null; }

        public void Body()
        {
            var a = new global::System.Text.StringBuilder();
            System.Text.StringBuilder plain = new();
            global::System.Text.StringBuilder b = new();
            var c = (global::System.Text.StringBuilder)a;
            var d = a is global::System.Text.StringBuilder;
            var e = typeof(global::System.Text.StringBuilder);
            Console.WriteLine(nameof(global::System.Text.StringBuilder));
            global::System.Console.WriteLine("noise");
            System.Console.WriteLine("noise2");
            try { } catch (global::System.Exception ex) { }
            switch (d) { case global::System.Boolean z: break; }
        }
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-positions.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  const lines = SNIPPET.split("\n")
  const withQualifier: string[] = []
  const all: string[] = []
  for (const r of res.relationships ?? []) {
    const t = String(r.target ?? "")
    const s = String(r.source ?? "")
    const row = `${String(r.type).padEnd(14)} ${s.padEnd(24)} -> ${t}   [src line ${(lines[(r.line_number ?? 1) - 1] ?? "").trim().slice(0, 60)}]`
    all.push(row)
    if (t.includes("::") || s.includes("::")) withQualifier.push(row)
  }
  console.log(`published relationships: ${all.length}`)
  console.log(`\n=== RELATIONSHIPS STILL CARRYING "::" (the class): ${withQualifier.length} ===`)
  for (const r of withQualifier) console.log("  " + r)
  console.log(`\n=== symbols whose name/type carries "::" ===`)
  for (const s of res.symbols ?? []) {
    const nm = String(s.name ?? ""), tp = String(s.returnType ?? s.metadata?.type ?? "")
    const params = JSON.stringify(s.metadata?.parameters ?? [])
    if (nm.includes("::") || tp.includes("::") || params.includes("::")) {
      console.log(`  kind=${s.kind} name=${nm} ret=${tp} params=${params}`)
    }
  }
  console.log(`\n=== declares-type refs (R9 metadata) carrying "::" ===`)
  const refs = (res.symbols ?? []).flatMap((s: any) => (s.metadata?.declaredTypeRefs ?? []).map((r: any) => `${s.name}: ${JSON.stringify(r)}`))
  const bad = refs.filter((r: string) => r.includes("::"))
  console.log(`  ${bad.length} of ${refs.length} declared-type refs:`)
  for (const b of bad) console.log("   " + b)
  console.log(`\n=== every published using-reference ===`)
  for (const r of (res.relationships ?? []).filter((x: any) => x.type === "references" && String(x.source ?? "").includes("using"))) {
    console.log(`  ${r.source} -> ${r.target}`)
  }
  console.log(`\n=== FULL relationship list (positions the snippet exercises) ===`)
  for (const r of all) console.log("  " + r)
  fs.rmSync(tmp)
}
main()
