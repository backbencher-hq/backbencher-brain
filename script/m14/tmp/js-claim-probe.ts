import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P()
  p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  const run = async (name: string, src: string, checks: (r: any, root: any) => void, file = "T.js") => {
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, file, undefined)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any, name: string) => (r.symbols ?? []).filter((s: any) => s.name === name)

  await run("J-jsx cap large file", `const a = 1;\n`.repeat(150) + `function App() { return React.createElement(B, null); }\nconst el = <B />;`, (r) => {
    const fw: string[] = (r.metadata as any)?.detectedFrameworks ?? []
    console.log("   fw=" + JSON.stringify(fw))
    if (!fw.includes("React")) throw new Error("JSX missed in large file (claim TRUE)")
  })
  await run("J-default import flag", `import A from "m";\nconsole.log(A);`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ m: i.module, items: i.items, d: i.isDefault }))))
    if ((r.imports ?? [])[0]?.isDefault !== true) throw new Error("default import not flagged (claim TRUE)")
  })
  await run("J-field/method override", `class Base {\n foo = 1;\n}\nclass Sub extends Base {\n foo() { return 2; }\n}`, (r) => {
    console.log("   overrides=" + JSON.stringify(rels(r, "overrides")))
    if (rels(r, "overrides").length) throw new Error("method-to-field override (claim TRUE)")
  })
  await run("J-ctor override", `class Base {\n constructor() {}\n}\nclass Sub extends Base {\n constructor() { super(); }\n}`, (r) => {
    console.log("   overrides=" + JSON.stringify(rels(r, "overrides")))
    if (rels(r, "overrides").some((x: any) => x.source === "Sub.constructor")) throw new Error("ctor override edge (claim TRUE)")
  })
  await run("J-dup method winner", `class A {\n foo() { return 1; }\n foo() { return 2; }\n}`, (r) => {
    const f = syms(r, "foo")
    console.log("   n=" + f.length + " range=" + JSON.stringify(f.map((s: any) => s.range?.startLine)))
    if (f.length !== 1) throw new Error("dup methods: " + f.length)
  })
  await run("J-private field visibility", `class A {\n #x = 1;\n}`, (r) => {
    const x = syms(r, "x")[0]
    console.log("   vis=" + x?.visibility + " meta=" + JSON.stringify(x?.metadata))
    if (x?.visibility !== "private") throw new Error("private field public (claim TRUE)")
  })
  await run("J-require symbol", `const x = require("fs");\nconsole.log(x);`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => i.module)) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!(r.imports ?? []).some((i: any) => i.module === "fs")) throw new Error("require import missed (claim TRUE)")
    if (syms(r, "x").length) throw new Error("require binding as symbol (claim TRUE)")
  })
  await run("J-named require flag", `const { a } = require("m");`, (r) => {
    console.log("   imports=" + JSON.stringify(r.imports))
    if ((r.imports ?? [])[0]?.isDefault !== false) throw new Error("named require isDefault (claim TRUE)")
  })
  await run("J-destructured params", `function f({a, b} = {}) { return a; }`, (r) => {
    console.log("   params=" + JSON.stringify(syms(r, "f")[0]?.parameters))
    if (!(syms(r, "f")[0]?.parameters ?? []).length) throw new Error("destructured params dropped (claim TRUE)")
  })
  await run("J-qualified heritage", `class A extends Lib.Base {}`, (r) => {
    console.log("   extends=" + JSON.stringify(rels(r, "extends")))
    // DOWNGRADED by audit: js-member-heritage fixture PINS the dotted target
    // by design (identifier-only extraction dropped qualified heritage
    // entirely). Guard the ruling: changing to leaf must be a conscious
    // cross-family decision, not a drive-by.
    if (!rels(r, "extends").some((x: any) => x.target === "Lib.Base")) throw new Error("pinned dotted heritage lost")
  })
  await run("J-default object export", `export default { a: 1 };`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    if (!(r.exports ?? []).length) throw new Error("default object export dropped (claim TRUE)")
  })
  await run("J-samename qualified calls", `class U {\n save() { return uSave(); }\n}\nclass O {\n save() { return oSave(); }\n}`, (r) => {
    const u = (r.symbols ?? []).find((s: any) => s.name === "save" && s.ownerName === "U")
    const o = (r.symbols ?? []).find((s: any) => s.name === "save" && s.ownerName === "O")
    console.log("   U.qc=" + JSON.stringify(u?.qualified_calls) + " O.qc=" + JSON.stringify(o?.qualified_calls))
    if (JSON.stringify(u?.qualified_calls) === JSON.stringify(o?.qualified_calls)) throw new Error("cross-contaminated (claim TRUE)")
  })
  await run("J-sideeffect import flag", `import "./init";`, (r) => {
    console.log("   imports=" + JSON.stringify(r.imports))
    if ((r.imports ?? [])[0]?.isDefault !== false) throw new Error("side-effect isDefault (claim TRUE)")
  })
  await run("J-export alias", `const a = 1;\nexport { a as b };`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    if (!(r.exports ?? []).some((e: any) => e.name === "b")) throw new Error("export alias missed (claim TRUE)")
  })
  await run("J-async named method", `class A {\n async() {}\n}`, (r) => {
    const m = syms(r, "async")[0]
    console.log("   sym=" + JSON.stringify(m ? { n: m.name, k: m.kind, meta: m.metadata } : null))
  })
}
main()
