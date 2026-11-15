// W23: map every ERROR / MISSING node in ONE groovy file back to its source
// line, with the two lines of context before it, so a "first-error line" from
// the census can be turned into the construct that actually fails.
// Usage: bun script/m14/tmp/w23-error-map.ts <path-to.groovy> [maxNodes]
import * as fs from "fs"

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const file = process.argv[2]
  const max = Number(process.argv[3] ?? 12)
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`file=${file}\nhasError=${root.hasError} bytes=${src.length} lines=${lines.length}`)
  const hits: Array<{ kind: string; row: number; col: number; len: number; text: string; node: string }> = []
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) {
      const len = n.endIndex - n.startIndex
      if (!(n.isMissing === false && len === 0)) {
        hits.push({
          kind: n.isMissing ? `MISSING(${n.type})` : "ERROR",
          row: n.startPosition.row + 1,
          col: n.startPosition.column + 1,
          len,
          text: n.text.replace(/\n/g, "\\n"),
          node: String(n),
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  hits.sort((a, b) => a.row - b.row || a.col - b.col)
  console.log(`error/missing nodes (non-zero-width): ${hits.length}`)
  for (const h of hits.slice(0, max)) {
    console.log(`\n--- ${h.kind} @ row ${h.row} col ${h.col} len ${h.len}`)
    console.log(`    text: ${JSON.stringify(h.text.slice(0, 200))}`)
    for (let r = Math.max(1, h.row - 2); r <= Math.min(lines.length, h.row); r++) {
      console.log(`    ${String(r).padStart(5)}| ${lines[r - 1].slice(0, 180)}`)
    }
  }
}
main()
