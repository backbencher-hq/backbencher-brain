// Dump the raw java analyzer result shape for the convergence probe sources,
// so probe asserts are written against the REAL contract (labels, keys).
import * as fs from "fs"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-java.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealJavaAnalyzer()

  const dump = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.java")
    const edges = (res.relationships ?? []).map((e: any) => e.label + " [" + e.source + " -> " + e.target + "]")
    process.stdout.write("=== " + name + " ===\n")
    process.stdout.write("labels: " + JSON.stringify([...new Set((res.relationships ?? []).map((e: any) => e.label))]) + "\n")
    process.stdout.write("edges(" + edges.length + "): " + edges.join(" | ") + "\n")
    process.stdout.write("metadata keys: " + JSON.stringify(Object.keys(res.metadata ?? {})) + "\n")
    process.stdout.write("frameworks: " + JSON.stringify(res.metadata?.frameworks) + "\n")
    process.stdout.write("top-level keys: " + JSON.stringify(Object.keys(res)) + "\n")
    process.stdout.write("\n")
  }

  dump("C1 fq-call", [
    "package com.mycompany.app;",
    "public class A {",
    "  void run() {",
    "    com.mycompany.Service.doWork();",
    "  }",
    "}",
  ])
  dump("C2+/C6 reads", [
    "public class R {",
    "  int x;",
    "  Inner inner;",
    "  static class Inner { Deeper deeper; }",
    "  static class Deeper { int leaf; }",
    "  int get() {",
    "    return this.x;",
    "  }",
    "  int read() {",
    "    return inner.deeper.leaf;",
    "  }",
    "}",
  ])
  dump("C7 spring", [
    "import org.springframework.boot.autoconfigure.SpringBootApplication;",
    "public class App {}",
  ])
}

main().catch((e) => { console.error(e); process.exit(1) })
