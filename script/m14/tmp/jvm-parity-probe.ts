import * as WTS from "web-tree-sitter"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const SNIPPETS: Record<string, Record<string, string>> = {
  override: {
    java: `class B {\n public void greet(String n) {}\n}\nclass S extends B {\n @Override public void greet(String n) {}\n}`,
    kotlin: `open class B {\n open fun greet(n: String) {}\n}\nclass S : B() {\n override fun greet(n: String) {}\n}`,
    groovy: `class B {\n void greet(String n) {}\n}\nclass S extends B {\n @Override void greet(String n) {}\n}`,
    scala: `class B {\n def greet(n: String): Unit = {}\n}\nclass S extends B {\n override def greet(n: String): Unit = {}\n}`,
  },
  implicit: {
    java: `class B {\n public void greet(String n) {}\n}\nclass S extends B {\n public void greet(String n) {}\n}`,
    kotlin: `open class B {\n open fun greet(n: String) {}\n}\nclass S : B() {\n override fun greet(n: String) {}\n}`,
    groovy: `class B {\n void greet(String n) {}\n}\nclass S extends B {\n void greet(String n) {}\n}`,
    scala: `trait B {\n def greet(n: String): Unit\n}\nclass S extends B {\n def greet(n: String): Unit = {}\n}`,
  },
  ctor: {
    java: `class A {\n public A() {}\n public void m() { helper(); }\n void helper() {}\n}`,
    kotlin: `class A {\n constructor() {}\n fun m() { helper() }\n fun helper() {}\n}`,
    groovy: `class A {\n A() {}\n def m() { helper() }\n def helper() {}\n}`,
    scala: `class A {\n def m(): Unit = { helper() }\n def helper(): Unit = {}\n}`,
  },
  traitexport: {
    java: `interface T {\n void foo();\n}`,
    kotlin: `interface T {\n fun foo()\n}`,
    groovy: `trait T {\n void foo() {}\n}`,
    scala: `trait T {\n def foo(): Unit\n}`,
  },
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const exts: Record<string, string> = { java: "java", kotlin: "kotlin", groovy: "groovy", scala: "scala" }
  const ans: Record<string, any> = {
    java: new RealJavaAnalyzer() as any,
    kotlin: new RealKotlinAnalyzer() as any,
    groovy: new RealGroovyAnalyzer() as any,
    scala: new RealScalaAnalyzer() as any,
  }
  for (const [scenario, srcs] of Object.entries(SNIPPETS)) {
    console.log("##### " + scenario)
    for (const [lang, src] of Object.entries(srcs)) {
      const wasm = lang === "java" ? "tree-sitter-java.wasm" : lang === "kotlin" ? "tree-sitter-kotlin.wasm" : lang === "groovy" ? "tree-sitter-groovy.wasm" : "tree-sitter-scala.wasm"
      const { readFileSync } = await import("fs")
      const { join } = await import("path")
      const grammar = await L.load(readFileSync(join("/home/ishaq2321/mcp/backbencher-brain/wasm", wasm)))
      const p = new P(); p.setLanguage(grammar)
      const root = p.parse(src).rootNode
      const r = await ans[lang].analyze(root, src, `T.${exts[lang]}`, undefined)
      const rel = (r.relationships ?? []).map((x: any) => `${x.source} -${x.type}@${x.confidence}-> ${x.target}`)
      const sym = (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}${s.ownerName ? "(" + s.ownerName + ")" : ""}`)
      const ex = (r.exports ?? []).map((e: any) => e.name)
      console.log(`--- ${lang} symbols: ${JSON.stringify(sym)}`)
      console.log(`--- ${lang} exports: ${JSON.stringify(ex)}`)
      for (const e of rel) console.log(`--- ${lang} rel: ${e}`)
    }
  }
}
main()
