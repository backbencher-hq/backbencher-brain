/**
 * CSHARP LANE — validation for the three new truth modules (task-37 STEP 3, light).
 *
 * Parses a bounded sample, derives the lane truth for exports/imports/overrides and the
 * analyzer's relationships, and reports per label: truth rows, analyzer rows, matched,
 * MISSING (truth row the analyzer does not emit) and UNEXPLAINED (analyzer row no truth row
 * explains), with samples. Uses the harness's own match normalisation (normTarget/auditTarget
 * imported from differential) so a disagreement here is the disagreement the harness would see.
 *
 * CLI: bun run script/m14/csharp-truth-validate.ts [--sample N] [--json]
 * EXIT 0 measured · 2 usage
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { normTarget, auditTarget } from "./differential"
import { deriveCSharpExportsTruth, deriveCSharpImportsTruth, deriveCSharpOverridesTruth } from "./csharp-truth"

const argv = process.argv.slice(2)
const sampleArg = argv.indexOf("--sample")
const SAMPLE = sampleArg >= 0 ? Number(argv[sampleArg + 1]) : 240
const asJson = argv.includes("--json")
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const FIXTURES = path.resolve("validation/m14/fixtures/csharp")

const LABELS = new Set(["exports", "imports", "overrides"])
const matchKey = (t: string): string => normTarget(auditTarget(t))

function walkCsharp(dir: string, limit: number, out: string[]): void {
  if (out.length >= limit) return
  let entries: any[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (out.length >= limit) return
    const abs = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) { try { isDir = statSync(abs).isDirectory() } catch { isDir = false } }
    if (isDir) walkCsharp(abs, limit, out)
    else if (e.name.endsWith(".cs")) out.push(abs)
  }
}
const files: string[] = []
// fixtures first (the pinned contracts), then a bounded per-repo sample
try {
  for (const e of readdirSync(FIXTURES)) if (e.endsWith(".cs")) files.push(path.join(FIXTURES, e))
} catch { /* no fixtures dir */ }
for (const repo of ["powershell", "gql-graphql-platform", "fsharp"]) {
  const dir = path.join(CORPUS, repo)
  const got: string[] = []
  walkCsharp(dir, Math.ceil(SAMPLE / 3), got)
  files.push(...got)
}

type Stats = { truth: number; analyzer: number; matched: number; missing: number; unexplained: number; missingSamples: string[]; unexplainedSamples: string[] }
const stats: Record<string, Stats> = { exports: blank(), imports: blank(), overrides: blank() }
function blank(): Stats { return { truth: 0, analyzer: 0, matched: 0, missing: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] } }

const parser = await getParser("csharp" as any)
const AnalyzerMod: any = await import("../../src/ast/real-csharp-analyzer")
const analyzer = new AnalyzerMod.RealCSharpAnalyzer()
for (const f of files) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { continue }
  // The differential and the fixture harness both call analyzer.analyze DIRECTLY (with the
  // cross-file interface-kind companion); the pool-worker path is a different entry point and
  // must not be used as the comparison's analyzer side.
  let analysis: any = null
  try { analysis = await analyzer.analyze(tree.rootNode, content, path.basename(f), {}) } catch { continue }
  const rel = path.relative(CORPUS, f).replace(/\\/g, "/")
  const analyzerRels = ((analysis?.relationships ?? []) as any[])
    .filter((r) => LABELS.has(String(r.type)))
    .map((r) => ({ label: String(r.type), target: String(r.target ?? "") }))
    .filter((r, i, arr) => i === arr.findIndex((x) => x.label + "|" + x.target === r.label + "|" + r.target))
  const truth = [
    ...deriveCSharpExportsTruth(tree.rootNode),
    ...deriveCSharpImportsTruth(tree.rootNode),
    ...deriveCSharpOverridesTruth(tree.rootNode),
  ].filter((t, i, arr) => i === arr.findIndex((x) => x.label + "|" + x.target === t.label + "|" + t.target))
  for (const label of LABELS) {
    const t = truth.filter((x) => x.label === label)
    const a = analyzerRels.filter((x) => x.label === label)
    const s = stats[label]
    s.truth += t.length; s.analyzer += a.length
    for (const te of t) {
      const hit = a.some((r) => matchKey(r.target) === matchKey(te.target))
      if (hit) s.matched++
      else { s.missing++; if (s.missingSamples.length < 12) s.missingSamples.push(`${rel} :: ${te.from} -> ${te.target}`) }
    }
    for (const r of a) {
      const hit = t.some((te) => matchKey(te.target) === matchKey(r.target))
      if (!hit) { s.unexplained++; if (s.unexplainedSamples.length < 12) s.unexplainedSamples.push(`${rel} :: analyzer -> ${r.target}`) }
    }
  }
}
const result = { files: files.length, stats }
if (asJson) console.log(JSON.stringify(result, null, 2))
else {
  console.log(`files: ${files.length}`)
  for (const [label, s] of Object.entries(stats)) {
    console.log(`\n${label}: truth ${s.truth} · analyzer ${s.analyzer} · matched ${s.matched} · MISSING ${s.missing} · UNEXPLAINED ${s.unexplained}`)
    for (const x of s.missingSamples.slice(0, 6)) console.log("   MISSING     " + x)
    for (const x of s.unexplainedSamples.slice(0, 6)) console.log("   UNEXPLAINED " + x)
  }
}
