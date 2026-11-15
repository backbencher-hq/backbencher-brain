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
    "public class Ch {",
    "  Inner inner;",
    "  static class Inner { Deeper deeper; }",
    "  static class Deeper { int leaf; }",
    "  int read() {",
    "    return inner.deeper.leaf;",
    "  }",
    "}",
  ].join("\n") + "\n"
  const res: any = az.analyze(parser.parse(source).rootNode, source, "probe.java")
  for (const e of res.relationships) {
    process.stdout.write((e.type ?? "null") + "  " + (e.source ?? e.from) + " -> " + (e.target ?? e.to) + "\n")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
