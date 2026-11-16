// #919: why did the CP2 heading text run past the body? List every
// function_declarator inside the affected `function_definition`, with its
// parameters span and its parent chain.
//   bun script/m14/tmp/c919-h932.ts
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
  if (n.type === "function_definition" && n.startPosition.row + 1 >= 165 && n.startPosition.row + 1 <= 175) {
    console.log(`function_definition lines ${n.startPosition.row + 1}..${n.endPosition.row + 1}`)
    console.log(`  text head: ${JSON.stringify(n.text.slice(0, 80))}`)
    const body = n.childForFieldName("body")
    console.log(`  body: ${body ? `lines ${body.startPosition.row + 1}..${body.endPosition.row + 1}` : "NONE"}`)
    const walk: any[] = [n]
    while (walk.length) {
      const x = walk.pop()!
      if (x.type === "function_declarator") {
        const p = x.childForFieldName("parameters")
        const chain: string[] = []
        let c: any = x
        for (let i = 0; i < 5 && c; i++) { chain.push(c.type); c = c.parent }
        console.log(`  fd lines ${x.startPosition.row + 1}..${x.endPosition.row + 1} text=${JSON.stringify(x.text.slice(0, 60))}`)
        console.log(`     params ${p ? `${p.startPosition.row + 1}..${p.endPosition.row + 1} idx ${p.startIndex}..${p.endIndex}` : "NONE"}  parents: ${chain.join(" < ")}`)
      }
      for (let i = 0; i < x.childCount; i++) walk.push(x.child(i))
    }
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
