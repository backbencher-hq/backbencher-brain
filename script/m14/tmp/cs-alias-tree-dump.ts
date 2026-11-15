// What node types do the two positions actually hand the analyzer?
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const SNIPPET = [
  "namespace Probe;",
  "public class Qualified {",
  "  public object A() => new System.Text.StringBuilder();",
  "  public object B() => new global::System.Text.StringBuilder();",
  "}",
  "public class BasePlain : System.Collections.ArrayList { }",
  "public class BaseAlias : global::System.Collections.ArrayList { }",
].join("\n")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const p = new P()
  p.setLanguage(g)
  const tree = p.parse(SNIPPET)
  const walk = (n: any, depth = 0) => {
    const interesting = /object_creation|base_list|alias_qualified|qualified_name|identifier|generic_name|::|\.$/.test(n.type) || !n.isNamed
      ? true : false
    if (/object_creation_expression|base_list|alias_qualified_name|qualified_name/.test(n.type)) {
      console.log(`${"  ".repeat(depth)}${n.type}  text=${JSON.stringify(n.text)}  named=${n.isNamed}`)
    }
    for (const c of n.namedChildren) walk(c, depth + 1)
    void interesting
  }
  walk(tree.rootNode)
  console.log("\n--- raw S-expressions ---")
  const sexp = tree.rootNode.toString()
  for (const m of sexp.matchAll(/\((object_creation_expression|base_list)[^()]*(\([^()]*\)[^()]*)*/g)) console.log("  " + m[0].slice(0, 220))
}
main()
