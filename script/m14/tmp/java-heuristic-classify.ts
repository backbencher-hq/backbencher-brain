// M49 exports-wave classification: the canonical F5 java lane flagged
// heuristicUnexplained 76 -> 81 vs a baseline pinned at M37.16 (pre-JD18/JD19).
// This probe EXACTLY replicates the differential's java lane (rootNode arg,
// label filter, site-agnostic matching vs deriveJavaEdges truth) and dumps
// the unmatched heuristic edges so the +5 delta is classified, not assumed.
import * as fs from "fs"
import * as path from "path"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"
import { deriveJavaEdges } from "../differential"
import * as WTS from "web-tree-sitter"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const normTarget = (t: string) => String(t).replace(/<.*$/, "").trim()

async function collect(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await collect(p, out)
    else if (e.name.endsWith(".java")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-java.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  const files = (await collect(REPO, [])).sort().slice(0, 60)
  const unmatched: { file: string; label: string; target: string; conf: number }[] = []
  let relTotal = 0
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const relPath = path.relative(REPO, f)
    let root
    try { root = parser.parse(content).rootNode } catch { continue }
    if (!root) continue
    const analyzer = new RealJavaAnalyzer()
    const result: any = await analyzer.analyze(root, content, relPath, undefined)
    const rels = (result.relationships ?? [])
      .map((r: any) => ({
        label: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
        confidence: typeof r.confidence === "number" ? r.confidence : 1,
      }))
      .filter((r: any) => ["extends", "implements", "instantiates", "overrides", "calls", "references"].includes(r.label))
      .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })
    relTotal += rels.length
    const truth = deriveJavaEdges(root)
    for (const r of rels) {
      const hit = truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
      if (!hit && r.confidence < 0.7) unmatched.push({ file: path.basename(f), ...r })
    }
  }
  console.log("files:", files.length, "analyzer rels (filtered+dedup):", relTotal)
  console.log("unmatched heuristic (<0.7):", unmatched.length)
  const byLabel: Record<string, number> = {}
  for (const u of unmatched) byLabel[u.label] = (byLabel[u.label] ?? 0) + 1
  console.log("by label:", JSON.stringify(byLabel))
  for (const u of unmatched.slice(0, 20)) console.log(` ${u.file} ${u.label} -> ${u.target} conf=${u.conf}`)
}
main().catch(e => { console.error(e); process.exit(1) })
