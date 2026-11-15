// #916 triage: the F5 whole-corpus c lane (315 sqlite files) reports exactly 4
// unexplained analyzer edges. Decide whether each is (a) a fabrication my change
// introduced, or (b) a pre-existing mirror gap surfaced by the wider sample.
// Method: run BOTH analyzers — HEAD's (copied to src/ast/zz-c916-pre-analyzer.ts)
// and the working tree's — on the SAME parsed tree and print every relationship
// touching the four targets.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { RealCAnalyzer: Post } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const { RealCAnalyzer: Pre } = await import(path.join(ROOT, "src/ast/zz-c916-pre-analyzer.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))

const REPO = "/home/ishaq2321/bb_tests/repositories/sqlite"
const SITES: Array<{ file: string; target: string; line?: number }> = [
  { file: "src/btree.c", target: "sqlite3SharedCacheList", line: 2657 },
  { file: "src/notify.c", target: "sqlite3BlockedList", line: 59 },
  { file: "ext/wasm/libcmpp.c", target: "BufSize", line: 8752 },
  { file: "src/resolve.c", target: "if", line: 1336 },
]

for (const site of SITES) {
  const abs = path.join(REPO, site.file)
  const src = readFileSync(abs, "utf8")
  const parser = new P()
  parser.setLanguage(lang)
  const root = parser.parse(src).rootNode
  const pre: any = new Pre().analyze(root, src, abs)
  const post: any = new Post().analyze(root, src, abs)
  console.log(`\n=== ${site.file} :: target "${site.target}"`)
  for (const [tag, res] of [["PRE ", pre], ["POST", post]] as const) {
    const hits = (res.relationships ?? []).filter((r: any) => r.target === site.target)
    console.log(`  ${tag} rels=${(res.relationships ?? []).length} symbols=${(res.symbols ?? []).length} touching-target=${hits.length}`)
    for (const r of hits)
      console.log(`      @${r.line_number} ${r.type} ${r.source} -> ${r.target}${r.metadata?.relationshipType ? ` [${r.metadata.relationshipType}]` : ""} conf=${r.confidence}`)
    const sym = (res.symbols ?? []).find((s: any) => s.name === site.target)
    console.log(`      symbol "${site.target}": ${sym ? `${sym.kind}@${sym.range?.startLine}` : "ABSENT"}`)
  }
}
