// Dump each ERROR / MISSING node in a groovy file: type, row range, and the
// source lines it covers. Used to locate the failing construct instead of
// guessing it. Usage: bun script/m14/tmp/g841-error-dump.ts <file> [maxNodes]
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const file = process.argv[2]
  const maxNodes = Number(process.argv[3] ?? 12)
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`hasError=${root.hasError} root=${root.type} children=${root.childCount} lines=${lines.length}`)
  let shown = 0
  const visit = (n: any) => {
    const bad = n.type === "ERROR" || n.isMissing === true
    if (bad) {
      if (shown < maxNodes) {
        const r0 = n.startPosition.row + 1
        const r1 = n.endPosition.row + 1
        const text = JSON.stringify((n.text || "").slice(0, 220))
        console.log(`\n${n.isMissing ? "MISSING" : "ERROR"} ${n.type} rows ${r0}..${r1} bytes ${n.startIndex}..${n.endIndex}`)
        console.log(`  text: ${text}`)
        const from = Math.max(0, r0 - 3)
        const to = Math.min(lines.length, r1 + 2)
        for (let i = from; i < to; i++) {
          const mark = i + 1 >= r0 && i + 1 <= r1 ? ">>" : "  "
          console.log(`  ${mark} ${String(i + 1).padStart(4)} ${lines[i]}`)
        }
      }
      shown++
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(root)
  console.log(`\n${shown} bad node(s) total, ${Math.min(shown, maxNodes)} shown.`)
}
main()
