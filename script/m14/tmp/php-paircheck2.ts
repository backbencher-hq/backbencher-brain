import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"
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
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const dir = process.argv[2] ?? "/tmp/php-batt2"
  for (const f of fs.readdirSync(dir).sort()) {
    const src = fs.readFileSync(path.join(dir, f), "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const r: any = await new RealPhpAnalyzer().analyze(root, src, f)
    const rels = (r.relationships ?? [])
      .map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target), conf: x.confidence ?? 1 }))
      .filter((x: any) => ["extends","implements","instantiates","calls","uses","references"].includes(x.label))
    const truth = mod.derivePhpEdges(root)
    let bad = 0
    for (const te of truth) {
      if (!rels.some((x: any) => x.label === te.label && norm(x.target) === norm(te.target))) { console.log("MISSING", f, te.label, "->", te.target); bad++ }
    }
    for (const x of rels) {
      if (x.conf < 0.7) continue
      if (!truth.some((te: any) => te.label === x.label && (norm(te.target) === norm(x.target) || String(te.target).includes(norm(x.target))))) { console.log("UNEXPLAINED", f, x.label, "->", x.target); bad++ }
    }
    if (bad === 0) console.log("OK", f)
  }
}
main()
