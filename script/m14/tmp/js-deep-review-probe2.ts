// Deep review probe round 2 — JavaScript analyzer lane (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const jsLang = await L.load("wasm/tree-sitter-javascript.wasm")
  const tsLang = await L.load("wasm/tree-sitter-typescript.wasm")
  const jsP = new P(); jsP.setLanguage(jsLang)
  const tsP = new P(); tsP.setLanguage(tsLang)
  const jsA = new RealJavaScriptAnalyzer() as any
  const tsA = new RealTypeScriptAnalyzer() as any

  const runJS = async (name: string, src: string, checks: (r: any) => void) => {
    const root = jsP.parse(src).rootNode
    const r = await jsA.analyze(root, src, "T.js", undefined)
    try { checks(r); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const runTS = async (name: string, src: string, checks: (r: any) => void) => {
    const root = tsP.parse(src).rootNode
    const r = await tsA.analyze(root, src, "T.ts", undefined)
    try { checks(r); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any) => (r.symbols ?? []).map((s: any) => `${s.name}@${s.range?.startLine}:${s.kind}:${s.ownerName ?? "-"}`)

  console.log("=== E1: grammar node type census for loops / class expressions ===")
  {
    const src = `for (const a of b) {}\nfor (const k in o) {}\nconst K = class Named { m(){} };\nconst L = class {};`
    const root = jsP.parse(src).rootNode
    const types = new Set<string>()
    const st = [root]
    while (st.length) { const n: any = st.pop(); types.add(n.type); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
    console.log("   for_of_statement present=" + types.has("for_of_statement"))
    console.log("   class-expression type present=" + types.has("class"))
  }

  console.log("=== E2: for-of contributes 0 to cyclomatic complexity ===")
  await runJS("E2a JS for-of", `function f() { for (const a of b) { g() } }`, (r) => {
    const f = (r.symbols ?? []).find((s: any) => s.name === "f")
    console.log("   f.complexity=" + f?.complexity + " file=" + (r.metadata as any)?.cyclomaticComplexity)
    if (f?.complexity !== 2) throw new Error("for-of not counted: " + f?.complexity)
  })
  await runTS("E2b TS for-of", `function f() { for (const a of b) { g() } }`, (r) => {
    const f = (r.symbols ?? []).find((s: any) => s.name === "f")
    console.log("   f.complexity=" + f?.complexity)
  })

  console.log("=== E3: class expression yields no Class symbol / no owner / no contains ===")
  await runJS("E3a named class expression", `const K = class Inner { constructor(){} ; go(){} };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
    const hasClass = (r.symbols ?? []).some((s: any) => s.kind === "class" && s.name === "Inner")
    if (!hasClass) throw new Error("no Class symbol for a named class expression")
  })
  await runTS("E3b TS parity", `const K = class Inner { constructor(){} ; go(){} };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
  })
  await runJS("E3c exported anonymous class expression", `export default class { go(){} };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })

  console.log("=== E4: dead-span leakage for CJS exports / imports / decorators ===")
  await runJS("E4a export pushed from a dead body", `class A {
  m() { module.exports.ghost = 1 ; return 1 }
  m() { return 2 }
}`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    console.log("   exportRels=" + JSON.stringify(rels(r, "exports").map((x: any) => x.target)))
    if (rels(r, "exports").some((x: any) => x.target === "ghost")) throw new Error("export from a superseded duplicate body survived")
  })

  console.log("=== E5: object-literal member owner / contains ===")
  await runJS("E5a module const holding an object literal", `const api = { get(){}, set(v){}, run(){ helper() } };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
    console.log("   qcalls=" + JSON.stringify((r.symbols ?? []).map((s: any) => `${s.name}:${JSON.stringify(s.qualified_calls)}`)))
  })

  console.log("=== E6: static method override + static accessor ===")
  await runJS("E6a static method must not override", `class Base { static create(){} }
class Sub extends Base { static create(){} }`, (r) => {
    const o = rels(r, "overrides")
    console.log("   overrides=" + JSON.stringify(o.map((x: any) => `${x.source}->${x.target}@${x.confidence}`)))
    if (o.some((x: any) => x.source === "Sub.create")) throw new Error("static override emitted")
  })

  console.log("=== E7: import relationship for a default+named mixed clause ===")
  await runJS("E7a import Def, { a as b } from 'm'", `import Def, { alpha as beta } from "m";`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ items: i.items, d: i.isDefault }))))
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => `${x.target}@${x.line_number}`)))
  })

  console.log("=== E8: export alias line number is the specifier, not the statement ===")
  await runJS("E8a wrapped export clause", `const alpha = 1;
export {
  alpha as beta,
  alpha as gamma
}`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => `${e.name}@${e.range?.startLine}`)))
    console.log("   rels=" + JSON.stringify(rels(r, "exports").map((x: any) => `${x.target}@${x.line_number}`)))
  })

  console.log("=== E9: private method visibility + dedup with public twin ===")
  await runJS("E9a #x and x coexist", `class A { #x = 1; x = 2; get #v(){}; get v(){} }`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => `${s.name}@${s.range?.startLine}:${s.visibility}:${JSON.stringify(s.metadata)}`)))
  })

  console.log("=== E10: relationship line coverage census on a dense file ===")
  await runJS("E10a", `import Def, { a as b } from "m";
class Base { constructor(){} ; go(){ helper() } }
class Sub extends Base { go(){ other() } ; static s(){ third() } }
const o = { m(){ fourth() } };
function top(){ fifth() }
export default class { z(){} }
module.exports.tail = 1;
export { top as pub };`, (r) => {
    const all = r.relationships ?? []
    const withLine = all.filter((x: any) => typeof x.line_number === "number").length
    console.log("   relationships=" + all.length + " withLine=" + withLine + " without=" + (all.length - withLine))
    const missing = all.filter((x: any) => typeof x.line_number !== "number").map((x: any) => `${x.type}:${x.source}->${x.target}`)
    console.log("   missing=" + JSON.stringify(missing))
  })
}
main().catch((e) => { console.error(e); process.exit(1) })
