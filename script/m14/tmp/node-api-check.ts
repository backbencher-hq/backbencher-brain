import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse("/** doc */\nobject A { def f = 1 }\n").rootNode
const obj = root.namedChild(0)
console.log("node proto methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(obj)).filter(n => /sibling|child|parent|prev|next/i.test(n)).join(", "))
console.log("has .id?", typeof obj.id, "value:", obj.id)
console.log("parent identity stable?", root.namedChild(0).parent === root.namedChild(0).parent)
console.log("child identity stable?", root.namedChild(0) === root.namedChild(0))
