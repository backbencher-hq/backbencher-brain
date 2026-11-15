// go #799/#889 — what the F5 comparison actually COVERS for this lane, and what
// it silently drops, measured over a full corpus rather than a draw.
//
// Why this exists: the harness's per-language label allowlist decides which of
// the analyzer's edges are even offered to the comparison. For go the allowlist
// admits `extends`, `implements`, `instantiates`, `overrides` and `calls` —
// `uses` and `references` are NOT in it, so the entire read surface (GO1's bare
// value reads, re-reads, dotted channels) and the entire declared-type surface
// (R9) are outside the differential BY CONSTRUCTION: a wrong read edge cannot be
// MISSING and cannot be fabrication. This probe prints both halves of that claim
// as counts, per label, over every `.go` file of a corpus.
//
// Run: bun script/m14/tmp/go-799-surface.ts <repoRoot> [labelFilter]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

// Verbatim from the harness (differential.ts), so a row here is a row there.
const lastSegment = (t: string): string => t.split("::").pop()!.split(".").pop()!.trim()
const normTarget = (t: string): string =>
  lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())

// The labels the harness offers to the comparison for go today — copied from the
// allowlist expression, not paraphrased.
const GATED = new Set(["extends", "implements", "instantiates", "overrides", "calls"])
// Labels the analyzer emits that the allowlist therefore DROPS for go.
const DROPPED = ["uses", "references", "imports", "exports"]

const root = process.argv[2]
const only = process.argv[3]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 16) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".go")) files.push(p)
  }
}
walk(root)
files.sort()
// INDEX RANGE, so a go-heavy tree can be read in fresh processes: a single
// process traps (`Aborted()`) after ~10,000 parses even with the parser
// re-fetched per file, and the trap would otherwise look like a complete read
// of a truncated prefix (see the note in the JSON below).
const fromArg = process.argv.indexOf("--from")
const toArg = process.argv.indexOf("--to")
const readFiles = fromArg >= 0 || toArg >= 0 ? files.slice(fromArg >= 0 ? Number(process.argv[fromArg + 1]) : 0, toArg >= 0 ? Number(process.argv[toArg + 1]) : files.length) : files

// PARSER DISCIPLINE (found the hard way on a go-heavy read, 2026-09-24): the
// engine recreates a language's parser every 500 files because ONE long-lived
// wasm instance accumulates memory and starts failing with `Aborted()` after
// ~9,000-10,000 parses (the comment in src/ast/engine.ts says so; measured
// 10,609 parses on kubernetes). A probe that fetches the parser ONCE and then
// swallows parse errors with a bare `continue` therefore reports a COMPLETE
// corpus while silently reading only its prefix. Fetch per file — the engine's
// own path — and count every skip.
const analyzer = new RealGoAnalyzer()
const skips = { parse: 0, samples: [] as string[] }
let filesRead = 0

const analyzerByLabel = new Map<string, number>()
const analyzerByLabelWithRT = new Map<string, number>()
const truthByLabel = new Map<string, number>()
const missingByLabel = new Map<string, number>()
const unexplainedByLabel = new Map<string, number>()
let missing = 0
let unexplained = 0
let truthTotal = 0
let analyzeredges = 0
let gatedAnalyzerEdges = 0
let droppedAnalyzerEdges = 0
const samples: string[] = []
const shownKeys = new Set<string>()

for (const f of readFiles) {
  const content = fs.readFileSync(f, "utf8")
  let tree: any
  try {
    const parser = await ASTEngine.getParser("go" as any)
    tree = parser.parse(content)
  } catch (e: any) {
    skips.parse++
    if (skips.samples.length < 10) skips.samples.push(`${path.relative(root, f)}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  const rootNode = tree.rootNode
  if (!rootNode) continue
  filesRead++
  const res: any = await analyzer.analyze(rootNode, content, f)
  const rel = path.relative(root, f)

  const all = (res.relationships ?? []).map((r: any) => ({
    label: String(r.type ?? r.relationshipType ?? ""),
    rt: String(r.metadata?.relationshipType ?? ""),
    target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
  }))
  for (const r of all) {
    analyzerByLabel.set(r.label, (analyzerByLabel.get(r.label) ?? 0) + 1)
    const k2 = r.label + (r.rt ? `/${r.rt}` : "")
    analyzerByLabelWithRT.set(k2, (analyzerByLabelWithRT.get(k2) ?? 0) + 1)
    if (GATED.has(r.label)) gatedAnalyzerEdges++
    else droppedAnalyzerEdges++
  }
  // The analyzer side as the harness sees it: allowlisted labels, deduped by
  // (label,target), which is what the coverage match compares.
  const rels = all
    .filter((r) => GATED.has(r.label))
    .filter((r, i, arr) => {
      const k = r.label + "|" + r.target
      return i === arr.findIndex((x) => x.label + "|" + x.target === k)
    })

  const truth: any[] = [
    ...deriveTreeEdges(rootNode, "go"),
    ...deriveGoEdges(rootNode),
    ...deriveGoImplements(rootNode),
  ]
  truthTotal += truth.length
  analyzeredges += rels.length
  for (const te of truth) truthByLabel.set(te.label, (truthByLabel.get(te.label) ?? 0) + 1)

  for (const te of truth) {
    if (rels.some((r) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) continue
    missing++
    missingByLabel.set(te.label, (missingByLabel.get(te.label) ?? 0) + 1)
    const key = `M|${te.label}|${te.target}`
    if ((!only || te.label === only) && shownKeys.size < 50 && !shownKeys.has(key)) {
      shownKeys.add(key)
      samples.push(`MISSING     ${te.label} -> ${JSON.stringify(te.target)}  from=${te.from}  ${rel}`)
    }
  }
  for (const r of rels) {
    if (truth.some((te: any) => te.label === r.label && normTarget(r.target) === normTarget(te.target))) continue
    unexplained++
    unexplainedByLabel.set(r.label, (unexplainedByLabel.get(r.label) ?? 0) + 1)
    const key = `U|${r.label}|${r.target}`
    if ((!only || r.label === only) && shownKeys.size < 50 && !shownKeys.has(key)) {
      shownKeys.add(key)
      samples.push(`UNEXPLAINED ${r.label} -> ${JSON.stringify(r.target)}  ${rel}`)
    }
  }
}

const droppedCounts: Record<string, number> = {}
for (const l of DROPPED) droppedCounts[l] = analyzerByLabel.get(l) ?? 0
console.log(
  JSON.stringify(
    {
      repo: root,
      files: files.length,
      readRange: readFiles.length === files.length ? "full extent" : `${readFiles.length} of ${files.length} (index range)`,
      filesRead,
      skips,
      note: "filesRead is the number of files this run actually parsed; it must equal files. A bare `continue` on a wasm `Aborted()` (the ~9,000-parse instance limit) is exactly how a truncated read used to look complete.",
      truthTotal,
      analyzeredges,
      missing,
      unexplained,
      missingByLabel: Object.fromEntries(missingByLabel),
      unexplainedByLabel: Object.fromEntries(unexplainedByLabel),
      truthByLabel: Object.fromEntries(truthByLabel),
      analyzerByLabel: Object.fromEntries(analyzerByLabel),
      analyzerByLabelWithRelationshipType: Object.fromEntries(analyzerByLabelWithRT),
      gatedAnalyzerEdges,
      droppedFromTheComparison: droppedCounts,
      droppedTotal: droppedAnalyzerEdges,
    },
    null,
    1,
  ),
)
for (const s of samples) console.log(s)
