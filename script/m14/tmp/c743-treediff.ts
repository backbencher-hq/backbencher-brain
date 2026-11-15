// #743: what exactly changed in a clean file's tree? Print the first region where
// the pinned and candidate s-expressions diverge, with the source lines.
//   bun script/m14/tmp/c743-treediff.ts <pinned.wasm> <cand.wasm> <file> [window]
import fs from "node:fs"
const [pinnedPath, candPath, file, winArg] = process.argv.slice(2)
const WIN = parseInt(winArg ?? "2000")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const p1 = new P(); p1.setLanguage(await L.load(fs.readFileSync(pinnedPath)))
const p2 = new P(); p2.setLanguage(await L.load(fs.readFileSync(candPath)))
const src = fs.readFileSync(file, "utf8")
const a = p1.parse(src).rootNode
const b = p2.parse(src).rootNode
const sa = a.toString(), sb = b.toString()
console.log(`file=${file}  len(pinned)=${sa.length} len(cand)=${sb.length}`)
let i = 0
while (i < Math.min(sa.length, sb.length) && sa[i] === sb[i]) i++
console.log(`\nfirst divergence at char ${i}`)
console.log(`PINNED …${sa.slice(Math.max(0, i - WIN), i + WIN)}…`)
console.log(`\nCAND   …${sb.slice(Math.max(0, i - WIN), i + WIN)}…`)
// locate the node covering the first differing source position
const line = src.slice(0, Math.min(src.length, i)).split("\n").length
const lines = src.split("\n")
console.log(`\n--- source around the divergence (approx line ${line}) ---`)
for (let n = Math.max(1, line - 6); n <= Math.min(lines.length, line + 8); n++) {
  console.log(`${String(n).padStart(5)}| ${lines[n - 1]}`)
}
