import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const f = process.argv[2], line = Number(process.argv[3])
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const p = new P(); p.setLanguage(g)
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  const dump = (n: any, d: number) => {
    if (d > 7) return
    const mark = n.startPosition.row + 1 === line ? " <<<" : ""
    console.log(`${"  ".repeat(d)}${n.type} [${n.startPosition.row + 1}] ${JSON.stringify(n.text.slice(0, 44))}${mark}`)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, d + 1) }
  }
  // find the smallest node starting on the target line
  const stack: any[] = [root]
  while (stack.length) { const n = stack.pop(); if (n.startPosition.row + 1 === line && n.childCount > 0) { dump(n, 0); return } for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) } }
}
main().catch((e) => { console.error(e); process.exit(1) })
