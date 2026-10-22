/**
 * script/m14/groovy-family-exports-probe.ts
 *
 * THE EXPORTS CONTRACT, MEASURED ACROSS THE JVM FAMILY.
 *
 * THE QUESTION. Two of this lane's own fixtures disagree about the exports SET:
 *   groovy/exports-publication       REQUIRES `exports[com.acme.pub->scriptHelper]`
 *                                    (a top-level `def` script method)
 *   groovy/exports-publication-edge  FORBIDS `exports[...->topLevelHelper]`
 *                                    ("a top-level def method is a method of the
 *                                     SCRIPT CLASS, not an importable unit")
 * and they disagree about the METADATA vocabulary too (`exported_type` /
 * `exported_function` versus `groovy_exportable_unit` / `exportForm`).
 *
 * ⇒ THE FAMILY IS MEASURED: the same file shape — a public top-level type, a
 * NON-public top-level type, a nested type, a member, and a top-level script
 * method — is run through the java, kotlin, scala and groovy analyzers and
 * every `exports` row is printed with its source, its target and its metadata.
 *
 * WHAT THIS IS NOT. It is not an oracle and it decides nothing by itself — it
 * is the EVIDENCE the lane's ruling is written against. The M49 exports
 * convergence (reviews/jvm-closure-audit.md) is read separately.
 */
import path from "node:path"
import { readFileSync } from "node:fs"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? "."), "..", "..")

const CASES: Array<{ lang: string; file: string; analyzerFile: string; className: string; wasm: string; src: string }> = [
  {
    lang: "java",
    file: "Pub.java",
    analyzerFile: "real-java-analyzer",
    className: "RealJavaAnalyzer",
    wasm: "tree-sitter-java.wasm",
    src: `package com.acme.pub;\n\npublic class Publisher {\n  public String describe() { return ""; }\n  public static class Helper {}\n}\n\nclass Hidden {}\n\npublic class Other {\n  public static void helper() {}\n}\n`,
  },
  {
    lang: "kotlin",
    file: "Pub.kt",
    analyzerFile: "real-kotlin-analyzer",
    className: "RealKotlinAnalyzer",
    wasm: "tree-sitter-kotlin.wasm",
    src: `package com.acme.pub\n\nclass Publisher {\n  fun describe(): String = ""\n  class Helper\n}\n\nprivate class Hidden\n\nfun scriptHelper(s: String): String = s\n`,
  },
  {
    lang: "scala",
    file: "Pub.scala",
    analyzerFile: "real-scala-analyzer",
    className: "RealScalaAnalyzer",
    wasm: "tree-sitter-scala.wasm",
    src: `package com.acme.pub\n\nclass Publisher {\n  def describe(): String = ""\n  class Helper\n}\n\nprivate class Hidden\n\nobject Other {\n  def scriptHelper(s: String): String = s\n}\n`,
  },
  {
    lang: "groovy",
    file: "Pub.groovy",
    analyzerFile: "real-groovy-analyzer",
    className: "RealGroovyAnalyzer",
    wasm: "tree-sitter-groovy.wasm",
    src: `package com.acme.pub\n\nclass Publisher {\n  String describe() { return "" }\n  static class Helper {}\n}\n\nprivate class Hidden {}\n\ndef scriptHelper(String s) { return s }\n`,
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
    for (const r of (result.relationships ?? [])) {
      if (r.type !== "exports") continue
      console.log(`  exports[${r.source}->${r.target}] conf=${r.confidence} meta=${JSON.stringify(r.metadata)}`)
    }
    console.log("")
    tree.delete()
  }
}

main()
