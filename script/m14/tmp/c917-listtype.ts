// #917 residual: `uses (expr) -> cmpp__ListType_impl` is the ONE truth edge the
// analyzer does not cover. Where does truth get it from?
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

const file = "<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const src = fs.readFileSync(file, "utf8")
const root = parser.parse(src).rootNode
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "identifier" && n.text === "cmpp__ListType_impl") {
    const chain: string[] = []
    let c: any = n.parent
    for (let i = 0; c && i < 4; i++) { chain.push(c.type); c = c.parent }
    console.log(`line ${n.startPosition.row + 1}: parent chain = argument_list <- ${chain.join(" <- ")}`)
    console.log(`   text: ${JSON.stringify(src.slice(Math.max(0, n.startIndex - 60), n.endIndex + 60))}`)
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}

// What does the analyzer emit for this name?
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))
const r: any = await parseFile("ext/wasm/libcmpp.c", src, { language: "c" } as any)
const rel = (r.relationships ?? []).filter((x: any) => String(x.target ?? "").includes("cmpp__ListType_impl"))
console.log("\nanalyzer rels:", rel.map((x: any) => `${x.line_number}:${x.type}:${x.source}->${x.target}`))
const syms = (r.symbols ?? []).filter((s: any) => String(s.name ?? "").includes("ListType"))
console.log("analyzer symbols:", syms.map((s: any) => `${s.line_number ?? s.range?.startLine}:${s.kind}:${s.name}`))
