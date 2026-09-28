// tmp-elx-adv-shapes.ts — tree shapes for the adversarial review (imports,
// derives, quoted attributes, as-aliases, defdelegate, __MODULE__ calls).
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
    if (d >= 7) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
  }
  walk(tree.rootNode, 0)
}
dump("import only (module)", `import Mix.Dep, only: [format_dep: 1]`)
dump("import only (def)", `def run(xs) do\n  import Enum, only: [map: 2]\n  map(xs, &f/1)\nend`)
dump("derive list", `@derive [Derivable]`)
dump("derive tuple", `@derive {Inspect, only: [:a]}`)
dump("quoted attr", `defmacro m do\n  quote do\n    @behaviour B\n    @type t :: integer()\n  end\nend`)
dump("as alias struct", `alias MyApp.Thing, as: T\n%T{v: 1}`)
dump("defdelegate", `defdelegate fetch(id), to: Repo`)
dump("self call", `__MODULE__.helper()`)
dump("sigil S interp", `x = ~S"#{g()}"`)
dump("sigil s interp", `x = ~s"#{g()}"`)
process.exit(0)
