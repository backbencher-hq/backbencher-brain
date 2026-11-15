import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
const src = fs.readFileSync("/tmp/opencode/prof/big.scala", "utf8")
const root = p.parse(src).rootNode
const a = new RealScalaAnalyzer()
const t = performance.now()
const r = a.analyze(root, src, "/tmp/opencode/prof/big.scala")
console.log("ms", (performance.now() - t).toFixed(0), "symbols", r.symbols?.length, "rels", r.relationships?.length)
