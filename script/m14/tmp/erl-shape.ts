import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `-module(m).
-export([f/1, g/2]).
-record(r, {a = 1, b}).
-type(t() :: integer()).
-spec f(integer()) -> integer().
f(X) -> X + 1.
g(A, B) when A > B -> A;
   (A, B) -> B.
`
const root = p.parse(src).rootNode
const sub = (n: any, d: number): void => {
  console.log("  ".repeat(d) + `${n.type}  ${JSON.stringify(n.text.slice(0, 48))}`)
  if (d < 3) for (const c of n.namedChildren ?? []) sub(c, d + 1)
}
sub(root, 0)
