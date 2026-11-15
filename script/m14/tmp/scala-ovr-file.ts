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
const f = process.argv[2]
const src = fs.readFileSync(f, "utf8")
const res: any = new RealScalaAnalyzer().analyze(p.parse(src).rootNode, src, f)
const want = process.argv[3]
console.log("--- symbols whose name matches ---")
for (const s of res.symbols ?? []) {
  if (want && !String(s.name).includes(want)) continue
  if (want && s.kind !== "method") continue
  console.log(`  ${s.kind.padEnd(8)} ${String(s.name).padEnd(18)} owner=${String(s.ownerName ?? "-").padEnd(16)} line=${s.range?.startLine} params=${JSON.stringify((s.parameters ?? []).map((x: any) => `${x.name}:${x.type}`))} super=${JSON.stringify(s.metadata?.superTypes ?? null)}`)
}
console.log("--- overrides edges ---")
for (const r of res.relationships ?? []) {
  if (String(r.type) !== "overrides") continue
  if (want && !String(r.source).includes(want)) continue
  console.log(`  ${String(r.source).padEnd(34)} -> ${String(r.target).padEnd(34)} conf=${r.confidence} reason=${r.metadata?.reasonCode}`)
}
