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
  const src = "class D {\n  int foo() { return 1; }\n  int foo() { return 2; }\n}\n"
  const res: any = az.analyze(parser.parse(src).rootNode, src, "probe.dart")
  const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
  process.stdout.write("foo count=" + foos.length + " lines=" + JSON.stringify(foos.map((s: any) => s.range?.startLine)) + "\n")
  // C1: dotted call
  const src2 = "class A {\n  void run() {\n    Logger.doWork();\n  }\n}\n"
  const r2: any = az.analyze(parser.parse(src2).rootNode, src2, "probe2.dart")
  process.stdout.write("doWork edges: " + JSON.stringify((r2.relationships ?? []).filter((e: any) => String(e.target).includes("doWork")).map((e: any) => e.type + ":" + e.target)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
