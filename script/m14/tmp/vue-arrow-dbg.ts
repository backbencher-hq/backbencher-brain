import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const jlang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const sp = new P(); sp.setLanguage(jlang)
  const st = sp.parse(`export default {\n data: () => ({ count: 0 })\n};`)
  const findAll = (n: any, pred: any, out: any[] = []): any[] => { if (pred(n)) out.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) } return out }
  const pair = findAll(st.rootNode, (n: any) => n.type === "pair" && n.text.startsWith("data"))[0]
  console.log("pair:", JSON.stringify(pair?.text))
  const val = pair?.childForFieldName("value")
  console.log("value field:", val?.type, "| direct scan:", pair?.namedChildren.map((c: any) => c.type).join(","))
  // replicate findReturnedObject
  const start = val
  const stack: any[] = [start]
  while (stack.length > 0) {
    const n = stack.pop()!
    console.log("visit:", n.type)
    if (n.type === "return_statement") console.log("  -> return found");
    if (n.type === "object" && n !== start) {
      let ok = true, p = n.parent
      const chain: string[] = []
      while (p && p !== start) { chain.push(p.type); if (!["parenthesized_expression","arrow_function","function_expression","function","method_definition"].includes(p.type)) { ok = false; break } p = p.parent }
      console.log("  object chain:", chain.join("<"), "ok=", ok)
      if (ok) { console.log("  RETURN OBJECT"); break }
    }
    if (n !== start && ["function_expression","arrow_function","function_declaration","method_definition"].includes(n.type)) { console.log("  skip nested"); continue }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main()
