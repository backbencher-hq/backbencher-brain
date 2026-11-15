// #743: for ONE file, list every ERROR/MISSING site under two grammars side by
// side, so a "worse" row on an already-damaged file can be explained (or rejected)
// rather than accepted by the totals.
//   bun script/m14/tmp/c743-sitecmp.ts <pinned.wasm> <cand.wasm> <file>
import fs from "node:fs"
const [pinnedPath, candPath, file] = process.argv.slice(2)
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const p1 = new P(); p1.setLanguage(await L.load(fs.readFileSync(pinnedPath)))
const p2 = new P(); p2.setLanguage(await L.load(fs.readFileSync(candPath)))
const src = fs.readFileSync(file, "utf8")
const lines = src.split("\n")

function sites(parser: any): string[] {
  const out: string[] = []
  const st: any[] = [parser.parse(src).rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.isError || n.type === "ERROR") out.push(`ERROR@${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1} (${n.endPosition.row - n.startPosition.row + 1}L)`)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c?.isMissing) out.push(`MISSING "${c.type}"@${c.startPosition.row + 1}:${c.startPosition.column + 1}`)
      st.push(c)
    }
  }
  return out.sort()
}
const a = sites(p1), b = sites(p2)
const sa = new Set(a), sb = new Set(b)
console.log(`file=${file}\n  pinned sites=${a.length}  cand sites=${b.length}`)
console.log("\nONLY IN PINNED (fixed):")
for (const s of a.filter(x => !sb.has(x))) console.log("   -", s)
console.log("\nONLY IN CAND (new):")
for (const s of b.filter(x => !sa.has(x))) console.log("   +", s)
console.log("\nshared sites:", a.filter(x => sb.has(x)).length)
const newLines = [...new Set(b.filter(x => !sa.has(x)).map(s => parseInt(s.replace(/^[^\d]*/, "")) || 0))].filter(Boolean)
if (newLines.length) {
  console.log("\n--- source at new sites ---")
  for (const n of newLines.slice(0, 12)) console.log(`${String(n).padStart(5)}| ${lines[n - 1]}`)
}
