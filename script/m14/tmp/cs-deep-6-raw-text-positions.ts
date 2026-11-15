// CS-DEEP-6 — the other two positions that publish RAW type text as a name.
//
// The deep census convicted the `using`-alias module (cs-deep-2/probe-2 A2/A3) and
// the census then found a second instance of the same shape (`UpdateExpressionState<…>`).
// Reading for the CLASS rather than the instance: which positions in
// real-csharp-analyzer.ts turn a TYPE EXPRESSION into a name, and which of them strip
// the generic arguments the way `csharpCleanTypeLeaf` does everywhere else?
//
//   1. using module            csharpUsingDirectiveTarget -> csharpTypeNameText(csharpTypeSpelling(TEXT))
//   2. attribute/decorator     extractAttributes          -> csharpTypeSpelling(TEXT)
//   3. conversion operator NAME the operator branch      -> csharpTypeNameText(csharpTypeSpelling(TEXT))
//
// versus the positions that already go through `cleanTypeName` (heritage, creation,
// target-typed new) and the declared-type graph (which walks the tree and publishes
// the base AND each argument as separate leaves).
//
// C# allows a generic in all three positions, so the question is measurable, not
// hypothetical: `[Marker<int>]`, `implicit operator Box<List<int>>` and
// `using M = List<int>;` are all legal.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  { name: "P1-attribute-generic", src: `[Marker<int>] public class C { }` },
  { name: "P2-attribute-qualified-generic", src: `[global::Marker<string, int>] public class C { }` },
  { name: "P3-attribute-plain (control)", src: `[Marker] public class C { }` },
  { name: "P4-attribute-qualified-plain (control)", src: `[System.Marker] public class C { }` },
  { name: "P5-conversion-operator-generic-target", src: `public class B { } public class P { public static implicit operator B(List<int> x) => new B(); }` },
  { name: "P6-conversion-operator-plain-target (control)", src: `public class B { } public class P { public static implicit operator B(int x) => new B(); }` },
  { name: "P7-using-alias-generic", src: `using M = List<int>; public class C { }` },
  { name: "P8-using-alias-nested-generic", src: `using M = Dictionary<string, List<int>>; public class C { }` },
  { name: "P9-using-alias-plain (control)", src: `using M = System.Text; public class C { }` },
  { name: "P10-using-alias-array-target", src: `using M = System.Int32[]; public class C { }` },
  { name: "P11-declared-type-graph-generic (the position that DOES split)", src: `public class C { System.Collections.Generic.Dictionary<string, int> _m; }` },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  for (const c of CASES) {
    const file = path.join(ROOT, "script", "m14", "tmp", `csdeep6-${c.name.split("-")[0]}.cs`)
    fs.writeFileSync(file, c.src + "\n")
    const tree = parser.parse(c.src + "\n")
    const res: any = await ASTEngine.parseFile(file, c.src + "\n")
    console.log(`\n=== ${c.name}   ${c.src}`)
    console.log(`   parse errors: ${tree.rootNode.hasError ? "YES" : "none"}`)
    for (const s of res.symbols ?? []) {
      const dec = s.decorators && s.decorators.length ? ` decorators=${JSON.stringify(s.decorators)}` : ""
      console.log(`   symbol  ${s.kind.padEnd(11)} name=${JSON.stringify(s.name)}${dec}`)
    }
    for (const im of res.imports ?? []) console.log(`   import  module=${JSON.stringify(im.module)}`)
    for (const r of res.relationships ?? []) {
      const t = r.type ?? r.relationshipType
      if (t === "references" || t === "contains") {
        console.log(`   edge    ${r.source} -[${t}]-> ${JSON.stringify(r.target)}  md=${JSON.stringify(r.metadata)}`)
      }
    }
  }
}

if (import.meta.main) await main()
