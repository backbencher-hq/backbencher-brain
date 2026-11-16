// script/m14/tmp/php-backslash-census.ts — how wide is the leading-`\` defect?
//
// The phpunit FULL EXTENT draw (2907 files) reported MISSING=2 / unexplained=13,
// and every unexplained edge was `calls X -> \builtin`. The harness compares
// label+target with normTarget(), which strips generics/type-args and reduces to
// the LAST SEGMENT after `::`/`.` — it never strips a leading `\`, so a
// backslashed target can only ever be compared literally. This census asks the
// sizing question the fix depends on: over the WHOLE corpus, which labels carry a
// backslash on the analyzer side, which on the truth side, and is the mirrored
// bare spelling present on the other side (a canonicalisation mismatch) or absent
// entirely (a fabricated edge)?
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/phpunit"

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|vendor)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".php")) out.push(p)
  }
  return out
}

const COMPARED = new Set(["extends", "implements", "instantiates", "overrides", "calls", "uses", "references"])

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const mod: any = await import("../../m14/differential")
  const az: any = new RealPhpAnalyzer()
  const files = filesUnder(REPO)
  const azBS = new Map<string, number>()   // analyzer targets containing `\`
  const trBS = new Map<string, number>()   // truth targets containing `\`
  const azSites: string[] = []
  let azTotal = 0, trTotal = 0, parsed = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const p = new P()
    p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    if (root.hasError) { /* still measured: recovery shapes are the interesting ones */ }
    parsed++
    const r: any = await az.analyze(root, src, path.relative(REPO, f))
    const seen = new Set<string>()
    const rels = (r.relationships ?? [])
      .map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target) }))
      .filter((x: any) => COMPARED.has(x.label))
      .filter((x: any) => { const k = x.label + "|" + x.target; if (seen.has(k)) return false; seen.add(k); return true })
    const truth = mod.derivePhpEdges(root)
    azTotal += rels.length
    trTotal += truth.length
    const trKeys = new Set(truth.map((t: any) => t.label + "|" + t.target))
    for (const rel of rels) {
      if (!rel.target.includes("\\")) continue
      const k = rel.label + "|" + rel.target
      azBS.set(k, (azBS.get(k) ?? 0) + 1)
      if (azSites.length < 25 && !trKeys.has(k)) azSites.push(`${path.relative(REPO, f)} :: ${k}  (truth has bare? ${trKeys.has(rel.label + "|" + rel.target.replace(/^\\+/, ""))})`)
    }
    for (const t of truth) {
      const k = t.label + "|" + t.target
      if (String(t.target).includes("\\")) trBS.set(k, (trBS.get(k) ?? 0) + 1)
    }
    p.delete?.()
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`files=${parsed} analyzer-edges=${azTotal} truth-edges=${trTotal}`)
  console.log(`distinct analyzer backslash targets=${azBS.size} sites=${[...azBS.values()].reduce((a, b) => a + b, 0)}`)
  for (const [k, n] of top(azBS)) console.log(`  AZ  ${k}  x${n}`)
  console.log(`distinct truth backslash targets=${trBS.size} sites=${[...trBS.values()].reduce((a, b) => a + b, 0)}`)
  for (const [k, n] of top(trBS)) console.log(`  TR  ${k}  x${n}`)
  console.log("--- analyzer backslash edges with no literal truth counterpart (first 25):")
  for (const s of azSites) console.log("  " + s)
}
main()
