// script/m14/tmp/clean-127-oracle-diff.ts
//
// Mini-differential for the new clean oracle, run BEFORE the real F5 sweep so a
// systematic mismatch is triaged on a named file rather than inferred from a
// lane-wide count. Parses every .icl/.dcl under a corpus, runs
// RealCleanAnalyzer and deriveCleanEdges on the same tree, and reports
// analyzer-vs-oracle with the harness's own match semantics (label + last
// segment of the target). Uses the PINNED wasm only.
//
// Run: bun script/m14/tmp/clean-127-oracle-diff.ts [CorpusDirName]
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"
import { deriveCleanEdges } from "../differential"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] ?? "Clyde"

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const lastSegment = (name: string): string => {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
const norm = (t: string): string => lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())

const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(d, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (e.endsWith(".icl") || e.endsWith(".dcl")) files.push(p)
  }
}
walk(path.join(CORPUS, REPO))

const AUDITED = new Set(["calls", "instantiates", "implements", "references"])
let truthTotal = 0, analyzerTotal = 0, missing = 0, unexplained = 0, filesWithError = 0
const samples: string[] = []

for (const f of files.sort()) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) filesWithError++
  const res = new RealCleanAnalyzer().analyze(tree.rootNode as any, src, f)
  const truth = deriveCleanEdges(tree.rootNode).filter((e) => AUDITED.has(e.label))
  const rels = (res.relationships as any[])
    .map((r) => ({ label: String(r.type), target: String(r.target) }))
    .filter((r) => AUDITED.has(r.label))
    .filter((r, i, arr) => i === arr.findIndex((x) => x.label + "|" + x.target === r.label + "|" + r.target))
  const rel = path.relative(CORPUS, f)
  truthTotal += truth.length
  analyzerTotal += rels.length
  for (const te of truth) {
    if (!rels.some((r) => r.label === te.label && norm(r.target) === norm(te.target))) {
      missing++
      if (samples.length < 80) samples.push(`MISSING     ${rel} :: ${te.label} ${te.from} -> ${te.target}`)
    }
  }
  for (const r of rels) {
    if (!truth.some((te) => te.label === r.label && (norm(te.target) === norm(r.target) || te.target.includes(norm(r.target))))) {
      unexplained++
      if (samples.length < 80) samples.push(`UNEXPLAINED ${rel} :: ${r.label} -> ${r.target}`)
    }
  }
}

console.log(`files=${files.length} (errors=${filesWithError}) truth=${truthTotal} analyzer=${analyzerTotal} MISSING=${missing} UNEXPLAINED=${unexplained}`)
for (const s of samples) console.log(`  ${s}`)
