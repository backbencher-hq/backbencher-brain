import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const fp = process.argv[2]
const line = Number(process.argv[3])   // 1-indexed START line of the node
const depth = Number(process.argv[4] ?? 4)
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(fp, "utf8")
  const root = parser.parse(src).rootNode
  let best: any = null
  const w = (n: any): void => {
    if (n.startPosition.row + 1 === line) { if (!best || n.endPosition.row > best.endPosition.row) best = n }
    for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
  }
  w(root)
  if (!best) { console.log(`no node starts on line ${line}`); return }
  const print = (n: any, d: number): void => {
    if (d > depth) return
    const field = ""
    console.log(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${JSON.stringify(n.text.slice(0, 60))}`)
    for (let i = 0; i < n.childCount; i++) print(n.child(i), d + 1)
  }
  print(best, 0)
}
main().catch(e => { console.error(e); process.exit(1) })
