/**
 * script/m14/groovy-family-line-anchor-probe.ts
 *
 * THE ANNOTATION-ANCHOR QUESTION, MEASURED ACROSS THE JVM FAMILY.
 *
 * THE QUESTION. A declaration may carry annotations on the lines above it
 * (`@Deprecated` / `void use()`). The groovy lane's analyzer anchors a symbol
 * at its FIRST ANNOTATION, citing a hand-audited truth file that records the
 * annotation's line; two of the lane's OWN m14 fixtures record the
 * DECLARATION's line instead (`lines-825`: class Wrapped on 19 not 18, method
 * use on 26 not 25, field label on 23 not 22; `anonymous-body-overrides`:
 * method bsonType on 23 not 22).
 *
 * ⇒ THE FAMILY IS MEASURED: the same annotated shape is run through the java,
 * kotlin, scala and groovy analyzers and the symbol's line is printed.
 *
 * WHAT THIS IS NOT. It is not an oracle and it decides nothing by itself — it
 * is the EVIDENCE the lane's ruling is written against.
 */
import path from "node:path"
import { readFileSync } from "node:fs"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? "."), "..", "..")

const CASES: Array<{ lang: string; file: string; analyzerFile: string; className: string; wasm: string; src: string }> = [
  {
    lang: "java",
    file: "Foo.java",
    analyzerFile: "real-java-analyzer",
    className: "RealJavaAnalyzer",
    wasm: "tree-sitter-java.wasm",
    src: `@Deprecated\nclass Foo {\n  @Deprecated\n  String label;\n  @Deprecated\n  void use() { }\n}\n`,
  },
  {
    lang: "kotlin",
    file: "Foo.kt",
    analyzerFile: "real-kotlin-analyzer",
    className: "RealKotlinAnalyzer",
    wasm: "tree-sitter-kotlin.wasm",
    src: `@Deprecated\nclass Foo {\n  @Deprecated\n  val label: String = ""\n  @Deprecated\n  fun use() { }\n}\n`,
  },
  {
    lang: "scala",
    file: "Foo.scala",
    analyzerFile: "real-scala-analyzer",
    className: "RealScalaAnalyzer",
    wasm: "tree-sitter-scala.wasm",
    src: `@deprecated\nclass Foo {\n  @deprecated\n  val label: String = ""\n  @deprecated\n  def use(): Unit = {}\n}\n`,
  },
  {
    lang: "groovy",
    file: "Foo.groovy",
    analyzerFile: "real-groovy-analyzer",
    className: "RealGroovyAnalyzer",
    wasm: "tree-sitter-groovy.wasm",
    src: `@Deprecated\nclass Foo {\n  @Deprecated\n  String label\n  @Deprecated\n  void use() { }\n}\n`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  for (const c of CASES) {
    const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", c.wasm)))
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
    console.log(`### ${c.lang}   (source: class=2, label=4, use=6; the ANNOTATION is the line before each)`)
    for (const s of (result.symbols ?? [])) {
      console.log(`  SYMBOL kind=${String(s.kind)} name="${s.name}" owner=${s.ownerName ?? "-"} line=${s.range?.startLine}`)
    }
    for (const r of (result.relationships ?? [])) {
      if (r.type !== "contains") continue
      console.log(`  contains[${r.source}->${r.target}]@${r.line_number}`)
    }
    tree.delete()
    console.log("")
  }
}

main()
