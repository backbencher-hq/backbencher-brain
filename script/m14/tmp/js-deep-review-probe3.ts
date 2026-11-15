// Deep review probe round 3 — JavaScript analyzer lane (2026-09-26)
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

  console.log("=== F1: DEFAULT import edge target vs the exporter's 'default' sentinel ===")
  await runJS("F1a JS default import", `import Def from "m";`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
    if (!rels(r, "imports").some((x: any) => x.target === "m:default")) throw new Error("no m:default edge: " + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })
  await runTS("F1b TS parity", `import Def from "m";`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })
  await runJS("F1c the two halves must join", `import Def from "m";`, (r) => {
    console.log("   (exporter side) export default X -> " + JSON.stringify(rels(r, "exports").map((x: any) => x.target)))
  })
  await runJS("F1d exporter emits the 'default' sentinel", `class X {}\nexport default X;`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => `${e.name}:${e.isDefault}`)))
    console.log("   rels=" + JSON.stringify(rels(r, "exports").map((x: any) => x.target)))
  })

  console.log("=== F2: object-literal members are ownerless / no contains (JS) ===")
  await runJS("F2a JS", `const api = { run(){ helper() } };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
    if (rels(r, "contains").length === 0) throw new Error("no contains edge for object-literal member")
  })
  await runTS("F2b TS parity", `const api = { run(){ helper() } };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
  })

  console.log("=== F3: class expression heritage -> extends edge ===")
  await runJS("F3a JS const K = class extends Base", `class Base {}\nconst K = class extends Base { go(){} };`, (r) => {
    console.log("   extends=" + JSON.stringify(rels(r, "extends").map((x: any) => `${x.source}->${x.target}`)))
    if (rels(r, "extends").length === 0) throw new Error("class-expression heritage dropped")
  })
  await runJS("F3b JS IIFE class expression", `const K = class extends Base {};`, (r) => {
    console.log("   extends=" + JSON.stringify(rels(r, "extends").map((x: any) => `${x.source}->${x.target}`)))
  })

  console.log("=== F4: module.exports = { ... } members / contains ===")
  await runJS("F4a", `module.exports = { run(){ helper() }, other: 1 };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })

  console.log("=== F5: D1 blast radius — does a nested symbol ALONE shift the zombie? ===")
  await runJS("F5a minimal shift (nested class before the triple)", `class A {
  m() { class K {} }
  m() { }
  get x() { return 1 }
  set x(v) { this.y = v }
  x() { return 3 }
  keep() { return 4 }
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
  })
  await runJS("F5b no nested symbol -> correct behaviour", `class A {
  m() { return 1 }
  m() { return 2 }
  get x() { return 1 }
  set x(v) { this.y = v }
  x() { return 3 }
  keep() { return 4 }
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
  })
  await runJS("F5c nested OBJECT instead of class", `class A {
  m() { const o = { deep: 1 } ; return o }
  m() { return 2 }
  get x() { return 1 }
  x() { return 3 }
  keep() { return 4 }
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
  })

  console.log("=== F6: how often does the exporter side use 'default' vs the importer ===")
  await runJS("F6a re-export of a default", `export { default as Def } from "m";`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => `${e.name}:${e.isDefault}`)))
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ m: i.module, items: i.items }))))
  })

  console.log("=== F7: does the contains edge exist for class members (control) ===")
  await runJS("F7a", `class A { go(){} ; #p = 1 }`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}@${x.line_number}`)))
  })
}
main().catch((e) => { console.error(e); process.exit(1) })
