// GO ORACLE CONTRACT — measure the lane's new exports/overrides truth oracles against the ANALYZER
// over a deterministic, gate-shaped population sample BEFORE the Lead wires them into
// `differential.ts` (single-writer). Mirrors the clojure contract harness: deterministic stride over
// the admitted `.go` population, row identity = (from, target) exactly as the differential compares.
//
// Usage: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/go-oracle-contract.ts [--max-files 400] [--json out]
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealGoAnalyzer } from "../../src/ast/real-go-analyzer"
import { deriveGoExportsTruth, deriveGoOverridesTruth } from "./go-truth"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const maxFilesIdx = process.argv.indexOf("--max-files")
const maxFiles = maxFilesIdx >= 0 ? Number(process.argv[maxFilesIdx + 1]) : 400
const jsonIdx = process.argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const MAX_SIZE = 1024 * 1024

const repos = fs.readdirSync(CR).filter((r) => { try { return fs.statSync(path.join(CR, r)).isDirectory() } catch { return false } }).sort()
const allFiles: string[] = []
for (const repo of repos) {
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".go")) continue
    const abs = path.join(CR, repo, rel)
    try { if (fs.statSync(abs).size > MAX_SIZE) continue } catch { continue }
    allFiles.push(abs)
  }
}
allFiles.sort()
const stride = Math.max(1, Math.floor(allFiles.length / Math.max(1, maxFiles)))
const sample = allFiles.filter((_, i) => i % stride === 0).slice(0, maxFiles)
const parser = await ASTEngine.getParser("go" as any)
const LABELS = ["exports", "overrides"] as const
const stats: Record<string, { analyzer: number; truth: number; agreed: number; missing: any[]; unexplained: any[] }> = {}
for (const label of LABELS) stats[label] = { analyzer: 0, truth: 0, agreed: 0, missing: [], unexplained: [] }
let files = 0
for (const abs of sample) {
  let content: string
  try { content = fs.readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(content)
  if (!tree) continue
  files++
  const res: any = new RealGoAnalyzer().analyze(tree.rootNode, content, abs)
  const relPath = abs.slice(CR.length + 1)
  const truthRows: any[] = [
    ...deriveGoExportsTruth(tree.rootNode).map((e) => ({ label: "exports", from: e.from, target: e.target, line: e.line })),
    ...deriveGoOverridesTruth(tree.rootNode).map((e) => ({ label: "overrides", from: e.from, target: e.target, line: e.line })),
  ]
  for (const label of LABELS) {
    const st = stats[label]!
    const a = new Map<string, any>()
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== label) continue
      a.set(`${r.source}|${r.target}`, { label, from: String(r.source), target: String(r.target), line: r.line_number ?? 0, file: relPath })
    }
    const t = new Map<string, any>()
    for (const r of truthRows) if (r.label === label) t.set(`${r.from}|${r.target}`, { ...r, file: relPath })
    st.analyzer += a.size; st.truth += t.size
    for (const [k, row] of a) { if (t.has(k)) st.agreed++; else if (st.missing.length < 30) st.missing.push(row) }
    for (const [k, row] of t) { if (!a.has(k) && st.unexplained.length < 500) st.unexplained.push(row) }
  }
}
console.log(`GO ORACLE CONTRACT — ${files} sampled .go files of ${allFiles.length} admitted (stride ${stride})`)
const report: any = { files, sampleOf: allFiles.length, labels: {} }
for (const label of LABELS) {
  const st = stats[label]!
  const pct = st.analyzer === 0 ? "n/a" : ((st.agreed / st.analyzer) * 100).toFixed(3) + "%"
  console.log(`\n== ${label}: analyzer ${st.analyzer} · oracle ${st.truth} · agreed ${st.agreed} (${pct} of analyzer rows) · MISSING ${st.analyzer - st.agreed} · UNEXPLAINED ${st.truth - st.agreed}`)
  for (const s of st.missing.slice(0, 8)) console.log(`   MISSING      ${s.from} -> ${s.target} @${s.line} [${s.file}]`)
  for (const s of st.unexplained.slice(0, 8)) console.log(`   UNEXPLAINED  ${s.from} -> ${s.target} @${s.line} [${s.file}]`)
  report.labels[label] = st
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
