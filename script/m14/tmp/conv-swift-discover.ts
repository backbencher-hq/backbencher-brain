import * as fs from "fs"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-swift.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealSwiftAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.swift")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "class W {",
    "  var x = 0",
    "  func set(v: Int) {",
    "    x = v",
    "  }",
    "  func get() -> Int {",
    "    return x",
    "  }",
    "}",
  ])
  run("chain+dup", [
    "class Inner { var deeper = Deeper() }",
    "class Deeper { var leaf = 1 }",
    "class Ch {",
    "  var inner = Inner()",
    "  func read() -> Int {",
    "    return inner.deeper.leaf",
    "  }",
    "  func foo() -> Int { return 1 }",
    "  func foo() -> Int { return 2 }",
    "}",
  ])
  run("swiftui", [
    "import SwiftUI",
    "struct ContentView: View {",
    "  var body: some View { Text(\"hi\") }",
    "}",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
