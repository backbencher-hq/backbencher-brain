// CS-DEEP-8 — root cause for the lost type ARGUMENTS in the declared-type graph.
//
// `csharpDeclaredTypeLeaves` walks a `generic_name` by taking `namedChild(0)` as the
// base and then looking for a `type_argument_list` among the named children. The
// published payload shows only the base, so one of those two steps is not matching on
// this grammar. This prints the ACTUAL TREE of a declared type so the walk is compared
// against the shape the grammar produces — not against the shape the code assumes.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string; pick: string }> = [
  { name: "field generic qualified base", src: `public class Holder { System.Collections.Generic.Dictionary<string, Widget> _m; } public class Widget { }`, pick: "variable_declaration" },
  { name: "field generic plain base", src: `public class Holder { Dictionary<string, Widget> _m; } public class Widget { }`, pick: "variable_declaration" },
  { name: "property generic", src: `public class Holder { public Dictionary<string, Widget> P { get; set; } } public class Widget { }`, pick: "property_declaration" },
  { name: "parameter generic", src: `public class C { public void M(Dictionary<string, Widget> d) { } } public class Widget { }`, pick: "parameter" },
  { name: "return generic", src: `public class C { public Dictionary<string, Widget> M() => null!; } public class Widget { }`, pick: "method_declaration" },
  { name: "local generic", src: `public class C { public void M() { Dictionary<string, Widget> d = null!; } } public class Widget { }`, pick: "local_declaration_statement" },
  { name: "attribute generic", src: `[Dictionary<string, Widget>] public class C { } public class Widget { }`, pick: "attribute" },
]

function dump(n: any, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth)
  out.push(`${pad}${n.type}${n.isNamed ? "" : " (anon)"}  fieldName=${n.isNamed ? "" : ""}  text=${JSON.stringify(String(n.text).slice(0, 70))}`)
  for (let i = 0; i < n.childCount; i++) dump(n.child(i), depth + 1, out)
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  for (const c of CASES) {
    const tree = parser.parse(c.src + "\n")
    console.log(`\n=== ${c.name}`)
    let target: any = null
    const find = (n: any): void => {
      if (target) return
      if (n.type === c.pick) { target = n; return }
      for (let i = 0; i < n.namedChildCount; i++) find(n.namedChild(i))
    }
    find(tree.rootNode)
    if (!target) { console.log("   (no node)"); continue }
    const out: string[] = []
    // only the head of the tree, enough to see the type holder
    const head = (n: any, d: number): void => {
      if (d > 3) return
      out.push(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}  typeField=${JSON.stringify(n.childForFieldName?.("type")?.type ?? null)}  text=${JSON.stringify(String(n.text).slice(0, 60))}`)
      for (let i = 0; i < n.childCount; i++) head(n.child(i), d + 1)
    }
    head(target, 0)
    for (const l of out) console.log("   " + l)

    const refs = mod.csharpDeclaredTypeRefs(tree.rootNode)
    console.log(`   csharpDeclaredTypeRefs -> ${JSON.stringify(refs.map((r: any) => `${r.relationshipType}:${r.declaredOn}:${r.target}`))}`)
  }
}

if (import.meta.main) await main()
