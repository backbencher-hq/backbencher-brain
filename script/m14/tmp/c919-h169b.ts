// #919: geometry of the swallowed heading — statement span, its call/args/name
// spans, and the sibling block.
//   bun script/m14/tmp/c919-h169b.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const file = "<corpus-root>/bb_tests/repositories/nlohmann-json/tests/src/unit-serialization.cpp"
const src = readFileSync(file, "utf8")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const root = parser.parse(src).rootNode
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "expression_statement" && n.startPosition.row + 1 === 169) {
    console.log(`stmt idx ${n.startIndex}..${n.endIndex} lines ${n.startPosition.row + 1}..${n.endPosition.row + 1}`)
    const call = n.namedChild(0)
    const fn = call?.childForFieldName("function")
    const args = call?.childForFieldName("arguments")
    console.log(`  call ${call?.startIndex}..${call?.endIndex} lines ${call?.startPosition.row + 1}..${call?.endPosition.row + 1}`)
    console.log(`  name(${fn?.type}) ${fn?.startIndex}..${fn?.endIndex} text=${JSON.stringify(fn?.text)}`)
    console.log(`  args(${args?.type}) ${args?.startIndex}..${args?.endIndex} lines ${args?.startPosition.row + 1}..${args?.endPosition.row + 1} text=${JSON.stringify((args?.text ?? "").slice(0, 60))}`)
    const nx = n.nextSibling
    console.log(`  nextSibling: ${nx?.type} idx ${nx?.startIndex}..${nx?.endIndex} lines ${(nx?.startPosition.row ?? 0) + 1}..${(nx?.endPosition.row ?? 0) + 1}`)
    console.log(`  src from name to +90: ${JSON.stringify(src.slice(fn?.startIndex, (fn?.startIndex ?? 0) + 90))}`)
    // the first '(' after the name and its match
    let i = src.indexOf("(", fn!.endIndex)
    let depth = 0
    for (let k = i; k < src.length && k < i + 4000; k++) {
      const ch = src[k]
      if (ch === "(") depth++
      else if (ch === ")") { depth--; if (depth === 0) { console.log(`  paren match ends at idx ${k} (line ${src.slice(0, k).split("\n").length}) text=${JSON.stringify(src.slice(fn!.startIndex, k + 1))}`); break } }
    }
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
