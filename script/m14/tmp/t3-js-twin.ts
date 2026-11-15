import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CASES: Array<[string, string]> = [
  ["console[method](nested call)", "function f(m, method) { console[method](m.text()); }\n"],
  ["arr[i](nested call)", "function f(m, arr, i) { arr[i](m.text()); }\n"],
]
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const p = new P(); p.setLanguage(lang)
  for (const [tag, s] of CASES) {
    const a = new RealJavaScriptAnalyzer() as any
    const r = await a.analyze(p.parse(s).rootNode, s, "probe.js")
    const calls = (r.relationships ?? []).filter((x: any) => x.type === "calls").map((x: any) => x.target)
    console.log(`${tag}: analyzer calls=[${calls.join(", ") || "(none)"}]`)
  }
}
main()
