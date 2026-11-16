/**
 * PERL DIFFERENTIAL ADJUDICATION — every red row gets a name.
 *
 * The F5 gate's rule is site-agnostic: an analyzer edge is explained when some
 * truth edge has the same LABEL and a target that matches after normalisation.
 * This tool reuses the HARNESS'S OWN oracle (`derivePerlEdges` from
 * script/m14/differential.ts) and the harness's own matching predicate, then
 * prints the unmatched analyzer edges grouped by label so each one can be
 * adjudicated as an analyzer defect, an oracle gap, or a documented convention.
 *
 * usage: bun diff-adjudicate.mts <corpusDir> [limit]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))

// The harness's OWN oracle AND its OWN target normalisation, so a row this tool
// calls MISSING is the same row the gate calls MISSING.
const { derivePerlEdges, normTarget, strictKey, qualifierOf } = await import(path.join(ROOT, "script/m14/differential.ts"))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const COMPARED = new Set(process.env.PERL_COMPARE_CONTAINS === "1"
  ? ["extends", "implements", "instantiates", "overrides", "calls", "contains"]
  : ["extends", "implements", "instantiates", "overrides", "calls"])

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "build") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    // production's set (src/ast/language-detection.ts:42 maps pl|pm|t|perl only;
    // `PL` is not a perl extension to the engine). This read `|PL`, so perl5
    // reported 3,698 files against the census's 3,607 and the per-file numbers
    // described a surface the product never routes. Auditing the wider set did
    // come out clean, which is worth knowing, but the number has to mean one thing.
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(p)
  }
  return out
}

const dir = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/mojo"
const limit = process.argv[3] ? parseInt(process.argv[3]) : 60
const files = walk(dir).sort().slice(0, limit)

/** The harness's `lastSegment`: split on `::` AND `.`, keep the last piece. */
const lastSegmentOf = (t: string): string => {
  const parts = String(t ?? "").split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? String(t)
}

const unexplainedByLabel = new Map<string, Map<string, { count: number; files: Set<string>; conf: Set<number> }>>()
const heuristicByLabel = new Map<string, number>()
let truthTotal = 0
let missing = 0
let explained = 0
let unexplained = 0
let heuristic = 0
const missingSamples: any[] = []

for (const f of files) {
  let src: string
  try {
    src = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  let root: any
  let res: any
  try {
    const tree = parser.parse(src)
    root = tree.rootNode
    res = new RealPerlAnalyzer().analyze(root, src, f)
  } catch {
    continue
  }
  // BOTH sides are filtered to the labels the F5 gate actually compares; the gate
  // drops every other label from the truth side too, so counting a `contains`
  // truth row as MISSING against an analyzer side that never sees the label
  // would invent misses that the harness does not report.
  const truth = derivePerlEdges(root).filter((e: any) => COMPARED.has(e.label))
  const rels = (res.relationships ?? [])
    .filter((r: any) => COMPARED.has(String(r.type)))
    .map((r: any) => ({ label: String(r.type), target: String(r.target), confidence: r.confidence, source: r.source }))
    .filter((r: any, i: number, arr: any[]) => {
      const k = r.label + "|" + r.target
      return i === arr.findIndex((x: any) => x.label + "|" + x.target === k)
    })

  truthTotal += truth.length
  for (const te of truth) {
    if (rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) explained++
    else {
      missing++
      if (missingSamples.length < 40) {
        const sameLeaf = rels.filter((r: any) => r.label === te.label && lastSegmentOf(te.target) === lastSegmentOf(r.target))
        missingSamples.push({
          file: path.relative(dir, f),
          label: te.label,
          truthTarget: te.target,
          truthLeaf: lastSegmentOf(te.target),
          from: te.from,
          analyzerTargetsWithSameLeaf: sameLeaf.map((r: any) => r.target),
          analyzerTargetsWithSameLabel: rels.filter((r: any) => r.label === te.label).map((r: any) => r.target),
          spellingAsymmetry: sameLeaf.length > 0,
        })
      }
    }
  }
  for (const r of rels) {
    if (truth.some((te: any) => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))) continue
    if (typeof r.confidence === "number" && r.confidence < 0.7) {
      heuristic++
      heuristicByLabel.set(r.label, (heuristicByLabel.get(r.label) ?? 0) + 1)
      continue
    }
    unexplained++
    if (!unexplainedByLabel.has(r.label)) unexplainedByLabel.set(r.label, new Map())
    const m = unexplainedByLabel.get(r.label)!
    if (!m.has(r.target)) m.set(r.target, { count: 0, files: new Set(), conf: new Set() })
    const e = m.get(r.target)!
    e.count++
    e.files.add(path.relative(dir, f))
    e.conf.add(r.confidence)
  }
}

console.log(`corpus: ${dir}  files: ${files.length}`)
console.log(`tree-truth=${truthTotal}  explained=${explained}  MISSING=${missing}  (${((100 * explained) / (truthTotal || 1)).toFixed(1)}% coverage)`)
console.log(`analyzer unexplained=${unexplained}  heuristic=${heuristic}`)
console.log(`\n=== UNEXPLAINED ANALYZER EDGES BY LABEL ===`)
const rows: any[] = []
for (const [label, m] of unexplainedByLabel) {
  const items = [...m].map(([target, e]) => ({ target, count: e.count, files: e.files.size, conf: [...e.conf].join("/"), eg: [...e.files][0] }))
  items.sort((a, b) => b.count - a.count)
  const total = items.reduce((a, b) => a + b.count, 0)
  rows.push({ label, total, distinct: items.length, items })
  console.log(`\n-- ${label}: ${total} edges over ${items.length} distinct targets`)
  for (const it of items.slice(0, 18)) console.log(`     ${String(it.count).padStart(4)}x conf=${it.conf.padEnd(4)} ${it.target.slice(0, 70).padEnd(72)} ${it.eg}`)
  if (items.length > 18) console.log(`     ... and ${items.length - 18} more distinct targets`)
}
console.log(`\n=== HEURISTIC (declared, conf<0.7) BY LABEL ===`)
for (const [k, v] of heuristicByLabel) console.log(`  ${k}: ${v}`)
if (missingSamples.length) {
  console.log(`\n=== MISSING SAMPLES (truth edges the analyzer does not emit) ===`)
  for (const m of missingSamples) console.log(`  ${m.file} :: ${m.label} ${m.from} -> ${m.target}`)
}
fs.writeFileSync((process.env.BB_PERL_OUT ?? "/tmp") + "/perl-diff-adjudication.json", JSON.stringify({ dir, files: files.length, truthTotal, explained, missing, unexplained, heuristic, rows, missingSamples }, null, 2))
console.log(`\nwrote ${process.env.BB_PERL_OUT ?? "/tmp"}/perl-diff-adjudication.json`)
