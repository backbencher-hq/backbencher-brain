// script/m14/tmp/clean-127-oracle-trace.ts
//
// One-file triage of an oracle/analyzer disagreement: prints the analyzer's
// audited edges, the oracle's, and the s-expression of every node whose head is
// a `constructor` application (the class of the 19 UNEXPLAINED `instantiates`),
// with its ancestor chain — so a gate difference is read off the tree.
//
// Run: CLEAN_TRACE_FILE=cleantools/Util/UtilStrictLists.icl bun script/m14/tmp/clean-127-oracle-trace.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"
import { deriveCleanEdges } from "../differential"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories/Clyde"
const rel = process.env.CLEAN_TRACE_FILE ?? "cleantools/Util/UtilStrictLists.icl"
const full = path.join(CORPUS, rel)

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const src = readFileSync(full, "utf8")
const tree = parser.parse(src)
const root = tree.rootNode
const res = new RealCleanAnalyzer().analyze(root as any, src, full)
const truth = deriveCleanEdges(root)

const AUD = new Set(["calls", "instantiates", "implements", "references"])
const a = (res.relationships as any[]).filter((r) => AUD.has(String(r.type)))
console.log(`analyzer audited edges: ${a.length}`)
for (const r of a) console.log(`  ${String(r.type).padEnd(13)} ${r.source} -> ${r.target}`)
console.log(`oracle audited edges: ${truth.filter((e) => AUD.has(e.label)).length}`)
for (const e of truth.filter((x) => AUD.has(x.label))) console.log(`  ${e.label.padEnd(13)} ${e.from} -> ${e.target}`)

const chain = (n: any): string => {
  const out: string[] = []
  let cur = n
  while (cur && out.length < 12) { out.push(cur.type); cur = cur.parent }
  return out.join(" < ")
}

console.log(`\nconstructor-headed applications in the tree:`)
const stack: any[] = [root]
while (stack.length) {
  const n = stack.pop()
  if (n.type === "application") {
    const head = n.namedChildCount > 0 ? n.namedChild(0) : null
    if (head?.type === "constructor") {
      const line = n.startPosition.row + 1
      console.log(`  line ${line}: ${JSON.stringify(n.text.slice(0, 60))}`)
      console.log(`     s-expr: ${n.toString().split("\n").slice(0, 4).join(" / ")}`)
      console.log(`     chain:  ${chain(n)}`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}
