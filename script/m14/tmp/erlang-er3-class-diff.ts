// Per-file edge-class dumper: writes every analyzer edge of a chosen
// label|context class (target + site line) per file, so a pre/post class delta
// is attributed to named files instead of inferred from a total.
//
// Run: bun script/m14/tmp/erlang-er3-class-diff.ts <corpus> <label> <context|-> <outTag>
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const [repo, label, contextArg, tag] = process.argv.slice(2)
const CONTEXT = contextArg === "-" ? "" : contextArg

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-erlang.wasm"))))

const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(d, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (e.endsWith(".erl") || e.endsWith(".hrl")) files.push(p)
  }
}
walk(path.join(CORPUS, repo))
files.sort()

const out: Record<string, string[]> = {}
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  if (!tree) continue
  const res = new RealErlangAnalyzer().analyze(tree.rootNode, src, f)
  const rows: string[] = []
  for (const r of res.relationships as any[]) {
    if (String(r.type) !== label) continue
    if (String(r.metadata?.context ?? "") !== CONTEXT) continue
    rows.push(`${r.target}#L${(r as any).line_number ?? 0}`)
  }
  if (rows.length) out[path.relative(CORPUS, f)] = [...new Set(rows)].sort()
  tree.delete?.()
}
const dest = `/tmp/er3-${tag}-${repo}-${label}-${contextArg}.json`
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${dest}: files=${Object.keys(out).length} rows=${Object.values(out).flat().length}`)
