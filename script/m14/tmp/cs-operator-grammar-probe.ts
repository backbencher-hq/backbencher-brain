// script/m14/tmp/cs-operator-grammar-probe.ts — R1 adjudication for the csharp
// lane's three surviving regex sites. The plan's R1 row says the question is not
// "is a regex ugly" but "does the grammar have a node/field for this?", and that
// the honest test of the analyzer's `no AST path` claim is to PROBE it.
//
//   * real-csharp-analyzer.ts:857  /\boperator\s+(implicit|explicit)\s+([\w.<>]+)/
//   * real-csharp-analyzer.ts:858  /\boperator\s+(checked\s+)?([^\s(]+)/
//   * real-csharp-analyzer.ts:437  /using\s+([\w.]+)\s*=/   (the using-alias name)
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

  const dump = (n: any, dp: number) => {
    if (!n) return
    const parent = n.parent
    const fields: string[] = []
    if (parent?.childForFieldName) {
      for (const f of ["name", "type", "operator", "alias", "return_type", "parameters", "body", "left", "right", "modifier", "implicit", "explicit"]) {
        try { if (parent.childForFieldName(f)?.id === n.id) fields.push(f) } catch { /* not a field */ }
      }
    }
    console.log("  ".repeat(dp) + `${n.type}${n.isNamed ? "" : " (anon)"}${fields.length ? " [field=" + fields.join(",") + "]" : ""} :: ${JSON.stringify(String(n.text ?? "").slice(0, 40))}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), dp + 1)
  }

  const SRC = [
    "class C { public static implicit operator int(C c) => 0; }",
    "class C { public static explicit operator C(int v) => new C(); }",
    "class C { public static C operator +(C a, C b) => a; }",
    "class C { public static C operator checked +(C a, C b) => a; }",
    "class C { public static bool operator true(C c) => true; }",
    "class C { public static C<T> operator +(C<T> a, C<T> b) => a; }",
    "using Config = System.Text.Json.JsonSerializerOptions;",
    "using System.Text;",
  ]

  for (const src of SRC) {
    const root = p.parse(src).rootNode
    console.log(`\n=== ${src}`)
    // find the declaration node that carries the name/operator
    const stack = [root]
    let target: any = null
    while (stack.length) {
      const n = stack.pop()!
      if (/operator|using/.test(n.type) && n.isNamed) { target = n; break }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    if (!target) { console.log("  (no operator/using node found)"); continue }
    dump(target, 1)
    console.log(`  -> field "name": ${JSON.stringify(target.childForFieldName("name")?.text ?? null)}`)
    console.log(`  -> field "operator": ${JSON.stringify(target.childForFieldName("operator")?.text ?? null)}`)
    console.log(`  -> field "type": ${JSON.stringify(target.childForFieldName("type")?.text ?? null)}`)
  }
}

main()
