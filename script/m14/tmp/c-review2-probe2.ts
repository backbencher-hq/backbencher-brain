import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCAnalyzer().analyze(root, src, "T.c")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  await run("CKR-knr-def", `int add(a, b)\nint a;\nchar b;\n{\nreturn a + b;\n}\n`, (r, root) => {
    const f = (r.symbols ?? []).find((s: any) => s.name === "add")
    console.log("   add=" + JSON.stringify({ kind: f?.kind, vis: f?.visibility, params: f?.parameters }) + " hasError=" + root.hasError)
    if (!f || f.kind !== "function") throw new Error("K&R definition not a function (claim TRUE)")
  })
  await run("CEX-extern-export", `extern int shared;\nint owned;\n`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind + ":" + s.visibility)) + " exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })
  await run("CTD-tentative-dup", `int x;\nint x;\nint main(void) { return x; }\n`, (r) => {
    const xs = (r.symbols ?? []).filter((s: any) => s.name === "x")
    console.log("   x-symbols=" + xs.length)
    if (xs.length > 1) throw new Error("tentative definition duplicated (claim TRUE)")
  })
}
main()
