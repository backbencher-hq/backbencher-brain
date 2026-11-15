/**
 * JSON LANE DIFFERENTIAL — the lane's own oracle-vs-analyzer comparison.
 *
 * ## Why this exists when `script/m14/differential.ts` already does this
 *
 * The shared harness FILTERS the analyzer side through a per-language label allowlist
 * before comparing (`differential.ts` ~line 23153). The head of that list is
 * unconditional — `extends`, `implements`, `instantiates`, `overrides` — and everything
 * after it is gated on a per-language `lang === "…"` test. **`json` appears in none of
 * those tests**, so for this lane the analyzer side is reduced to those four labels and
 * every one of the labels json actually emits in bulk — `contains`, `references`, `uses`,
 * `exports`, `imports` — is dropped before the comparison happens.
 *
 * Measured on the shared harness at HEAD, unchanged by this lane:
 *
 *   [terraform] json: files=60 tree-truth=3557 covered=0 (0%) MISSING=3557
 *                     analyzer-edges=0 unexplained=0
 *
 * Zero analyzer edges against 3,557 truth edges is not a disagreement between the oracle
 * and the analyzer; it is the analyzer's output never reaching the comparison. That was
 * confirmed by reverting this lane's analyzer and oracle to HEAD and re-running: byte-identical
 * symptom, so it is pre-existing and not caused by the work in this lane.
 *
 * The shared allowlist is §8 shared machinery and this lane does not edit it, so the fix is
 * reported rather than applied. Until it lands, this harness is what measures the question
 * the shared row cannot answer: do the analyzer and the independent oracle agree?
 *
 * ## What it measures
 *
 * For each file: the ANALYZER side is production `parseFile`; the ORACLE side is
 * `deriveJsonEdges` over a FRESH tree-sitter parse of the same bytes. Matching is on
 * `(label, from, target)` and site-agnostic, which is the grain the shared harness uses and
 * the grain `deriveJsonEdges` returns. Reported per label: truth count, covered, MISSING,
 * analyzer edges, UNEXPLAINED.
 *
 * ## The limitation this cannot remove, stated because it is the important one
 *
 * Both sides walk the SAME grammar. An oracle that shared the analyzer's bug would agree
 * with it perfectly, so a MATCH here is evidence that the two INDEPENDENT IMPLEMENTATIONS
 * agree and not evidence that either is right about the language. The corpus measurement
 * that a bug in both would hide is what `probes.ts` supplies, by looking for the construct
 * in the corpus rather than by comparing two walkers.
 *
 * Usage: npx tsx validation/m14/fixtures/json/differential.ts [--limit N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveJsonEdges } from "../../../../script/m14/oracles/json"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const argv = process.argv.slice(2)
const argOf = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const LIMIT = Number(argOf("--limit", "0"))
const OUT = argOf("--out", "")
const STRIDE = Number(argOf("--stride", "0"))

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))))

// ---------------------------------------------------------------- population
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const population: FileRow[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    population.push({ repo: e, dir, rel, abs })
  }
}
// A stride walks the WHOLE sorted population, so every repo is represented; a plain
// prefix (LIMIT) is reproducible but biased towards repos whose names sort early, and
// the bias is stated rather than left to be discovered.
const files = STRIDE > 0 ? population.filter((_, i) => i % STRIDE === 0) : LIMIT > 0 ? population.slice(0, LIMIT) : population

// ---------------------------------------------------------------- compare
const key = (label: string, from: string, target: string) => `${label}|${from}|${target}`
type Row = { truth: number; covered: number; missing: number; analyzer: number; unexplained: number; missingSamples: string[]; unexplainedSamples: string[] }
const rows: Record<string, Row> = {}
for (const t of ALL_TYPES) rows[t] = { truth: 0, covered: 0, missing: 0, analyzer: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] }

let filesTruth = 0
let filesAnalyzer = 0
let filesMatchedExactly = 0
let parseFailures = 0
const failureSamples: string[] = []

for (const f of files) {
  const relPath = f.rel
  const label = `${f.repo}/${f.rel}`
  let content: string
  try {
    content = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  // ORACLE side: a fresh parse of the same bytes.
  let truth: { label: string; from: string; target: string }[]
  try {
    const tree = parser.parse(content)
    if (!tree) throw new Error("no tree")
    const jsonModule = (relPath.split("/").pop() ?? "document.json").replace(/\.[^.]+$/, "")
    const isManifest = /(^|\/)(package|composer)\.json$/.test(relPath)
    truth = deriveJsonEdges(tree.rootNode, jsonModule, { manifest: isManifest })
    tree.delete?.()
  } catch (e: any) {
    parseFailures++
    if (failureSamples.length < 6) failureSamples.push(`oracle ${label}: ${String(e?.message ?? e)}`)
    continue
  }
  // ANALYZER side: production entry point.
  let result: any
  try {
    result = await parseFile(f.abs, f.dir)
  } catch (e: any) {
    parseFailures++
    if (failureSamples.length < 6) failureSamples.push(`analyzer ${label}: ${String(e?.message ?? e)}`)
    continue
  }

  const truthSet = new Map<string, number>()
  for (const e of truth) truthSet.set(key(e.label, e.from, e.target), (truthSet.get(key(e.label, e.from, e.target)) ?? 0) + 1)
  const analyzerSet = new Map<string, number>()
  for (const r of result.relationships ?? []) {
    const l = String(r.type ?? r.relationshipType ?? "")
    const k = key(l, String(r.source ?? ""), String(r.target ?? ""))
    analyzerSet.set(k, (analyzerSet.get(k) ?? 0) + 1)
  }

  let fileTruth = 0
  let fileCovered = 0
  for (const [k, n] of truthSet) {
    const l = k.split("|")[0]
    const row = rows[l] ?? (rows[l] = { truth: 0, covered: 0, missing: 0, analyzer: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] })
    fileTruth += n
    row.truth += n
    const have = analyzerSet.get(k) ?? 0
    const coveredN = Math.min(have, n)
    row.covered += coveredN
    fileCovered += coveredN
    if (have < n) {
      row.missing += n - have
      if (row.missingSamples.length < 5) row.missingSamples.push(`${label}: ${k.slice(0, 120)}`)
    }
  }
  let fileAnalyzer = 0
  for (const [k, n] of analyzerSet) {
    const l = k.split("|")[0]
    const row = rows[l] ?? (rows[l] = { truth: 0, covered: 0, missing: 0, analyzer: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [] })
    fileAnalyzer += n
    row.analyzer += n
    const want = truthSet.get(k) ?? 0
    if (want < n) {
      row.unexplained += n - want
      if (row.unexplainedSamples.length < 5) row.unexplainedSamples.push(`${label}: ${k.slice(0, 120)}`)
    }
  }
  if (fileTruth > 0) filesTruth++
  if (fileAnalyzer > 0) filesAnalyzer++
  if (fileTruth > 0 && fileTruth === fileAnalyzer && fileCovered === fileTruth) filesMatchedExactly++
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`)
let truthTotal = 0
let coveredTotal = 0
let missingTotal = 0
let analyzerTotal = 0
let unexplainedTotal = 0
const perLabel: any = {}
for (const t of ALL_TYPES) {
  const r = rows[t]
  if (!r) continue
  if (r.truth === 0 && r.analyzer === 0) continue
  truthTotal += r.truth
  coveredTotal += r.covered
  missingTotal += r.missing
  analyzerTotal += r.analyzer
  unexplainedTotal += r.unexplained
  perLabel[t] = {
    truth: r.truth,
    analyzerEdges: r.analyzer,
    covered: r.covered,
    coveragePct: pct(r.covered, r.truth),
    missing: r.missing,
    unexplained: r.unexplained,
    unexplainedPct: pct(r.unexplained, r.analyzer),
    missingSamples: r.missingSamples,
    unexplainedSamples: r.unexplainedSamples,
  }
}

const out = {
  tool: "json lane differential (lane-owned; the shared harness drops every json label)",
  corpusRoot: CR,
  admittedPopulation: population.length,
  sampled: files.length,
  sampleMethod: STRIDE > 0 ? `every ${STRIDE}th file of the (repo, git-path)-sorted admitted population` : LIMIT > 0 ? `deterministic prefix, first ${LIMIT}` : "whole admitted population",
  parseFailures,
  parseFailureSamples: failureSamples,
  filesWithTruthEdges: filesTruth,
  filesWithAnalyzerEdges: filesAnalyzer,
  filesMatchingExactly: filesMatchedExactly,
  totals: {
    truth: truthTotal,
    analyzerEdges: analyzerTotal,
    covered: coveredTotal,
    coveragePct: pct(coveredTotal, truthTotal),
    missing: missingTotal,
    unexplained: unexplainedTotal,
    unexplainedPct: pct(unexplainedTotal, analyzerTotal),
  },
  perLabel,
  limitation: "both sides walk the same grammar, so agreement is evidence of two independent implementations agreeing, not of either being right about the language; probes.ts supplies the corpus-side measurement",
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`json lane differential — population ${population.length}, sampled ${files.length}, parse failures ${parseFailures}`)
console.log(`files with truth edges ${filesTruth}, with analyzer edges ${filesAnalyzer}, matching exactly ${filesMatchedExactly}`)
console.log("")
console.log(`${"label".padEnd(13)}${"truth".padStart(10)}${"analyzer".padStart(11)}${"covered".padStart(10)}${"cov%".padStart(9)}${"MISSING".padStart(9)}${"unexpl".padStart(9)}`)
console.log("-".repeat(71))
for (const [l, r] of Object.entries(perLabel)) {
  console.log(`${l.padEnd(13)}${r.truth.toLocaleString().padStart(10)}${r.analyzerEdges.toLocaleString().padStart(11)}${r.covered.toLocaleString().padStart(10)}${r.coveragePct.padStart(9)}${String(r.missing).padStart(9)}${String(r.unexplained).padStart(9)}`)
}
console.log("-".repeat(71))
console.log(`TOTAL        ${truthTotal.toLocaleString().padStart(10)}${analyzerTotal.toLocaleString().padStart(11)}${coveredTotal.toLocaleString().padStart(10)}${pct(coveredTotal, truthTotal).padStart(9)}${String(missingTotal).padStart(9)}${String(unexplainedTotal).padStart(9)}`)
for (const [l, r] of Object.entries(perLabel)) {
  for (const s of r.unexplainedSamples.slice(0, 3)) console.log(`  UNEXPLAINED[${l}] ${s}`)
  for (const s of r.missingSamples.slice(0, 3)) console.log(`  MISSING[${l}] ${s}`)
}
if (OUT) console.log(`\nwrote ${OUT}`)