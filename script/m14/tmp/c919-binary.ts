// #919: which tree node produced `uses binary|186` / `uses values|186` (the two
// unexplained removals in unit-serialization.cpp)? Print every named node whose
// text carries those names near that line, with its ancestors.
//   bun script/m14/tmp/c919-binary.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const file = "/home/ishaq2321/bb_tests/repositories/nlohmann-json/tests/src/unit-serialization.cpp"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const root = parser.parse(readFileSync(file, "utf8")).rootNode
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  const t = String(n.type)
  if ((t === "identifier" || t === "field_identifier") && (n.text === "binary" || n.text === "values")) {
    const line = n.startPosition.row + 1
    if (line >= 180 && line <= 195) {
      const chain: string[] = []
      let c: any = n
      for (let i = 0; i < 7 && c; i++) { chain.push(c.type); c = c.parent }
      console.log(`line=${line} ${t} ${JSON.stringify(n.text)}  ancestors: ${chain.join(" < ")}`)
    }
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
