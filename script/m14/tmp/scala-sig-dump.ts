// What signature strings does the analyzer actually put in its owner-name buckets?
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
if (!gl) { console.error("PROBE INVALID"); process.exit(2) }
const parser = new P(); parser.setLanguage(gl)
const f = process.argv[2]
const src = fs.readFileSync(f, "utf8")
const res: any = new RealScalaAnalyzer().analyze(parser.parse(src).rootNode, src, f)
const want = process.argv[3]
const compactType = (t: string): string => t
const sigText = (m: any): string => "(" + (m.parameters ?? []).map((p: any) => String(p.type || "unknown")).join(",") + ")"
// group by ownerName, exactly as methodSigsByOwner does
const bucket = new Map<string, any[]>()
for (const s of res.symbols ?? []) {
  if (String(s.kind) !== "method" || !s.ownerName) continue
  if (s.name !== want) continue
  if (!bucket.has(s.ownerName)) bucket.set(s.ownerName, [])
  bucket.get(s.ownerName)!.push(s)
}
for (const [owner, members] of bucket) {
  console.log(`\nowner "${owner}"  (${members.length} member(s) named ${want})`)
  for (const m of members) {
    console.log(`   line=${String(m.range?.startLine).padStart(4)}  sigText=${sigText(m)}  params=${JSON.stringify((m.parameters ?? []).map((p: any) => `${p.name}:${p.type}`))}`)
  }
}
