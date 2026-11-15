// Round-3 #841 class probes: extract the exact failing shapes from the census rows.
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "V1 .& method ref in args", src: `class A {\n  def foo() { bar(1, this.&baz, "x") }\n  def baz(s) {}\n}\n` },
    { cls: "V2 interaction >> {closure}", src: `class A {\n  def t() {\n    def out = []\n    out./print.*/(* _) >> { def args -> acc += args.join('') }\n  }\n}\n` },
    { cls: "V3 leading-dot + cast", src: `class A {\n  def f(c) {\n    return callable(c)\n      .onError(c) as Promise<List<T>>\n  }\n}\n` },
    { cls: "V4 leading-dot + elvis", src: `class A {\n  def f(e) {\n    return env\n      .getProperty("p", List) ?: []\n  }\n}\n` },
    { cls: "V5 operator-first continuation &&", src: `class A {\n  def f(a, b) {\n    return a > 1\n      && ClassUtils.isPresent(b)\n  }\n}\n` },
    { cls: "V6 string-literal receiver", src: `class A {\n  def f() {\n    assertEquals "test", new String("dGVzdA==".decodeBase64())\n  }\n}\n` },
    { cls: "V7 empty closure with arrow", src: `class A {\n  def f() {\n    return { -> }\n  }\n}\n` },
    { cls: "V8a GString call name", src: `class A {\n  def f(m) {\n    delegate."$m.key"(m.value)\n  }\n}\n` },
    { cls: "V8b GString call name + closure", src: `class A {\n  def f(c) {\n    "\${c.fullName}"(c.clazz) { bean ->\n      bean.autowire = true\n    }\n  }\n}\n` },
    { cls: "V9 array-typed declaration", src: `class A {\n  def f(e) {\n    String[] springProfile = e.getProperty("p", String[])\n    return springProfile\n  }\n}\n` },
    { cls: "V10 generic class-literal arg", src: `class A {\n  def f(e, p) {\n    return e.getProperty(p, List<String>, [] as List<String>).findAll({ it })\n  }\n}\n` },
    { cls: "V11a primitive as expr (==)", src: `class A {\n  def f(t) {\n    if (t == Boolean || t == boolean) return false\n    return true\n  }\n}\n` },
    { cls: "V11b primitive as arg", src: `class A {\n  def f(c) {\n    return c.getMethod("setActive", boolean)\n  }\n}\n` },
    { cls: "V12 string receiver + assert in closure", src: `class A {\n  def f(m) {\n    'groovy'.each { assert manager.getCache(it) }\n  }\n}\n` },
    { cls: "V13 explicit generic method call", src: `import java.util.Collections\nclass A {\n  def f() {\n    return Collections.<String> emptySet()\n  }\n}\n` },
    { cls: "V14 exclusive range", src: `class A {\n  def f(seq, i, d) {\n    List gram = seq[i..<(i + d)]\n    return gram\n  }\n}\n` },
    { cls: "V15 string-named def", src: `class A {\n  def "a bean named after a default method does not get processed"() {\n    expect:\n    true\n  }\n}\n` },
    { cls: "V16 spec class minimal", src: `package grails.async\nimport spock.lang.Specification\nclass PromiseSpec extends Specification {\n  void "test promise"() {\n    expect:\n    true\n  }\n}\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) rows.push(`  ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 70))}`); for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) } }
      walk(tree.rootNode)
      console.log(rows.slice(0, 4).join("\n"))
    }
  }
}
main()
