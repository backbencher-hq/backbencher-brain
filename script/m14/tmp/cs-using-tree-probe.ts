// script/m14/tmp/cs-using-tree-probe.ts — the exact tree for every using shape,
// so the replacement for the alias regex (real-csharp-analyzer.ts:437) reads the
// ALIAS from the grammar field and the TARGET from the child that follows the `=`.
// Needed because `using Alias = Plain;` currently publishes module `Alias` — the
// alias as the module, with the real target named nowhere — and because a plain
// single-identifier using must NOT be mistaken for an alias form.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm/tree-sitter-c_sharp.wasm")))
  const p = new P()
  p.setLanguage(LANG)

  const SRC = [
    "using System.Text;",
    "using Json;",
    "using Alias = Plain;",
    "using A = B.C;",
    "using static System.Math;",
    "global using System.Text;",
    "global using G = System.Text;",
    "using X = global::System.Text;",
  ]
  for (const src of SRC) {
    const root = p.parse(src).rootNode
    console.log(`\n=== ${src}`)
    const walk = (n: any, dp: number) => {
      const fields: string[] = []
      const parent = n.parent
      if (parent?.childForFieldName) {
        for (const f of ["name", "type", "operator", "alias"]) {
          try { if (parent.childForFieldName(f)?.id === n.id) fields.push(f) } catch { /* n/a */ }
        }
      }
      console.log("  ".repeat(dp) + `${n.type}${fields.length ? " [field=" + fields.join(",") + "]" : ""}${n.isNamed ? "" : " (anon)"} :: ${JSON.stringify(String(n.text ?? "").slice(0, 34))}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), dp + 1)
    }
    walk(root, 0)
  }
}

main()
