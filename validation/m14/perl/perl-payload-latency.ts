/**
 * PERL PAYLOAD AND LATENCY — before and after an edge change.
 *
 * ## Why the measurement is taken twice
 *
 * `bb_graph`'s un-narrowed default returns every relationship the analyzer
 * emitted, so an edge added to ANY type grows the DEFAULT payload whether or not
 * the caller asked for that type. ONTOLOGY-WORKSTREAM Part 2 quantifies the
 * shape: 2.5x-4.8x a filtered answer (lodash 487 KiB vs 101 KiB, ripgrep 795 vs
 * 321). A lane that adds edges without measuring the default is therefore
 * spending somebody else's budget, and the doc's instruction is explicit: if an
 * addition regresses a budgeted lane, REPORT it — do not quietly re-baseline.
 *
 * So this measures four numbers on the SAME file list, which is what makes the
 * comparison like-for-like:
 *
 *   unfilteredBytes   JSON of every relationship from the sample
 *   filteredBytes     JSON of ONE type's relationships from the same sample
 *   ratio             unfiltered / filtered, the shape the workstream budgets
 *   parseWallMs       production parseFile over the sample
 *   analyzeOnlyMs     analyzer.analyze over already-parsed trees, so the
 *                     analyzer's own cost is separable from tree-sitter's
 *
 * ## The file list is derived, never hand-written
 *
 * `git ls-files` per repo under the corpus root, `<= 512 KiB`,
 * `detectLanguageFromPath === "perl"` — the same derivation the census and the
 * ontology gate use. M14-HONESTY-CONTRACT's population rule: a count of zero is
 * a claim that needs its population attached, and a hand-written array rots
 * silently. The population is printed with every artifact.
 *
 * The default sample is a STRIDE, not the first N: the census showed that a
 * leading slice of any perl repo lands in one subdirectory (t/, or lib/), and a
 * stride crosses the whole repo. The stride width is printed so the sample can
 * be argued with.
 *
 * ## Taking the "before" measurement
 *
 * Check out the earlier analyzer blob, run this again with a different
 * `PERL_PAYLOAD_LABEL`, and diff the two artifacts. Nothing here reads a text
 * pattern; every decision is a node type, a field name, or an integer compare.
 *
 * Usage:
 *   PERL_PAYLOAD_LABEL=after bun validation/m14/perl/perl-payload-latency.ts
 *   git checkout <sha> -- src/ast/real-perl-analyzer.ts
 *   PERL_PAYLOAD_LABEL=before bun validation/m14/perl/perl-payload-latency.ts
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WANT = Number(process.argv[2] || 400)
const STRIDE = Number(process.argv[3] || 12)
const LABEL = process.env.PERL_PAYLOAD_LABEL ?? "current"
const OUTDIR = path.join(ROOT, "validation", "m14", "perl")
mkdirSync(OUTDIR, { recursive: true })

// ---------------------------------------------------------------- population
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RelationshipType } = await import(path.join(ROOT, "src/ast/types.ts"))

const all: { abs: string; rel: string; repo: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "perl") continue
    all.push({ abs, rel, repo: e })
  }
}
if (!all.length) { console.error(`NO CORPUS under ${CR} — this is NOT a pass.`); process.exit(2) }
all.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))

/** A stride, so the sample crosses every repo and every subdirectory rather than
 *  landing in whichever one sorts first. The first version of a leading slice
 *  drew only `t/` files from perl5-core. */
const sample = all.filter((_, i) => i % STRIDE === 0).slice(0, WANT)

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))

const allRels: any[] = []
let parseWallMs = 0
let analyzeOnlyMs = 0
let failed = 0
const perType = new Map<string, number>()
const perRepoSample = new Map<string, number>()

for (const f of sample) {
  perRepoSample.set(f.repo, (perRepoSample.get(f.repo) ?? 0) + 1)
  const t0 = performance.now()
  let res: any
  try {
    res = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    failed++
    continue
  }
  parseWallMs += performance.now() - t0
  for (const r of res.relationships ?? []) {
    allRels.push(r)
    const t = String(r.type ?? r.relationshipType ?? "")
    perType.set(t, (perType.get(t) ?? 0) + 1)
  }
  // The analyzer's own cost, separable from tree-sitter's.
  try {
    const src = readFileSync(f.abs, "utf8")
    const tree = parser.parse(src)
    const a0 = performance.now()
    new RealPerlAnalyzer().analyze(tree.rootNode, src, f.abs)
    analyzeOnlyMs += performance.now() - a0
    tree.delete?.()
  } catch {
    // counted in `failed` above by the production call; not double counted here
  }
}

