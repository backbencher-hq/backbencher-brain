// How vacuous is the harness's `overrides` match?
//
// The analyzer-side coverage test is
//   truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target)
//                                                  || te.target.includes(normTarget(r.target))))
// with normTarget = the LAST SEGMENT, generics stripped. The second clause is a
// substring test on a leaf, so an analyzer edge `Async.ap` is "explained" by a
// truth row whose target is `Async.map` — "map" contains "ap". This prints the
// pairs, so the claim is a list of rows rather than an assertion.

import fs from "node:fs"
import path from "node:path"
import { deriveTreeEdges, deriveScalaEdges } from "../differential"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const drawFile = process.argv[3]

function lastSeg(t: string): string {
  const s2 = String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim()
  const parts = s2.split(".")
  return parts[parts.length - 1]
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)

  let analyzerRows = 0
  let exactExplained = 0
  let substringOnly = 0
  let notExplained = 0
  const examples: string[] = []
  const hiNoTruth: string[] = []
  // Cross-tabulate the exact-match verdict against the PUBLISHED confidence,
  // because the harness buckets an unmatched row with confidence < 0.7 as
  // HEURISTIC and only counts confidence >= 0.7 as unexplained. That is the
  // whole reason the lane reads unexplained=0 for a label whose truth covers
  // 42 of 83 rows.
  const confTab: Record<string, { rows: number; exact: number; notExact: number }> = {}

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    const src = fs.readFileSync(fp, "utf8")
    const root = parser.parse(src).rootNode
    const truth = [...deriveTreeEdges(root, "scala"), ...deriveScalaEdges(root)].filter((e: any) => e.label === "overrides")
    const res: any = analyzer.analyze(root, src, fp)
    const rows = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    for (const r of rows) {
      analyzerRows++
      const leaf = lastSeg(r.target)
      const exact = truth.some((te: any) => lastSeg(te.target) === leaf)
      const loose = truth.some((te: any) => String(te.target).includes(leaf))
      const cf = typeof r.confidence === "number" ? r.confidence : 1
      const ck = String(cf)
      confTab[ck] = confTab[ck] ?? { rows: 0, exact: 0, notExact: 0 }
      confTab[ck].rows++
      confTab[ck][exact ? "exact" : "notExact"]++
      if (!exact && cf >= 0.7) {
        // The rows that matter most: a CONFIDENT edge with no truth counterpart.
        hiNoTruth.push(`  ${path.relative(path.join(CORPUS, repo), fp)}:${r.line_number ?? 0}  ${r.source} -> ${r.target}  conf=${cf} reasonCode=${r.metadata?.reasonCode ?? "-"}`)
      }
      if (exact) { exactExplained++; continue }
      if (loose) {
        substringOnly++
        const explainer = truth.find((te: any) => String(te.target).includes(leaf))
        if (examples.length < 16) {
          examples.push(`  analyzer ${r.source} -> ${r.target}   "explained" by truth ${explainer.from} -> ${explainer.target}   (leaf "${leaf}" is a SUBSTRING of "${explainer.target}")`)
        }
      } else notExplained++
    }
  }
  console.log(`# ${repo} draw ${files.length} files: ${analyzerRows} analyzer overrides rows`)
  console.log(`#   explained by an EXACT leaf match ....... ${exactExplained}`)
  console.log(`#   explained ONLY by the substring clause .. ${substringOnly}   (${((substringOnly / Math.max(1, analyzerRows)) * 100).toFixed(1)}% of the label)`)
  console.log(`#   not explained at all .................. ${notExplained}`)
  console.log("# confidence cross-tab (rows / with an exact truth counterpart / without):")
  for (const [k, v] of Object.entries(confTab).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(`   confidence ${k}: rows=${v.rows} exact=${v.exact} notExact=${v.notExact}${Number(k) < 0.7 ? "   <- the harness buckets these as HEURISTIC, not unexplained" : ""}`)
  }
  console.log(`# CONFIDENT rows with no truth counterpart (${hiNoTruth.length}) — these are the ones that would be MISSING if the harness did not bucket them:`)
  for (const e of hiNoTruth.slice(0, 20)) console.log(e)
  console.log("--- pairs (analyzer row, the truth row that 'explained' it) ---")
  for (const e of examples) console.log(e)
}
main().catch((e) => { console.error(e); process.exit(1) })
