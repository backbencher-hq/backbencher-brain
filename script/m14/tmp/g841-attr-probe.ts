// Is the undefined `from` fixture-specific or general? Minimal attribution probe.
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "A. script fn, plain call", src: `def f(x) { g(x) }\n` },
    { cls: "B. script fn, call after for-in def", src: `def f(xs) { for (def x : xs) { h(x) } ; g(xs) }\n` },
    { cls: "C. script fn, one-line try", src: `def f() { try { attempt() } catch (e) { log(e) } }\n` },
    { cls: "D. script fn, spread-map call", src: `def f(m) { deploy(*: m) }\n` },
    { cls: "E. class method, one-line try", src: `class C { def f() { try { attempt() } catch (e) { log(e) } } }\n` },
    { cls: "F. class with one-line field", src: `class C { def a = 1 }\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const az = new (mod as any).RealGroovyAnalyzer()
    const res = await az.analyze(tree.rootNode, c.src, "probe.groovy")
    const syms = (res.symbols ?? []).map((s: any) => s.name).join(",")
    const rels = (res.relationships ?? []).map((r: any) => `${r.type}:${r.source}->${r.target}`).join(" ")
    console.log(`${c.cls}\n  syms: ${syms}\n  rels: ${rels}`)
  }
}
main()
