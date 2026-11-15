// script/m14/tmp/oc-oracle-param-uses.ts — who owns the block-parameter `uses` row?
// The analyzer fix (isParameterDeclaredName) removes `uses <fn> -> <block param>` at
// the DECLARATION. F5 compares the analyzer against an independent oracle, so before
// the fix can be trusted the oracle must answer the same question. This probe asks
// both oracles (deriveCCalls for c, deriveObjcEdges for objc) for the identical
// function-pointer parameter, with and without a call in the body.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
  const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const ocLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))

  const cCases: Array<[string, string]> = [
    ["decl only", `void h(void (*cb)(int)) {\n  int x = 0;\n}\n`],
    ["decl+call", `void k(void (*cb)(int)) {\n  cb(1);\n}\n`],
    ["plain param read", `void g(int n) {\n  int x = n;\n}\n`],
  ]
  for (const [label, src] of cCases) {
    const p = new P(); p.setLanguage(cLang)
    const root = p.parse(src).rootNode
    const edges = (diff.deriveCCalls(root, src) ?? []).map((e: any) => `${e.label} ${e.from} -> ${e.target}`)
    console.log(`C ORACLE [${label}] ${JSON.stringify(src)}\n    ${edges.join("\n    ") || "(none)"}`)
  }
  const ocCases: Array<[string, string]> = [
    ["block decl only", `void h(void (^handler)(NSString *)) {\n  int x = 0;\n}\n`],
    ["block decl+call", `void k(void (^handler)(NSString *)) {\n  handler(@"x");\n}\n`],
    ["plain param read", `void g(int n) {\n  int x = n;\n}\n`],
  ]
  for (const [label, src] of ocCases) {
    const p = new P(); p.setLanguage(ocLang)
    const root = p.parse(src).rootNode
    const edges = (diff.deriveObjcEdges(root) ?? []).map((e: any) => `${e.label} ${e.from} -> ${e.target}`)
    console.log(`OBJC ORACLE [${label}] ${JSON.stringify(src)}\n    ${edges.join("\n    ") || "(none)"}`)
  }
}
main()
