// W17: for ONE jq file (src/jv.c), diff the analyzer's `uses`/`references`
// edges against the oracle's truth — per target. Shows exactly which of the
// 23 targets the ANALYZER emits that the oracle cannot explain, and whether
// the analyzer ALSO has them as symbols (i.e. resolvable).
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"
async function parseFile(abs: string) {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(abs, "utf8")
  return { root: p.parse(src).rootNode, src }
}
async function main() {
  const rel = "src/builtin.c"
  const { root, src } = await parseFile(path.join(JQ, rel))
  const out: any = new RealCAnalyzer().analyze(root, src, rel)
  const aUses = new Set<string>()
  for (const r of (out.relationships ?? [])) {
    if (r.target === undefined) continue
    if (r.type === "Uses" || r.type === "uses") aUses.add(String(r.target))
  }
  // oracle: deriveCCalls is the c branch's truth pusher
  const truth = deriveCCalls(root) as any[]
  const tUses = new Set<string>()
  for (const e of truth) if (e.label === "uses") tUses.add(e.target)
  const onlyAnalyzer = [...aUses].filter(t => !tUses.has(t)).sort()
  console.log(`jv.c: analyzer uses=${aUses.size}, oracle uses-truth=${tUses.size}, analyzer-only=${onlyAnalyzer.length}`)
  for (const t of onlyAnalyzer.slice(0, 30)) console.log("   A-only:", t)
}
main().catch(e => { console.error(e); process.exit(1) })
