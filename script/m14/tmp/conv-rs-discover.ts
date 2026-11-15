import * as fs from "fs"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-rust.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealRustAnalyzer()

  const run = (name: string, lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    const res: any = az.analyze(tree.rootNode, source, "probe.rs")
    process.stdout.write("=== " + name + " (parseError=" + (tree.rootNode as any).hasError + ") ===\n")
    process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
    process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  }

  run("write+read", [
    "struct W { x: i32 }",
    "impl W {",
    "  fn set(&mut self, v: i32) {",
    "    self.x = v;",
    "  }",
    "  fn get(&self) -> i32 {",
    "    self.x",
    "  }",
    "}",
  ])
  run("chain+dup", [
    "struct Inner { deeper: Deeper }",
    "struct Deeper { leaf: i32 }",
    "fn read(inner: &Inner) -> i32 {",
    "  inner.deeper.leaf",
    "}",
    "fn foo() -> i32 { 1 }",
    "fn foo() -> i32 { 2 }",
  ])
  run("tokio", [
    "use tokio::runtime::Runtime;",
    "fn main() {}",
  ])
}
main().catch((e) => { console.error(e); process.exit(1) })
