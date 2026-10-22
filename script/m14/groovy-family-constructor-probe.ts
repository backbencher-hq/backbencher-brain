/**
 * script/m14/groovy-family-constructor-probe.ts
 *
 * THE CONSTRUCTOR-NAME QUESTION, MEASURED ACROSS THE JVM FAMILY.
 *
 * THE QUESTION. The groovy lane's analyzer names a constructor the literal `constructor`
 * (its own comment cites java/kotlin/scala as the family convention), while three of the
 * lane's own fixtures demand the CLASS name (`Alpha`, `Beta`, `Split`) — and the same
 * fixture set demands the `contains` edge `Split -> Split`, which is only meaningful if the
 * constructor's name IS the class name.
 *
 * ⇒ THE FAMILY IS MEASURED, NOT ASSUMED: the same constructor shape is run through the java,
 * kotlin, scala and groovy analyzers and the constructor SYMBOL is printed for each, with its
 * name, its kind and its owner.
 *
 * WHAT THIS IS NOT. It is not an oracle and it decides nothing by itself — it is the EVIDENCE
 * the lane's ruling is written against. The m12 hand-audited truth files are a SECOND
 * authority and are read separately.
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
    src: `class Foo {\n  Foo() {}\n  Foo(String label) {}\n}\n`,
  },
  {
    lang: "kotlin",
    file: "Foo.kt",
    analyzerFile: "real-kotlin-analyzer",
    className: "RealKotlinAnalyzer",
    wasm: "tree-sitter-kotlin.wasm",
    src: `class Foo {\n  constructor() {}\n  constructor(label: String) {}\n}\n`,
  },
  {
    lang: "scala",
    file: "Foo.scala",
    analyzerFile: "real-scala-analyzer",
    className: "RealScalaAnalyzer",
    wasm: "tree-sitter-scala.wasm",
    src: `class Foo {\n  def this() {}\n  def this(label: String) {}\n}\n`,
  },
  {
    lang: "groovy",
    file: "Foo.groovy",
    analyzerFile: "real-groovy-analyzer",
    className: "RealGroovyAnalyzer",
    wasm: "tree-sitter-groovy.wasm",
    src: `class Foo {\n  Foo() {}\n  Foo(String label) {}\n}\n`,
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
    console.log(`### ${c.lang}`)
    for (const s of (result.symbols ?? [])) {
      const kind = String(s.kind)
      if (!/constructor/i.test(kind)) continue
      console.log(`  SYMBOL kind=${kind} name="${s.name}" owner=${s.ownerName ?? "-"} line=${s.range?.startLine}`)
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
