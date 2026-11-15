import * as fs from "fs"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-kotlin.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealKotlinAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const res: any = az.analyze(parser.parse(source).rootNode, source, "probe.kt")
    process.stdout.write("=== " + name + " ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + " complexity: " + JSON.stringify(res.metadata?.complexity) + "\n")
  }

  run("writes+reads", [
    "class W {",
    "  var x: Int = 0",
    "  fun set(v: Int) {",
    "    x = v",
    "  }",
    "  fun get(): Int {",
    "    return x",
    "  }",
    "}",
  ])
  run("chain+dup", [
    "class C {",
    "  val inner = Inner()",
    "  fun read(): Int {",
    "    return inner.deeper.leaf",
    "  }",
    "  fun foo(): Int { return 1 }",
    "  fun foo(): Int { return 2 }",
    "}",
  ])
  run("spring", [
    "import org.springframework.boot.autoconfigure.SpringBootApplication",
    "class App",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
