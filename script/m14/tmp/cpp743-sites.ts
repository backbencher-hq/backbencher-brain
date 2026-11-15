// #743 cpp: what does the pinned grammar actually build at the top ERROR
// clusters? Print the s-expression window around a named site.
//   bun script/m14/tmp/cpp743-sites.ts <file> <line> [contextLines]
import fs from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-cpp.wasm"))
const parser = new P()
parser.setLanguage(lang)

const SITES: Array<[string, number, number]> = [
  ["fmt/src/format.cc", 43, 4],
  ["fmt/test/format-impl-test.cc", 319, 3],
  ["nlohmann-json/include/nlohmann/json.hpp", 4179, 2],
  ["fmt/src/fmt-c.cc", 60, 4],
  ["fmt/src/fmt-c.cc", 67, 4],
  ["nlohmann-json/include/nlohmann/detail/exceptions.hpp", 282, 3],
]
for (const [rel, line, ctx] of SITES) {
  const f = path.join(CORPUS, rel)
  const src = fs.readFileSync(f, "utf8")
  const root = parser.parse(src).rootNode
  console.log(`\n#### ${rel}:${line}`)
  console.log(src.split("\n").slice(line - 1, line - 1 + ctx).map((l, i) => `   ${line + i}| ${l}`).join("\n"))
  // the innermost node covering the line's first non-space char
  const lines = src.split("\n")
  let col = 0
  while (col < (lines[line - 1] ?? "").length && lines[line - 1][col] === " ") col++
  const idx = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0) + col
  let n: any = root.descendantForIndex(idx, idx + 1)
  const chain: string[] = []
  while (n && n.type !== "translation_unit") {
    chain.push(`${n.type}${n.isError ? "(ERR)" : ""}${n.hasError ? "(hasError)" : ""}${n.isMissing ? "(MISSING)" : ""}`)
    n = n.parent
  }
  console.log(`   chain: ${chain.join(" < ")}`)
  // the enclosing ERROR's own text and children
  let e: any = root.descendantForIndex(idx, idx + 1)
  while (e && !(e.isError || e.type === "ERROR")) e = e.parent
  if (e) {
    console.log(`   ERROR @L${e.startPosition.row + 1}-L${e.endPosition.row + 1} (${e.endPosition.row - e.startPosition.row + 1} lines): ${JSON.stringify(e.text.slice(0, 160))}`)
    for (let i = 0; i < e.namedChildCount && i < 6; i++) {
      const c = e.namedChild(i)
      console.log(`      child[${i}] ${c.type}${c.isMissing ? "(MISSING)" : ""}: ${JSON.stringify(c.text.slice(0, 70))}`)
    }
  } else {
    console.log("   (no ERROR ancestor)")
  }
}
