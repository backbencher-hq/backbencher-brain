import * as fs from "fs"
import * as path from "path"
import { RealObjectiveCAnalyzer } from "../../../src/ast/real-objective-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
function norm(t: string): string {
  const parts = String(t).replace(/^<\s*/, "").split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? t
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const file = process.argv[2]
  const src = fs.readFileSync(file, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const r: any = await new RealObjectiveCAnalyzer().analyze(root, src, "t.m")
  const rels = (r.relationships ?? [])
    .map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target), conf: x.confidence ?? 1 }))
    .filter((x: any) => ["extends","implements","instantiates","overrides","calls","uses","references"].includes(x.label))
  const truth = mod.deriveObjcEdges(root)
  for (const te of truth) {
    if (!rels.some((x: any) => x.label === te.label && norm(x.target) === norm(te.target)))
      console.log("MISSING", te.label, "->", te.target)
  }
  for (const x of rels) {
    if (x.conf < 0.7) continue
    if (!truth.some((te: any) => te.label === x.label && (norm(te.target) === norm(x.target) || String(te.target).includes(norm(x.target)))))
      console.log("UNEXPLAINED", x.label, "->", x.target)
  }
  console.log("done " + file)
}
main()
