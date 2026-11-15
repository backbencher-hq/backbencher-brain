// FS030 — what does an object expression's interface name actually LOOK like in the tree?
//
// The differential reports `implements` rows whose target is the FIRST segment of a
// qualified interface name: `{ new System.Collections.Generic.IEqualityComparer<T> with … }`
// publishes `System`, and `{ new FSharp.Compiler.Interactive.IEventLoop with … }` published
// `FSharp` while the truth side read `Compiler` — two implementations, both wrong, agreeing
// that a dotted name has a name.
//
// The analyzer takes the first `long_identifier` descendant. In this grammar a dotted name is
// NESTED long_identifiers, so "first descendant" is the outermost one and the whole written
// name is the chain. This probe prints the subtree so the fix is built on the tree rather
// than on a theory about it — the same lesson as fs029, and the reason the leaf rule was
// implemented three times in this file before it was implemented once against a reading.
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
const file = process.argv[2]!
const line = Number(process.argv[3] ?? 1)
const depth = Number(process.argv[4] ?? 7)
// A TEXT anchor, because a line number is a poor way to find a node: the row a
// declaration is PUBLISHED on is the analyzer's choice, and here it disagreed with
// the row the node starts on. `text` finds the node itself.
const anchor = process.argv[5] ?? null
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse(src)

// A NODE-SPAN filter, not a node filter: the first draft returned early when the
// node was not on the target line, which meant it never descended from the root and
// printed nothing at all — an empty result that reads exactly like "no such node".
// The line test belongs on what is PRINTED, never on whether to recurse.
function show(n: any, d: number) {
  if (d > depth) return
  const onLine = n.startPosition.row + 1 === line || n.endPosition.row + 1 === line
  // TIGHTEST match: the deepest node that still contains the anchor. Printing every
  // ancestor is useless — the root contains the anchor too, and the output was 20
  // levels of the file before reaching the node being asked about.
  const childHas = anchor
    ? Array.from({ length: n.childCount }, (_, i) => n.child(i)).some((c: any) => c.text.includes(anchor))
    : false
  const hasAnchor = anchor ? n.text.includes(anchor) && !childHas : false
  if (onLine || hasAnchor) {
    console.log(`${"  ".repeat(d)}${n.type}  ${JSON.stringify(n.text.slice(0, 70))}`)
  }
  for (let i = 0; i < n.childCount; i++) show(n.child(i), d + 1)
}
show(tree.rootNode, 0)
