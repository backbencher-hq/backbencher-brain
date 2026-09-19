// tmp-node-shapes.ts — EX2: dump the exact grammar node shapes the fixes
// depend on (U6 default-arg operator, U7 sigil docs, U4 type-decl LHS).
// AST-first: the fix is written against THIS output, never against a guess.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const p = new ParserClass()
p.setLanguage(g)

function dump(label: string, src: string) {
  console.log(`\n### ${label}\nSRC: ${JSON.stringify(src)}`)
  const tree = p.parse(src)
  const walk = (n: any, d: number) => {
    const t = n.childCount === 0 ? ` ${JSON.stringify(n.text).slice(0, 50)}` : ""
    console.log(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}${t}`)
    if (d >= 6) return
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, d + 1)
    }
  }
  walk(tree.rootNode, 0)
}

dump("U6 default arg", `def f(x \\\\ g()), do: 1`)
dump("U7 sigil heredoc doc", `@doc ~S"""\nHi there\n"""\ndef f, do: 1`)
dump("U7 sigil inline doc", `@doc ~s(hello world)\ndef f, do: 1`)
dump("U4 parameterized type", `@type t(a) :: {:ok, a}`)
dump("U4 parameterized type rhs-id", `@typep pt(b) :: b`)
dump("U4 plain type", `@type plain :: integer()`)
process.exit(0)