const unfiltered = JSON.stringify(allRels)
const byType = new Map<string, any[]>()
for (const r of allRels) {
  const t = String(r.type ?? r.relationshipType ?? "")
  if (!byType.has(t)) byType.set(t, [])
  byType.get(t)!.push(r)
}
const shapes = [...byType.entries()]
  .map(([type, rows]) => ({ type, count: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows)) }))
  .sort((a, b) => b.bytes - a.bytes)
const largest = shapes[0]
const largestJson = largest ? JSON.stringify(byType.get(largest.type)) : "[]"

// The ratio the workstream budgets: un-narrowed over kind-filtered. Measured
// against the LARGEST type because that is the most favourable denominator, and
// reported against the SMALLEST too, which is the least favourable.
const smallest = shapes[shapes.length - 1]
const smallestJson = smallest ? JSON.stringify(byType.get(smallest.type)) : "[]"

const artifact = {
  label: LABEL,
  generatedAt: new Date().toISOString(),
  head: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  population: {
    corpusRoot: CR,
    admittedFiles: all.length,
    derivation: "git ls-files per repo, <=512KiB, detectLanguageFromPath === 'perl'",
    sampled: sample.length,
    stride: STRIDE,
    reposInSample: [...perRepoSample.entries()].sort((a, b) => b[1] - a[1]),
  },
  relationships: allRels.length,
  unfilteredBytes: Buffer.byteLength(unfiltered),
  largestType: largest?.type ?? null,
  largestTypeBytes: largest?.bytes ?? 0,
  largestTypeEdges: largest?.count ?? 0,
  ratioOverLargest: largest?.bytes ? Number((Buffer.byteLength(unfiltered) / largest.bytes).toFixed(3)) : null,
  smallestType: smallest?.type ?? null,
  smallestTypeBytes: smallest?.bytes ?? 0,
  ratioOverSmallest: smallest?.bytes ? Number((Buffer.byteLength(unfiltered) / smallest.bytes).toFixed(3)) : null,
  shapes,
  parseWallMs: Math.round(parseWallMs),
  analyzeOnlyMs: Math.round(analyzeOnlyMs),
  avgMsPerFileParse: Number((parseWallMs / Math.max(1, sample.length)).toFixed(2)),
  avgMsPerFileAnalyze: Number((analyzeOnlyMs / Math.max(1, sample.length)).toFixed(2)),
  failed,
  offEnumTypes: [...byType.keys()].filter((t) => !(Object.values(RelationshipType) as string[]).includes(t)),
}
const outFile = path.join(OUTDIR, `perl-payload-latency-${LABEL}.json`)
writeFileSync(outFile, JSON.stringify(artifact, null, 2))

const kb = (n: number) => `${(n / 1024).toFixed(1)} KiB`
console.log(`PERL PAYLOAD/LATENCY  label=${LABEL}  head=${artifact.head.slice(0, 9)}`)
console.log(`population: ${all.length} admitted files, sampled ${sample.length} at stride ${STRIDE}, across ${perRepoSample.size} repos`)
console.log(`           ${[...perRepoSample.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`relationships in the sample: ${allRels.length}`)
console.log(`unfiltered payload: ${kb(artifact.unfilteredBytes)}`)
console.log(`largest type (${artifact.largestType}): ${kb(artifact.largestTypeBytes)} over ${artifact.largestTypeEdges} edges   ratio ${artifact.ratioOverLargest}x`)
console.log(`smallest type (${artifact.smallestType}): ${kb(artifact.smallestTypeBytes)}   ratio ${artifact.ratioOverSmallest}x`)
console.log(`parse wall ${artifact.parseWallMs} ms over ${sample.length} files (${artifact.avgMsPerFileParse} ms/file); analyze only ${artifact.analyzeOnlyMs} ms (${artifact.avgMsPerFileAnalyze} ms/file)`)
console.log(`per type:`)
for (const s of shapes) console.log(`  ${s.type.padEnd(13)} ${String(s.count).padStart(6)} edges  ${kb(s.bytes)}`)
console.log(`off-enum relationship types: ${artifact.offEnumTypes.join(" ") || "none"}`)
console.log(`wrote ${outFile}`)
void smallestJson
