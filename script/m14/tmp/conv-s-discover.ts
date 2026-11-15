import * as fs from "fs"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-scala.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealScalaAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.scala")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("fq-call", [
    "package com.mycompany.app",
    "class A {",
    "  def run(): Unit = {",
    "    com.mycompany.Service.doWork()",
    "  }",
    "}",
  ])
  run("write+read", [
    "class W {",
    "  var x: Int = 0",
    "  def set(v: Int): Unit = { x = v }",
    "  def get(): Int = x",
    "}",
  ])
  run("chain+dup+string", [
    "class Inner { val deeper = new Deeper }",
    "class Deeper { val leaf: Int = 1 }",
    "class C {",
    "  val inner = new Inner",
    "  def read(): Int = inner.deeper.leaf",
    "  def foo(): Int = 1",
    "  def foo(): Int = 2",
    "  def go(): Unit = { log(\"save\") }",
    "  def log(m: String): Unit = ()",
    "}",
  ])
  run("spring", [
    "import org.springframework.boot.autoconfigure.SpringBootApplication",
    "class App",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
