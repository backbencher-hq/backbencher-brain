// Characterise the node-level difference between two objc wasm builds.
// Usage: bun script/m14/tmp/oc-wasm-ab-detail.ts <wasmA> <wasmB> <file...>
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const [wasmA, wasmB, ...files] = process.argv.slice(2)
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const langs: any[] = []
for (const w of [wasmA, wasmB]) langs.push(await L.load(fs.readFileSync(path.isAbsolute(w) ? w : path.join(ROOT, w))))

function flat(lang: any, src: string): string[] {
  const p = new P()
  p.setLanguage(lang)
  const tree: any = p.parse(src)
  const out: string[] = []
  const cursor = tree.rootNode.walk()
  let done = false
  while (!done) {
    const n = cursor.currentNode
    out.push(
      `${n.type}${n.isMissing ? "|MISSING" : ""}${n.isNamed ? "|n" : ""} ` +
        `[${n.startPosition.row},${n.startPosition.column}..${n.endPosition.row},${n.endPosition.column}]` +
        (n.childCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 24))}` : ""),
    )
    if (cursor.gotoFirstChild()) continue
    for (;;) {
      if (cursor.gotoNextSibling()) break
      if (!cursor.gotoParent()) {
        done = true
        break
      }
    }
  }
  return out
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const a = flat(langs[0], src)
  const b = flat(langs[1], src)
  console.log(`\n=== ${f}   A=${a.length} nodes  B=${b.length} nodes ===`)
  let shown = 0
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 8; i++) {
    if (a[i] !== b[i]) {
      console.log(`  #${i}\n    A: ${a[i] ?? "(absent)"}\n    B: ${b[i] ?? "(absent)"}`)
      shown++
    }
  }
  if (shown === 0) console.log("  (node streams identical)")
}
process.exit(0)
