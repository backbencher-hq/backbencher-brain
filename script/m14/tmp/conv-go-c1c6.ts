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
  // C6: selector chain read a.b.c
  const src = "package main\ntype Inner struct{ deeper Deeper }\ntype Deeper struct{ leaf int }\nfunc read(inner Inner) int {\n  return inner.deeper.leaf\n}\n"
  const r: any = az.analyze(parser.parse(src).rootNode, src, "p.go")
  process.stdout.write("chain: " + JSON.stringify((r.relationships ?? []).filter((e: any) => e.type === "uses").map((e: any) => e.source + "->" + e.target)) + "\n")
  // C1: fq third-party call
  const src2 = "package main\nfunc run() {\n  com.mycompany.Service.doWork()\n}\n"
  const t2 = parser.parse(src2)
  process.stdout.write("C1 parse (invalid go, expected error): " + (t2.rootNode as any).hasError + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
