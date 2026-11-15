import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
for (const c of root.namedChildren ?? []) {
  if (!/define|record|type/.test(c.type)) continue
  const line = c.text.split("\n")[0].slice(0, 50)
  console.log(`${c.type}  ${JSON.stringify(line)}`)
  for (const k of c.namedChildren ?? []) console.log(`    ${k.type}  ${JSON.stringify(k.text.slice(0, 34))}`)
}
