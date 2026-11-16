// Measure the php header-reads fixture on BOTH sides, printing each side's
// edges so a divergence is visible rather than asserted.
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = process.argv[2] ?? path.join(ROOT, "validation/m14/fixtures/php/header-reads.php")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const mod: any = await import("../../m14/differential")
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const r: any = await new RealPhpAnalyzer().analyze(root, src, path.basename(FILE))
  const lineOf = (startIndex: number) => src.slice(0, startIndex).split("\n").length
  const az = (r.relationships ?? [])
    .filter((x: any) => ["calls", "uses", "instantiates", "references", "extends", "implements", "overrides"].includes(String(x.type).toLowerCase()))
    .map((x: any) => `${String(x.type).toLowerCase()} ${x.source} -> ${x.target}`)
  const truth = mod.derivePhpEdges(root).map((t: any) => `${t.label} (expr) -> ${t.target}`)
  console.log(`--- analyzer (${az.length})`)
  for (const a of [...az].sort()) console.log("  " + a)
  console.log(`--- truth (${truth.length})`)
  for (const t of [...truth].sort()) console.log("  " + t)
  const norm = (s: string) => s.replace(/^\S+\s+/, "").replace(/^\S+\s+/, "")
  const azSet = new Set(az.map(norm))
  const trSet = new Set(truth.map(norm))
  console.log("--- analyzer-only:", JSON.stringify([...azSet].filter((x) => !trSet.has(x)).sort()))
  console.log("--- oracle-only  :", JSON.stringify([...trSet].filter((x) => !azSet.has(x)).sort()))
  void lineOf
}
main()
