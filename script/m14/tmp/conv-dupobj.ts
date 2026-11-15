import * as fs from "fs"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const src = "const opts = {\n  foo() { return 1 },\n  foo() { return 2 },\n}\n"
  for (const [name, Az, wasm] of [["js", RealJavaScriptAnalyzer, "tree-sitter-javascript.wasm"], ["ts", RealTypeScriptAnalyzer, "tree-sitter-typescript.wasm"]] as const) {
    const lang = await L.load(fs.readFileSync("wasm/" + wasm))
    const p = new P(); p.setLanguage(lang)
    const res: any = new Az().analyze(p.parse(src).rootNode, src, "probe." + name)
    const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
    process.stdout.write(name + ": foo count=" + foos.length + " lines=" + JSON.stringify(foos.map((s: any) => s.range?.startLine)) + "\n")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
