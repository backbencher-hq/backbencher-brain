// #758 wave 2: B4 static-override fabrication, B5 accessor-pair collapse,
// B8 as-default export flag. Verify each live before fixing.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../../src/ast/real-javascript-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const a = new RealJavaScriptAnalyzer() as any

  // B4: class extends with a STATIC method of the same name as a base method
  {
    const src = `class Base {\n  static create() { return 1; }\n}\nclass Sub extends Base {\n  static create() { return 2; }\n}\n`
    const p = new P(); p.setLanguage(js)
    const r = await a.analyze(p.parse(src).rootNode, src, "B4.js", {})
    const ovr = (r.relationships ?? []).filter((x: any) => x.type === "overrides")
    console.log("B4 static extends overrides:", JSON.stringify(ovr))
  }
  // B5: get/set accessor pair — one symbol or collapsed?
  {
    const src = `const obj = {\n  get value() { return this._v; },\n  set value(v) { this._v = v; }\n};\n`
    const p = new P(); p.setLanguage(js)
    const r = await a.analyze(p.parse(src).rootNode, src, "B5.js", {})
    const syms = (r.symbols ?? []).filter((s: any) => s.name.includes("value"))
    console.log("B5 accessor symbols:", JSON.stringify(syms.map((s: any) => ({ name: s.name, kind: s.kind, line: s.range?.startLine }))))
  }
  // B8: export { x as default }
  {
    const src = `const myDefault = 1;\nexport { myDefault as default };\n`
    const p = new P(); p.setLanguage(js)
    const r = await a.analyze(p.parse(src).rootNode, src, "B8.js", {})
    const ex = (r.exports ?? []).map((e: any) => ({ name: e.name, isDefault: e.isDefault }))
    console.log("B8 as-default exports:", JSON.stringify(ex))
  }
}
main()
