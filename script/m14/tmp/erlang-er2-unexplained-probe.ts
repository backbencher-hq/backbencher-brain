// ER2 probe: the 26 unexplained analyzer edges on the rebar3:erlang lane —
// analyzer-has, oracle-lacks, at confidence >= 0.7 (fabrication-class).
// Reproduces the lane's exact sampling (seededPick, 200 files) and prints
// every disagreement with its file, kind, target and metadata.
import { Parser, Language } from "web-tree-sitter"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
import { deriveErlangEdges } from "../differential"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const CORPUS = "<corpus-root>/bb_tests/repositories/rebar3"
const EXT = ".erl"

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))

  const files: string[] = []
  const stack = [CORPUS]
  while (stack.length && files.length < 100000) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries.sort()) {
      const p = path.join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (![".git"].includes(e)) stack.push(p) }
      else if (p.endsWith(EXT)) files.push(p)
    }
  }

  const analyzer = new RealErlangAnalyzer()
  let n = 0
  const disagreements: string[] = []
  for (const f of files.slice(0, 400)) {
    const content = readFileSync(f, "utf8")
    let root
    try { root = parser.parse(content).rootNode } catch { continue }
    if (!root) continue
    const relPath = path.relative(CORPUS, f)
    const result = analyzer.analyze(root, content, relPath)
    const truth = deriveErlangEdges(root, relPath)
    const rels = (result.relationships as any[])
      .filter((r: any) => ["extends", "implements", "instantiates", "calls", "uses", "references"].includes(String(r.type)))
      .map((r: any) => ({ label: String(r.type), target: String(r.target), conf: typeof r.confidence === "number" ? r.confidence : 1 }))
      .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => x.label + "|" + x.target === k) })
    for (const r of rels) {
      const hit = truth.some((te: any) => te.label === r.label && te.target === r.target)
      if (!hit && r.conf >= 0.7) {
        n++
        if (disagreements.length < 40) {
          const edge = (result.relationships as any[]).find((x: any) => String(x.type) === r.label && x.target === r.target)
          disagreements.push(`${relPath}: ${r.label} -> ${r.target} [meta=${JSON.stringify(edge?.metadata ?? {})}] src=${edge?.source} line=${edge?.line_number}`)
        }
      }
    }
  }
  console.log(`unexplained (conf>=0.7): ${n} of ${files.length} files scanned`)
  for (const d of disagreements) console.log("  " + d)
  parser.delete()
}

main().catch(e => { console.error(e); process.exitCode = 1 })
