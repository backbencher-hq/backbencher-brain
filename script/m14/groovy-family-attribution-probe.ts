/**
 * script/m14/groovy-family-attribution-probe.ts
 *
 * THE ATTRIBUTION QUESTION, MEASURED ACROSS THE JVM FAMILY.
 *
 * THE QUESTION. The groovy lane's analyzer attributes a declared type to the DECLARING TYPE
 * (the class), never to the method that mentions it. Its own fixtures say the opposite — the
 * `type-usage-graph` fixture pins `references from m2 to Map with relationshipType return_type`
 * and records "M37 #597 KAD6 sweep: return-type refs now source to the METHOD (pre-fix: the
 * enclosing class/Global) ... kotlin parity". The analyzer's comment says the class attribution
 * was adopted later, against a 79-ROW HAND-AUDITED truth that has no method-scoped reference row.
 *
 * ⇒ A DOC AND A FIXTURE DISAGREE, AND THE FAMILY IS NOT UNIFORM ON PAPER, SO THE QUESTION IS
 * MEASURED: the SAME declaration shape is run through the java, kotlin, scala and groovy
 * analyzers, and the SOURCE of the declared-type reference is printed for each.
 *
 * WHAT THIS IS NOT. It is not an oracle and it does not decide the contract — it is the
 * EVIDENCE the lane's ruling is written against. The shape is the same in all four languages:
 * a method whose return type and whose parameter type are named.
 */
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? "."), "..", "..")

const CASES: Array<{ lang: string; file: string; analyzerFile: string; className: string; src: string }> = [
  {
    lang: "java",
    file: "Foo.java",
    analyzerFile: "real-java-analyzer",
    className: "RealJavaAnalyzer",
    src: `class Foo {\n  String greet(String value) { return value; }\n  java.util.List<String> findAll() { return null; }\n}\n`,
  },
  {
    lang: "kotlin",
    file: "Foo.kt",
    analyzerFile: "real-kotlin-analyzer",
    className: "RealKotlinAnalyzer",
    src: `class Foo {\n  fun greet(value: String): String { return value }\n  fun findAll(): java.util.List<String> = TODO()\n}\n`,
  },
  {
    lang: "scala",
    file: "Foo.scala",
    analyzerFile: "real-scala-analyzer",
    className: "RealScalaAnalyzer",
    src: `class Foo {\n  def greet(value: String): String = value\n  def findAll(): java.util.List[String] = ??\n}\n`,
  },
  {
    lang: "groovy",
    file: "Foo.groovy",
    analyzerFile: "real-groovy-analyzer",
    className: "RealGroovyAnalyzer",
    src: `class Foo {\n  String greet(String value) { return value }\n  java.util.List<String> findAll() { return null }\n}\n`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  for (const c of CASES) {
    const wasmName = c.lang === "java" ? "tree-sitter-java.wasm"
      : c.lang === "kotlin" ? "tree-sitter-kotlin.wasm"
      : c.lang === "scala" ? "tree-sitter-scala.wasm"
      : "tree-sitter-groovy.wasm"
    const grammar = await Language.load((await import("node:fs")).readFileSync(path.join(ROOT, "wasm", wasmName)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const tree = parser.parse(c.src)
    const mod: any = await import(`../../src/ast/${c.analyzerFile}`)
    const analyzer = new mod[c.className]()
    const ctor: any = analyzer?.constructor
    if (typeof ctor?.setGrammar === "function") {
      try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* no grammar handoff */ }
    }
    const result = await analyzer.analyze(tree.rootNode, c.src, `probe/${c.file}`)
    console.log(`### ${c.lang}`)
    for (const r of (result.relationships ?? [])) {
      if (r.type !== "references") continue
      const mt = r.metadata?.relationshipType
      if (mt !== "declared_type" && mt !== "return_type" && mt !== "cast_type" && mt !== "declaredOn") continue
      console.log(`  ${r.type}[${r.source ?? r.from}->${r.target ?? r.to}] {relationshipType=${mt}, declaredOn=${r.metadata?.declaredOn}}`)
    }
    tree.delete()
    console.log("")
  }
}

main()
