// FS036 — the top-level declarations of a file, and how many there are.
//
// `collectFileScope` answers a question the ANSWER TO WHICH IS THE COUNT: a file with one
// top-level module has that module as its scope everywhere, and a file with several is a
// script where the walk's own scope is the only correct answer. project.fsx disagrees with
// the truth on 5 `open` rows and the count this probe prints is what settles whether the
// rule or the walk is wrong.
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
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse(fs.readFileSync(file, "utf8"))
const found: Array<{ type: string; line: number; text: string; depth: number }> = []
function walk(n: any, d: number) {
  if (["module_defn", "named_module", "namespace", "namespace_defn"].includes(n.type)) {
    found.push({ type: n.type, line: n.startPosition.row + 1, text: n.text.split("\n")[0]!.slice(0, 40), depth: d })
  }
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
}
walk(tree.rootNode, 0)
console.log(`${file}\ntop-level-ish declarations found: ${found.length}`)
for (const f of found) console.log(`  depth=${String(f.depth).padStart(2)} L${String(f.line).padStart(5)} ${f.type.padEnd(16)} ${JSON.stringify(f.text)}`)
