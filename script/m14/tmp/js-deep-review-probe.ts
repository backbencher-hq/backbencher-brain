// Deep review probe — JavaScript analyzer lane (2026-09-26)
// Re-runnable: npx tsx script/m14/tmp/js-deep-review-probe.ts
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

  console.log("=== D1: B5 zombie index shift (post-walk pass ordering) ===")
  await runJS("D1a getter+setter+data: setter must die", `class A {
  m() { class K {} ; return 1 }
  m() { return 2 }
  get x() { return 1 }
  set x(v) { this.y = v }
  x() { return 3 }
  keep() { return 4 }
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    const names = (r.symbols ?? []).map((s: any) => s.name)
    if (names.includes("set")) throw new Error("ZOMBIE SURVIVED: " + JSON.stringify(names))
    if (!names.includes("keep")) throw new Error("WRONG SYMBOL REMOVED: " + JSON.stringify(names))
  })

  console.log("=== D2: field_definition does not participate in B5 slot resolution ===")
  await runJS("D2a data field kills accessor slot", `class A {
  get x() { return 1 }
  x = 5
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    const names = (r.symbols ?? []).map((s: any) => s.name)
    if (names.filter((n: string) => n === "x").length !== 1) throw new Error("accessor+field both emitted: " + JSON.stringify(names))
  })
  await runTS("D2b TS parity: data field kills accessor slot", `class A {
  get x(): number { return 1 }
  x = 5
}`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    const names = (r.symbols ?? []).map((s: any) => s.name)
    if (names.filter((n: string) => n === "x").length !== 1) throw new Error("TS emits both: " + JSON.stringify(names))
  })

  console.log("=== D3: import alias records the LOCAL name (J6 mirror) ===")
  await runJS("D3a import { a as b }", `import { alpha as beta } from "m";\nconsole.log(beta);`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ m: i.module, items: i.items }))))
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
    const t = rels(r, "imports").map((x: any) => x.target)
    if (!t.includes("m:alpha")) throw new Error("edge names the LOCAL binding, not the module's export: " + JSON.stringify(t))
  })
  await runTS("D3b TS parity", `import { alpha as beta } from "m";\nconsole.log(beta);`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })

  console.log("=== D4: accessor override edges ===")
  await runJS("D4a getter overrides getter", `class Base { get v() { return 1 } }
class Sub extends Base { get v() { return 2 } }`, (r) => {
    console.log("   overrides=" + JSON.stringify(rels(r, "overrides").map((x: any) => `${x.source}->${x.target}@${x.confidence}`)))
    if (rels(r, "overrides").length === 0) throw new Error("accessor override missing")
  })
  await runTS("D4b TS parity", `class Base { get v(): number { return 1 } }
class Sub extends Base { override get v(): number { return 2 } }`, (r) => {
    console.log("   overrides=" + JSON.stringify(rels(r, "overrides").map((x: any) => `${x.source}->${x.target}@${x.confidence}`)))
  })

  console.log("=== D5: relationships emitted from symbols later removed as dead ===")
  await runJS("D5a extends edge from a dead nested class", `class A {
  m() { class Inner extends Base {} ; return 1 }
  m() { return 2 }
}`, (r) => {
    const ext = rels(r, "extends").map((x: any) => `${x.source}->${x.target}`)
    const inner = (r.symbols ?? []).some((s: any) => s.name === "Inner")
    console.log("   innerSymbolPresent=" + inner + " extends=" + JSON.stringify(ext))
    if (!inner && ext.some((e: string) => e.startsWith("Inner"))) throw new Error("DANGLING extends edge for a removed symbol: " + JSON.stringify(ext))
  })

  console.log("=== D6: exports dedupe order vs documented 'first occurrence wins' ===")
  await runJS("D6a repeated CJS export", `module.exports.a = 1;
module.exports = { a: 2, b: 3 };`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => `${e.name}@${e.range?.startLine}`)))
    console.log("   rels=" + JSON.stringify(rels(r, "exports").map((x: any) => `${x.target}@${x.line_number}`)))
    const a = (r.exports ?? []).find((e: any) => e.name === "a")
    if (a?.range?.startLine !== 1) throw new Error("kept LAST occurrence, comment says first wins: " + JSON.stringify(a))
  })

  console.log("=== D7: static block / field initializer call attribution ===")
  await runJS("D7a static block calls", `class S { static { boot(); } }`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls").map((x: any) => `${x.source}->${x.target}`)))
  })

  console.log("=== D8: class expression owner for overrides/contains ===")
  await runJS("D8a named class expression members", `const K = class Inner { m() { return 1 } };`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    console.log("   contains=" + JSON.stringify(rels(r, "contains").map((x: any) => `${x.source}->${x.target}`)))
  })

  console.log("=== D9: namespace import edge target ===")
  await runJS("D9a import * as ns", `import * as ns from "m";\nns.go();`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ m: i.module, items: i.items }))))
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })
  await runTS("D9b TS parity", `import * as ns from "m";\nns.go();`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })

  console.log("=== D10: export default dedupe keeps which occurrence ===")
  await runJS("D10a two default exports", `const a = 1;\nexport default a;\nexport default 2;`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => `${e.name}@${e.range?.startLine}:${e.isDefault}`)))
    console.log("   syms=" + JSON.stringify(syms(r)))
  })
}
main().catch((e) => { console.error(e); process.exit(1) })
