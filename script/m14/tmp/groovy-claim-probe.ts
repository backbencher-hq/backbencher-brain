import * as WTS from "web-tree-sitter"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-groovy.wasm")
  const p = new P()
  p.setLanguage(lang)
  const a = new RealGroovyAnalyzer() as any
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, `T.groovy`, undefined)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any, name: string) => (r.symbols ?? []).filter((s: any) => s.name === name)
  const dump = (n: any, depth: number, out: string[]) => {
    if (depth > 3) return
    out.push("  ".repeat(depth) + n.type + (n.isNamed ? "" : " (anon)") + " = " + JSON.stringify(n.text.slice(0, 50)))
    for (let i = 0; i < n.namedChildCount && i < 10; i++) dump(n.namedChild(i), depth + 1, out)
  }

  await run("G-static import flag", `import static foo.Bar.*\nclass A {}`, (r) => {
    const imp = (r.imports ?? [])[0]
    console.log("   import=" + JSON.stringify({ m: imp?.module, meta: imp?.metadata }))
    if (!imp?.metadata?.isStatic) throw new Error("isStatic false (claim TRUE)")
  })
  await run("G-trait extends", `trait T extends Base {\n}\nclass Base {}`, (r, root) => {
    const out: string[] = []; dump(root, 0, out)
    console.log("   tree:\n" + out.slice(0, 25).join("\n"))
    console.log("   extends=" + JSON.stringify(rels(r, "extends")))
    if (!rels(r, "extends").some((x: any) => x.source === "T")) throw new Error("trait extends dropped (claim TRUE)")
  })
  await run("G-generic method name", `class A {\n def <T> T foo(T x) { return x }\n}`, (r) => {
    const names = (r.symbols ?? []).map((s: any) => s.name)
    console.log("   names=" + JSON.stringify(names))
    if (!syms(r, "foo").length) throw new Error("foo missing (claim TRUE)")
  })
  await run("G-implicit override", `class B {\n void foo() {}\n}\nclass S extends B {\n void foo() {}\n}`, (r) => {
    console.log("   overrides=" + JSON.stringify(rels(r, "overrides")))
    if (!rels(r, "overrides").length) throw new Error("implicit override missed (claim TRUE)")
  })
  await run("G-as cast refs", `class A {\n def f(o) {\n def y = o as String\n }\n}`, (r, root) => {
    const refs = rels(r, "references").filter((x: any) => x.target === "String")
    console.log("   String refs=" + JSON.stringify(refs.map((x: any) => x.metadata)))
    if (!refs.length) throw new Error("as-cast ref dropped (claim TRUE)")
  })
  await run("G-method ref receiver", `class A {\n def f() {\n def g = String::valueOf\n }\n}`, (r, root) => {
    const refs = rels(r, "references").filter((x: any) => x.target === "String")
    console.log("   String refs=" + JSON.stringify(refs))
    if (!refs.length) throw new Error("method-ref receiver missed (claim TRUE)")
  })
  await run("G-annotated return", `class A {\n @NotNull\n String greet() { return "hi" }\n}`, (r, root) => {
    const refs = rels(r, "references").filter((x: any) => x.target === "String" && x.metadata?.relationshipType === "return_type")
    console.log("   return refs=" + JSON.stringify(rels(r, "references").filter((x: any) => x.target === "String")))
    if (!refs.length) throw new Error("annotated return ref lost (claim TRUE)")
  })
  await run("G-spock name", `class Spec {\n def "addition works"() {\n expect:\n 1 + 1 == 2\n }\n}`, (r) => {
    const names = (r.symbols ?? []).map((s: any) => s.name)
    console.log("   names=" + JSON.stringify(names))
    if (!names.includes("addition works")) throw new Error("spock name mangled (claim TRUE)")
  })
  await run("G-trait export", `trait T {\n void foo() {}\n}`, (r) => {
    const ex = (r.exports ?? []).map((e: any) => e.name)
    console.log("   exports=" + JSON.stringify(ex))
    if (!ex.includes("T") || !ex.includes("foo")) throw new Error("trait member missing (claim TRUE): " + JSON.stringify(ex))
  })
  await run("G-enum implements", `enum E implements Closeable {\n A;\n void close() {}\n}`, (r) => {
    console.log("   implements=" + JSON.stringify(rels(r, "implements")) + " extends=" + JSON.stringify(rels(r, "extends")))
    if (!rels(r, "implements").some((x: any) => x.source === "E")) throw new Error("enum implements dropped (claim TRUE)")
  })
  await run("G-class annotations", `import org.springframework.stereotype.Service\n@Service\nclass S {}`, (r) => {
    const s = syms(r, "S")[0]
    console.log("   decorators=" + JSON.stringify(s?.decorators))
    if (!s?.decorators?.length) throw new Error("class decorators empty (claim TRUE)")
  })
  await run("G-spread param", `class A {\n def foo(String... xs) {}\n}`, (r) => {
    const foo = syms(r, "foo")[0]
    console.log("   params=" + JSON.stringify(foo?.parameters))
    if (foo?.parameters?.[0]?.name === "anonymous") throw new Error("spread name lost (claim TRUE)")
  })
  await run("G-ctor collision", `class A {\n A() {}\n}\nclass B {\n B() {}\n}`, (r) => {
    const ctors = (r.symbols ?? []).filter((s: any) => String(s.kind).toLowerCase().includes("construct"))
    console.log("   ctors=" + JSON.stringify(ctors.map((s: any) => ({ n: s.name, o: s.ownerName }))))
    if (new Set(ctors.map((s: any) => s.name)).size < ctors.length) throw new Error("ctor names collide (claim TRUE)")
  })
}
main()
