import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
async function main(): Promise<void> {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  if (!gl) { console.error("PROBE INVALID: grammar did not load"); process.exit(2) }
  const p = new P(); p.setLanguage(gl)
  const f = process.argv[2]
  const src = fs.readFileSync(f, "utf8")
  const res: any = new RealScalaAnalyzer().analyze(p.parse(src).rootNode, src, f)
  let n = 0
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "instantiates") continue
    n++
    const t = String(r.target ?? "")
    if (t.trim() === "" || t === "(expr)") console.log(`EMPTY  instantiates ${String(r.source)} -> ${JSON.stringify(t)}  line=${r.line_number} meta=${JSON.stringify(r.metadata)}`)
  }
  console.log(`total instantiates edges: ${n}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
