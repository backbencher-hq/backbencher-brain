import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealGroovyAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.groovy")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("fq-call", [
    "package com.mycompany.app",
    "class A {",
    "  void run() {",
    "    com.mycompany.Service.doWork()",
    "  }",
    "}",
  ])
  run("write+read", [
    "class W {",
    "  int x = 0",
    "  void set(int v) { x = v }",
    "  int get() { return x }",
    "}",
  ])
  run("chain+dup+string", [
    "class Inner { def deeper = new Deeper() }",
    "class Deeper { int leaf = 1 }",
    "class C {",
    "  def inner = new Inner()",
    "  int read() { return inner.deeper.leaf }",
    "  def foo() { 1 }",
    "  def foo() { 2 }",
    "  def go() { log(\"save\") }",
    "  def log(m) {}",
    "}",
  ])
  run("grails", [
    "import grails.core.GrailsApplication",
    "class App",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
