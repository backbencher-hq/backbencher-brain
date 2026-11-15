import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `module M

type Shape =
  | Circle of float
  | Square of float

type Person = { Name: string; Age: int }

type Counter() =
  let mutable n = 0
  member this.Value = n
  member this.Bump() = n <- n + 1
  static member Zero = Counter()

module Inner =
  let helper x = x

exception Bad of string
`
const root = p.parse(src).rootNode
const sub = (n: any, d: number, max = 4): void => {
  console.log("  ".repeat(d) + `${n.type}  ${JSON.stringify(n.text.slice(0, 44).replace(/\n/g, "\\n"))}`)
  if (d < max) for (const c of n.namedChildren ?? []) sub(c, d + 1, max)
}
sub(root, 0)
