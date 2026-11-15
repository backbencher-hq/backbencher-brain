import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const root = await parse(`const T1: u32 = 1;\nfn f() u32 { return T1; }\n`)
  console.log("root kids:", root.namedChildren.map((c: any) => c.type).join(","))
  const vd = root.namedChildren.find((c: any) => c.type === "variable_declaration")
  console.log("vardecl kids:", vd.namedChildren.map((c: any) => c.type + "=" + c.text.slice(0, 8)).join(" | "))
  const fileValues = new Set<string>()
  const pre: any[] = [{ n: root, inFn: false }]
  while (pre.length > 0) {
    const { n, inFn } = pre.pop()!
    const t = n.type
    if (!inFn && t === "variable_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { fileValues.add(c.text); break }
      }
    }
    const nextInFn = inFn || t === "function_declaration"
    for (let k = n.namedChildCount - 1; k >= 0; k--) { const c = n.namedChild(k); if (c) pre.push({ n: c, inFn: nextInFn }) }
  }
  console.log("fileValues:", JSON.stringify([...fileValues]))
}
main()
