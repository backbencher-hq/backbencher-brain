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
  const src = "fn foo() -> i32 {\n  1\n}\nfn foo() -> i32 {\n  2\n}\n"
  const r: any = az.analyze(parser.parse(src).rootNode, src, "p.rs")
  const foos = (r.symbols ?? []).filter((s: any) => s.name === "foo")
  process.stdout.write("C4 foo count=" + foos.length + " lines=" + JSON.stringify(foos.map((s: any) => s.range?.startLine)) + "\n")
  const src3 = "mod m {\n  pub fn target() {}\n}\n"
  const t = parser.parse(src3)
  const r3: any = az.analyze(t.rootNode, src3, "p3.rs")
  const tg = (r3.symbols ?? []).find((s: any) => s.name === "target")
  process.stdout.write("C3 target line=" + (tg ? tg.range?.startLine : "MISSING") + " expected=2\n")
  const src2 = "fn run() {\n  service.do_work();\n}\n"
  const r2: any = az.analyze(parser.parse(src2).rootNode, src2, "p2.rs")
  process.stdout.write("C1 do_work edges: " + JSON.stringify((r2.relationships ?? []).filter((e: any) => String(e.target).includes("do_work")).map((e: any) => e.type + ":" + e.target)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
