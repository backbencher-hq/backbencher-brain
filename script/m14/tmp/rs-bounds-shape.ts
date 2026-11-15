import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts, L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const p = new P(); p.setLanguage(g)
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  const want = Number(process.argv[3])
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "trait_bounds" && n.startPosition.row + 1 === want) {
      const dump = (x: any, d: number) => { console.log(`${"  ".repeat(d)}${x.type}${x.isNamed ? "" : " (anon)"} [${x.startPosition.row + 1}] ${JSON.stringify(x.text.slice(0, 50))}`); for (let i = 0; i < x.namedChildCount; i++) dump(x.namedChild(i), d + 1) }
      dump(n, 0); return
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
