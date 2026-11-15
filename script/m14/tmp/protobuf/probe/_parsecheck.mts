import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")))
const p = new P(); p.setLanguage(lang)
for (const f of process.argv.slice(2)) {
  const t = p.parse(readFileSync(f, "utf8"))
  let err = 0, miss = 0
  const st: any[] = [t.rootNode]
  while (st.length) { const n = st.pop(); if (n.type === "ERROR") err++; if (n.isMissing) miss++; for (let i=0;i<n.childCount;i++) st.push(n.child(i)) }
  console.log(`${f}: ERROR=${err} MISSING=${miss} hasError=${t.rootNode.hasError}`)
}
