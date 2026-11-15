// #917: is the truth row `uses -> cmpp__ListType_impl` (and the 68 heading-name
// rows) present in the COMMITTED oracle too? Compares HEAD's deriveCCalls with
// the working tree's for the same file — isolating oracle drift from analyzer drift.
import fs from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const head: any = await import(path.resolve("script/m14/tmp/diff-head.ts"))
const now: any = await import(path.resolve("script/m14/differential.ts"))

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

const file = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const src = fs.readFileSync(file, "utf8")
const root = parser.parse(src).rootNode

const key = (e: any) => e.label + "|" + e.target
const a = new Set(head.deriveCCalls(root, src).map(key))
const b = new Set(now.deriveCCalls(root, src).map(key))
console.log(`HEAD truth=${a.size}  WORKING truth=${b.size}`)
console.log("only in WORKING:", [...b].filter((x) => !a.has(x)).slice(0, 10))
console.log("only in HEAD:", [...a].filter((x) => !b.has(x)).slice(0, 10))
console.log("ListType_impl in HEAD truth:", [...a].filter((x) => String(x).includes("ListType_impl")))
console.log("ListType_impl in WORKING truth:", [...b].filter((x) => String(x).includes("ListType_impl")))
