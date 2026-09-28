// tmp-ex3-shapes.ts — AST-first: node shapes for the EX3 batch fixes
// (captures, @derive list forms, literal-pattern parameters).
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
    const t = n.childCount === 0 ? ` ${JSON.stringify(n.text).slice(0, 40)}` : ""
    console.log(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}${t}`)
    if (d >= 6) return
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, d + 1)
    }
  }
  walk(tree.rootNode, 0)
}

dump("local capture", `def run, do: Enum.map([1], &double/1)`)
dump("remote capture", `def run, do: Enum.map([1], &Mod.double/1)`)
dump("derive list", `@derive [JSON.Encoder, String.Chars]`)
dump("derive list of tuples", `@derive [{Derivable, :ok}]`)
dump("literal param", `def multi(1), do: :one`)
process.exit(0)
