// One-off structural probe: the children of every pp_define / module_attribute
// near the top of a file, so a node-type assumption can be read off the grammar
// instead of guessed at.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const file = process.argv[2]
const maxRow = Number(process.argv[3] ?? 50)

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const tree = parser.parse(fs.readFileSync(file, "utf8"))
  const show = (n: any, d: number) => {
    const pad = "  ".repeat(d)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c.isNamed) {
        console.log(`${pad}${c.type}@${c.startPosition.row + 1} named=${c.namedChildCount} "${c.text.slice(0, 26).replace(/\n/g, "\\n")}"`)
        if (c.namedChildCount <= 4) show(c, d + 1)
      } else {
        console.log(`${pad}(anon ${c.type})`)
      }
    }
  }
  for (let i = 0; i < tree!.rootNode.namedChildCount; i++) {
    const n = tree!.rootNode.namedChild(i)
    if (n.startPosition.row + 1 > maxRow) break
    if (process.env.ALL_FORMS === "1") {
      console.log(`-- ${n.type}@${n.startPosition.row + 1} "${n.text.slice(0, 40).replace(/\n/g, " ")}"`)
      continue
    }
    if (n.type === "pp_define" || n.type === "module_attribute") {
      console.log(`== ${n.type}@${n.startPosition.row + 1}`)
      show(n, 1)
    }
  }
}
main()
