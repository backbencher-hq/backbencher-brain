import * as fs from "fs"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-dart.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealDartAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.dart")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "class W {",
    "  int x = 0;",
    "  void set(int v) {",
    "    x = v;",
    "  }",
    "  int get() {",
    "    return x;",
    "  }",
    "}",
  ])
  run("chain+dup", [
    "class Inner { Deeper deeper = Deeper(); }",
    "class Deeper { int leaf = 1; }",
    "class Ch {",
    "  Inner inner = Inner();",
    "  int read() {",
    "    return inner.deeper.leaf;",
    "  }",
    "  int foo() { return 1; }",
    "  int foo() { return 2; }",
    "}",
  ])
  run("flutter", [
    "import 'package:flutter/material.dart';",
    "class MyWidget extends StatelessWidget {",
    "  @override",
    "  Widget build(BuildContext context) => Container();",
    "}",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
