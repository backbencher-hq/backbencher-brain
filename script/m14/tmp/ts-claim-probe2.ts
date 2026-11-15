import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-typescript.wasm")
  const p = new P()
  p.setLanguage(lang)
  const a = new RealTypeScriptAnalyzer() as any
  const run = async (name: string, src: string, checks: (r: any, root: any) => void, file = "T.ts") => {
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, file, undefined)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any, name: string) => (r.symbols ?? []).filter((s: any) => s.name === name)

  await run("T2a controller base path", `import { Controller, Get } from "@nestjs/common";\n@Controller("users")\nclass C {\n @Get("list")\n findAll() { return []; }\n}`, (r) => {
    const m = syms(r, "findAll")[0]
    console.log("   path=" + m?.apiContractPath)
    if (m?.apiContractPath !== "/users/list") throw new Error("base path not composed (claim TRUE)")
  })
  await run("T2b open-close jsx", `function MyComp() { return null; }\nfunction App() {\n return <MyComp></MyComp>;\n}`, (r) => {
    const inst = rels(r, "instantiates").filter((x: any) => x.target === "MyComp")
    const uses = rels(r, "uses").filter((x: any) => x.target === "MyComp")
    console.log("   uses=" + uses.length + " inst=" + inst.length)
  })
  await run("T2c single-char jsx", `function A() { return null; }\nfunction App() {\n return <A />;\n}`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " inst=" + JSON.stringify(rels(r, "instantiates")))
  })
  await run("T2d template member", `const a = { b: 1 };\nfunction f() {\n return \`v=\${a.b}\`;\n}`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses").concat(rels(r, "references"))))
  })
  await run("T2e rest param", `function f(...args: string[]) {}`, (r) => {
    console.log("   params=" + JSON.stringify(syms(r, "f")[0]?.parameters))
  })
  await run("T2f ambient const", `declare const VERSION: string;`, (r) => {
    console.log("   kinds=" + JSON.stringify(syms(r, "VERSION").map((s: any) => s.kind)))
  })
  await run("T2g two fetches", `async function f() {\n await fetch("/a");\n await fetch("/b");\n}`, (r) => {
    console.log("   path=" + syms(r, "f")[0]?.apiContractPath)
  })
  await run("T2h taint substring", `function f(myreq) {\n return myreq.body;\n}`, (r) => {
    console.log("   sources=" + JSON.stringify(syms(r, "f")[0]?.taintSources))
    if ((syms(r, "f")[0]?.taintSources ?? []).length) throw new Error("myreq.body flagged (claim TRUE)")
  })
  await run("T2i sibling decorators", `class C {\n @A\n @B\n m() {}\n}`, (r) => {
    console.log("   decorators=" + JSON.stringify(syms(r, "m")[0]?.decorators))
  })
}
main()
