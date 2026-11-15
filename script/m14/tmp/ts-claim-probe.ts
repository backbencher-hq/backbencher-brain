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

  await run("T-accessor named get", `class A {\n get() { return 1; }\n}`, (r) => {
    const g = syms(r, "get")[0]
    console.log("   kind=" + g?.kind + " meta=" + JSON.stringify(g?.metadata?.isAccessor))
    if (g?.kind !== "method") throw new Error("plain get() misclassified (claim TRUE)")
  })
  await run("T-no-annotation return", `function f() { return 42; }`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   returnType=" + f?.returnType)
    if (f?.returnType === "void") throw new Error("inferred body reported void (claim TRUE)")
  })
  await run("T-taint sinks alive", `function f(q) { return db.query(q); }`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   sinks=" + JSON.stringify(f?.taintSinks))
    if (!f?.taintSinks?.length) throw new Error("db.query sink missed (claim TRUE)")
  })
  await run("T-hook noise plain ts", `function helper() { return useThing(); }`, (r) => {
    console.log("   errors=" + JSON.stringify((r.errors ?? []).map((e: any) => e.message)))
    if ((r.errors ?? []).length) throw new Error("non-React hook warning (claim TRUE)")
  })
  await run("T-hook range base", `function helper() {\n return useThing();\n}\nconst x = ;`, (r) => {
    for (const e of (r.errors ?? [])) console.log("   err=" + e.message.slice(0, 40) + " range=" + JSON.stringify(e.range))
    const hook = (r.errors ?? []).find((e: any) => e.message.includes("Hook"))
    if (hook && hook.range.startLine === 1) throw new Error("hook range 0-based (claim TRUE)")
  })
  await run("T-bare decorator route", `class C {\n @Get()\n list() { return []; }\n}`, (r) => {
    const m = syms(r, "list")[0]
    console.log("   apiContractPath=" + m?.apiContractPath)
    if (m?.apiContractPath === "/") throw new Error("phantom root route (claim TRUE)")
  })
  await run("T-lifecycle decorator route", `import { PostConstruct } from "@nestjs/common";\nclass S {\n @PostConstruct()\n init() {}\n}`, (r) => {
    const m = syms(r, "init")[0]
    console.log("   path=" + m?.apiContractPath + " method=" + m?.metadata?.apiMethod)
    if (m?.apiContractPath) throw new Error("lifecycle hook as endpoint (claim TRUE)")
  })
  await run("T-generic heritage", `class A extends Base<string> {}`, (r) => {
    console.log("   extends=" + JSON.stringify(rels(r, "extends")))
    if (rels(r, "extends").some((x: any) => x.target.includes("<"))) throw new Error("args in target (claim TRUE)")
  })
  await run("T-dynamic import qualified", `async function f() {\n const m = await import("./m");\n return m;\n}`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   qualified=" + JSON.stringify(f?.qualified_calls))
    if ((f?.qualified_calls ?? []).some((c: string) => c === "import" || c.includes("import"))) throw new Error("import() in qualified_calls (claim TRUE)")
  })
  await run("T-jsx double edge", `function MyComp() { return null; }\nfunction App() {\n return MyComp();\n}`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls")) + " uses=" + JSON.stringify(rels(r, "uses")))
  })
  await run("T-jsx element double", `function MyComp() { return null; }\nfunction App() {\n return <MyComp />;\n}`, (r, root) => {
    const uses = rels(r, "uses").filter((x: any) => x.target === "MyComp")
    const inst = rels(r, "instantiates").filter((x: any) => x.target === "MyComp")
    console.log("   uses=" + uses.length + " inst=" + inst.length)
    if (uses.length && inst.length) throw new Error("double emission Uses+Instantiates (claim TRUE)")
  })
  await run("T-dup fn attribution", `function f() { return g(); }\nfunction f() { return h(); }`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls")))
  })
  await run("T-inline comment payload", `function f() {\n /* hi */\n return 1;\n}`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   comments=" + JSON.stringify(f?.comments))
    if ((f?.comments ?? []).some((c: string) => c.includes("/*"))) throw new Error("raw inline comment attached (claim TRUE)")
  })
  await run("T-param annotation as return", `function f(x: number) {}`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   returnType=" + f?.returnType)
    if (f?.returnType && f.returnType !== "void") throw new Error("param type as return (claim TRUE)")
  })
}
main()
