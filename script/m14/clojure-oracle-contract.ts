/**
 * CLOJURE ORACLE CONTRACT — measure the lane's imports/exports/overrides truth oracles against the
 * ANALYZER over the whole admitted population, BEFORE they are wired into `differential.ts`
 * (single-writer: the Lead). An oracle that has never been measured can only move fabrication from
 * one column to another; this harness is the pre-wiring evidence the wiring request cites.
 *
 * Per label it reports: analyzer rows, truth rows, AGREED (same key), MISSING (analyzer row the
 * oracle cannot derive) and UNEXPLAINED (oracle row the analyzer does not emit), with samples of
 * each. The comparison key is the row identity: (from, target, line) — the same identity the
 * analyzer's own dedupe uses.
 *
 * Usage: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-oracle-contract.ts [--json out]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealClojureAnalyzer } from "../../src/ast/real-clojure-analyzer"
import { deriveClojureExportsTruth, deriveClojureImportsTruth, deriveClojureOverridesTruth } from "./clojure-truth"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const jsonIdx = process.argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const parser = await ASTEngine.getParser("clojure" as any)
const LABELS = ["imports", "exports", "overrides"]
type Row = { label: string; from: string; to: string; line: number }
const stats = new Map<string, { analyzer: number; truth: number; agreed: number; missing: Row[]; unexplained: Row[] }>()
for (const label of LABELS) stats.set(label, { analyzer: 0, truth: 0, agreed: 0, missing: [], unexplained: [] })
const repos = ["clj-kondo", "clojure", "nvim-treesitter"]
let files = 0
for (const repo of repos) {
  const dir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(clj|cljs|cljc|edn)$/.test(rel)) continue
    const abs = path.join(dir, rel)
    let content: string
    try { content = fs.readFileSync(abs, "utf8") } catch { continue }
    if (content.length > 1024 * 1024) continue
    const tree = parser.parse(content)
    if (!tree) continue
    files++
    const res: any = new RealClojureAnalyzer().analyze(tree.rootNode, content, abs)
    const analyzerRows = (res.relationships ?? []).filter((r: any) => LABELS.includes(String(r.type)))
    const truthRows: Array<{ label: string; from: string; to: string; line: number }> = []
    for (const e of deriveClojureImportsTruth(tree.rootNode)) truthRows.push({ label: "imports", from: e.from, to: e.to, line: e.line })
    for (const e of deriveClojureExportsTruth(tree.rootNode)) truthRows.push({ label: "exports", from: e.from, to: e.to, line: e.line })
    for (const e of deriveClojureOverridesTruth(tree.rootNode)) truthRows.push({ label: "overrides", from: e.from, to: e.to, line: e.line })
    for (const label of LABELS) {
      const st = stats.get(label)!
      const a = new Map<string, Row>()
      for (const r of analyzerRows) {
        if (String(r.type) !== label) continue
        const row = { label, from: String(r.source), to: String(r.target), line: Number(r.line_number ?? 0) }
        a.set(`${row.from}|${row.to}|${row.line}`, row)
      }
      const t = new Map<string, Row>()
      for (const r of truthRows) {
        if (r.label !== label) continue
        t.set(`${r.from}|${r.to}|${r.line}`, r)
      }
      st.analyzer += a.size
      st.truth += t.size
      for (const [k, row] of a) {
        if (t.has(k)) st.agreed++
        else if (st.missing.length < 40) st.missing.push(row)
      }
      for (const [k, row] of t) {
        if (!a.has(k) && st.unexplained.length < 40) st.unexplained.push(row)
      }
    }
  }
}
console.log(`CLOJURE ORACLE CONTRACT — ${files} admitted files (clj-kondo, clojure, nvim-treesitter)`)
const report: any = { files, labels: {} }
for (const label of LABELS) {
  const st = stats.get(label)!
  const pct = st.analyzer === 0 ? "n/a" : ((st.agreed / st.analyzer) * 100).toFixed(3) + "%"
  console.log(`\n== ${label}: analyzer ${st.analyzer} · oracle ${st.truth} · agreed ${st.agreed} (${pct} of analyzer rows) · MISSING ${st.analyzer - st.agreed} · UNEXPLAINED ${st.truth - st.agreed}`)
  for (const s of st.missing.slice(0, 6)) console.log(`   MISSING      ${s.from} -> ${s.to} @${s.line}`)
  for (const s of st.unexplained.slice(0, 6)) console.log(`   UNEXPLAINED  ${s.from} -> ${s.to} @${s.line}`)
  report.labels[label] = st
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
