import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
function lastSegment(t: string): string {
  const parts = String(t).replace(/^<\s*/, "").split(/::|\\|\./).filter(Boolean)
  return parts[parts.length - 1] ?? t
}
function normTarget(t: string): string {
  return lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}
const COMPARED = new Set(["extends", "implements", "instantiates", "calls", "uses", "references"])  // overrides: external-base 0.5 guesses stay oracle-silent by design (PHP-O2); lanes filter confidence<0.7
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const dir = process.argv[2] ?? "/tmp/php-batt2"
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".php")).sort()
  let bad = 0
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(content).rootNode
    const r: any = await new RealPhpAnalyzer().analyze(root, content, f)
    const seen = new Set<string>()
    const rels = (r.relationships ?? [])
      .map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target) }))
      .filter((x: any) => COMPARED.has(x.label))
      .filter((x: any) => { const k = x.label + "|" + normTarget(x.target); if (seen.has(k)) return false; seen.add(k); return true })
    const truth = mod.derivePhpEdges(root).filter((x: any) => COMPARED.has(String(x.label).toLowerCase()))
      .map((x: any) => ({ label: String(x.label).toLowerCase(), target: String(x.target) }))
    const tseen = new Set<string>()
    const tnorm = truth.filter((x: any) => { const k = x.label + "|" + normTarget(x.target); if (tseen.has(k)) return false; tseen.add(k); return true })
    const missing = tnorm.filter((te: any) => !rels.some((x: any) => x.label === te.label && normTarget(x.target) === normTarget(te.target)))
    const extra = rels.filter((x: any) => !tnorm.some((te: any) => te.label === x.label && normTarget(te.target) === normTarget(x.target)))
    if (missing.length === 0 && extra.length === 0) {
      console.log(`${f} OK rels=${rels.length} ora=${tnorm.length}`)
    } else {
      bad++
      console.log(`${f} DIVERGE rels=${rels.length} ora=${tnorm.length}`)
      for (const m of missing.slice(0, 12)) console.log(`  MISSING ${m.label} -> ${m.target}`)
      for (const m of extra.slice(0, 12)) console.log(`  EXTRA   ${m.label} -> ${m.target}`)
    }
  }
  console.log(bad === 0 ? "BATTERY GREEN" : `BATTERY DIVERGENT files=${bad}`)
}
main()
