import * as fs from "fs"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-java.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaAnalyzer()
  const source = [
    "public class B {",
    "  Inner inner;",
    "  static class Inner {}",
    "  int read() {",
    "    return inner;",
    "  }",
    "}",
  ].join("\n") + "\n"
  const res: any = az.analyze(parser.parse(source).rootNode, source, "probe.java")
  const uses = res.relationships.filter((e: any) => e.type === "uses")
  process.stdout.write("uses edges: " + JSON.stringify(uses.map((e: any) => e.source + "->" + e.target)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
