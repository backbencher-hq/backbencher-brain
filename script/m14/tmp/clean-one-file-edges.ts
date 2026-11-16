// script/m14/tmp/clean-one-file-edges.ts
//
// One-file edge dump for adjudicating an oracle/analyzer disagreement with the
// `from` visible. `clean-127-oracle-trace.ts` is hardcoded to Clyde and prints
// constructor-application ancestry; this one takes any corpus + relative path
// and prints both audited edge lists side by side.
//
// Run: bun script/m14/tmp/clean-one-file-edges.ts <Corpus> <relative/path.icl>
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"
import { deriveCleanEdges } from "../differential"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "Clyde"
const rel = process.argv[3] ?? "cleantools/Util/UtilStrictLists.icl"
const full = path.join(CORPUS, repo, rel)

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const src = readFileSync(full, "utf8")
const tree = parser.parse(src)
const AUDITED = new Set(["calls", "instantiates", "implements", "references"])

const res = new RealCleanAnalyzer().analyze(tree.rootNode as any, src, full)
const analyzer = (res.relationships as any[])
  .filter((r) => AUDITED.has(String(r.type)))
  .map((r) => `${r.type} ${r.source} -> ${r.target}`)
const oracle = deriveCleanEdges(tree.rootNode)
  .filter((e) => AUDITED.has(e.label))
  .map((e) => `${e.label} ${e.from} -> ${e.target}`)

console.log(`== analyzer (${analyzer.length}) ==`)
for (const a of analyzer) console.log(`  ${a}`)
console.log(`== oracle (${oracle.length}) ==`)
for (const o of oracle) console.log(`  ${o}`)
console.log(`== analyzer-only ==`)
for (const a of analyzer) if (!oracle.includes(a)) console.log(`  ${a}`)
console.log(`== oracle-only ==`)
for (const o of oracle) if (!analyzer.includes(o)) console.log(`  ${o}`)
