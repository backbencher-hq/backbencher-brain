// #743 reducer companion: where exactly does a file break under a given wasm?
// Prints each ERROR node with its ancestor chain, its own first line, and the
// two source lines above it, because the reported line is very often the
// RECOVERY point rather than the cause (the W21 lesson).
//
// Usage: bun script/m14/tmp/c743-errdump.ts <wasm> <file> [n]
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const [wasmPath, file, nArg] = process.argv.slice(2)
const N = nArg ? Number(nArg) : 8

function ancestors(n: any): string[] {
  const out: string[] = []
  let p = n.parent
  while (p && out.length < 4) {
    out.push(p.type)
    p = p.parent
  }
  return out.reverse()
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const lang = await Language.load(readFileSync(wasmPath))
  const parser = new Parser()
  parser.setLanguage(lang)
  const src = readFileSync(file, "utf8")
  const lines = src.split("\n")
  const tree = parser.parse(src)

  const errs: any[] = []
  const miss: any[] = []
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()
    if (n.type === "ERROR") errs.push(n)
    if (n.isMissing) miss.push(n)
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  errs.sort((a, b) => a.startIndex - b.startIndex)
  console.log(`${path.basename(file)}: ${errs.length} ERROR nodes, ${miss.length} MISSING tokens`)
  for (const e of errs.slice(0, N)) {
    const row = e.startPosition.row
    console.log(`\n  ERROR rows ${row + 1}-${e.endPosition.row + 1} col ${e.startPosition.column}  [${ancestors(e).join(" > ")}]`)
    console.log(`    error node text: ${JSON.stringify(e.text.slice(0, 90))}`)
    for (let i = Math.max(0, row - 2); i <= row; i++) console.log(`    ${i + 1}: ${lines[i] ?? ""}`)
  }
  if (miss.length) {
    console.log(`\n  first MISSING tokens:`)
    miss.sort((a, b) => a.startIndex - b.startIndex)
    for (const m of miss.slice(0, 8)) {
      console.log(`    row ${m.startPosition.row + 1} inserted ${JSON.stringify(m.type)} before: ${JSON.stringify((lines[m.startPosition.row] ?? "").trim().slice(0, 70))}`)
    }
  }
  tree.delete()
}

main().catch((e) => {
  console.error("c743-errdump failed:", e)
  process.exit(1)
})
