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
  const source = "import org.springframework.boot.autoconfigure.SpringBootApplication;\npublic class App {}\n"
  const res: any = az.analyze(parser.parse(source).rootNode, source, "probe.java")
  process.stdout.write("detectedFrameworks: " + JSON.stringify(res.metadata.detectedFrameworks) + "\n")
  process.stdout.write("frameworkPatterns: " + JSON.stringify(res.metadata.frameworkPatterns) + "\n")
  process.stdout.write("framework: " + JSON.stringify(res.metadata.framework) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
