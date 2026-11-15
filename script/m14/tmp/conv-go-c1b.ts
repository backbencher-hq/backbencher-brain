import * as fs from "fs"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-go.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealGoAnalyzer()
  const src2 = "package main\nfunc run() {\n  com.mycompany.Service.doWork()\n}\n"
  const r2: any = az.analyze(parser.parse(src2).rootNode, src2, "p.go")
  const hits = (r2.relationships ?? []).filter((e: any) => String(e.target).includes("doWork"))
  process.stdout.write("C1 doWork edges: " + JSON.stringify(hits.map((e: any) => e.type + ":" + e.source + "->" + e.target)) + "\n")
  // dup funcs
  const src3 = "package main\nfunc foo() int {\n  return 1\n}\nfunc foo() int {\n  return 2\n}\n"
  const r3: any = az.analyze(parser.parse(src3).rootNode, src3, "p2.go")
  const foos = (r3.symbols ?? []).filter((s: any) => s.name === "foo")
  process.stdout.write("C4 foo count=" + foos.length + " lines=" + JSON.stringify(foos.map((s: any) => s.range?.startLine)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
