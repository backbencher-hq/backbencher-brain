// FS029 — why does the truth oracle attribute a member-local annotation to the local?
// The FS024 differential reported `references|local|Leaf` on the MISSING side and
// `references|FromLocal|Leaf` on the UNEXPLAINED side: the two implementations agree
// that a `declared_type` row exists for a `let` inside a member's body and disagree on
// its SOURCE. One of them is wrong, and the point of this probe is to say which by
// printing the tree the oracle is reasoning about, not by reading either implementation.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const file = process.argv[2] ?? path.join(ROOT, "validation/m14/fixtures/fsharp/call-ownership.fs")
const line = Number(process.argv[3] ?? 67)
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse(src)

function walk(n: any, d = 0, out: string[] = []): string[] {
  if (n.startPosition.row + 1 === line) out.push(`${"  ".repeat(d)}${n.type}  ${JSON.stringify(n.text.slice(0, 60))}`)
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1, out)
  return out
}
console.log(`--- ancestors of the annotation on line ${line} ---`)
for (const row of walk(tree.rootNode)) console.log(row)
