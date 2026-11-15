/**
 * MAKE COMPLEXITY — is the walk linear in tree size, and where does it sit
 * against its sibling family?
 *
 * Two claims, kept apart because they fail apart:
 *
 *  1. LINEARITY. Cost per 1,000 AST nodes, bucketed by file size. A per-file
 *     average alone cannot distinguish O(n) from O(n^2) over a narrow size
 *     range, so the buckets are quartiles of the corpus and the SPREAD across
 *     them is the number. A flat spread is the evidence; the absolute cost is
 *     not, because the box is shared by nine agents.
 *  2. THE SIBLING BAND. Same-shape languages measured in a fixed node-count band,
 *     because a raw ms/file comparison is a comparison of corpus sizes. Make's
 *     nearest neighbours by GRAMMAR SHAPE are the other small declarative config
 *     languages, and the honest comparison is against those.
 *
 * Load is recorded because every timing here is a timing on a busy machine, and
 * a number without its load is a number nobody should act on.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { RealMakefileAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/engine/../../ast/real-makefile-analyzer"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"

const REPO = "/home/ishaq2321/backbencher-brain"
const OUT = "/home/ishaq2321/bb_tests/make/out"
const MAN = JSON.parse(readFileSync(`${OUT}/corpus-manifest.json`, "utf8"))
const REPOS = "/home/ishaq2321/bb_tests/repositories"

const loadAvg = () => {
  try { return Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]) } catch { return -1 }
}

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load(`${REPO}/wasm/tree-sitter-make.wasm`))
const analyzer = new RealMakefileAnalyzer()

// ---- size buckets over the whole corpus ----
// FIXED node bands, not quartiles, and the reason is measured: 50 of this
// corpus's 99 files sit within a few nodes of each other (the tf-aws-components
// Makefiles are near-identical stubs), so quartiles collapse to n=1 and n=0 and
// a "spread" computed over them is a number with no data behind it. Fixed bands
// put the files where they actually are, and the per-band n is printed so a thin
// band cannot read as a measured one.
const sized: { abs: string; nodes: number; bytes: number }[] = []
for (const f of MAN.fileList) {
  const abs = `${REPOS}/${f.repo}/${f.rel}`
  const content = readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  if (!tree) continue
  sized.push({ abs, nodes: tree.rootNode.descendantCount + 1, bytes: content.length })
}

const BANDS: [number, number][] = [[0, 40], [40, 80], [80, 160], [160, 320], [320, Infinity]]
const bandOf = (n: number) => BANDS.findIndex(([lo, hi]) => n >= lo && n < hi)

const perK: number[][] = BANDS.map(() => [])
const perFileMs: number[][] = BANDS.map(() => [])
const loadAtStart = loadAvg()
for (const { abs, nodes } of sized) {
  const content = readFileSync(abs, "utf8")
  // one untimed warm-up so wasm/grammar init is not charged to the first file
  try { analyzer.analyze(parser.parse(content)!.rootNode as any, content, abs) } catch { continue }
  const t0 = performance.now()
  let runs = 0
  for (let r = 0; r < 5; r++) {
    const tree = parser.parse(content)
    if (!tree) continue
    analyzer.analyze(tree.rootNode as any, content, abs)
    runs++
  }
  const ms = (performance.now() - t0) / Math.max(1, runs)
  const b = bandOf(nodes)
  if (b >= 0) { perK[b].push((ms / nodes) * 1000); perFileMs[b].push(ms) }
}
const loadAtEnd = loadAvg()

const stats = (xs: number[]) => {
  if (xs.length === 0) return { n: 0, mean: 0, min: 0, max: 0 }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return { n: xs.length, mean: +mean.toFixed(3), min: +Math.min(...xs).toFixed(3), max: +Math.max(...xs).toFixed(3) }
}
const buckets = BANDS.map(([lo, hi], i) => ({
  band: hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`,
  nodes: perK[i].length ? stats(perK[i]) : null,
  perFile: perFileMs[i].length ? stats(perFileMs[i]) : null,
}))

// The linearity claim, stated so it can be checked: cost per 1,000 nodes should
// not GROW with file size if the walk is linear. It is expected to FALL at the
// small end, because a fixed per-file cost (parser setup, symbol maps) is
// amortised over fewer nodes — so the test is whether the largest populated band
// is not materially ABOVE the smallest populated one.
const populated = buckets.filter((b) => b.nodes && b.nodes.n >= 3)
const smallest = populated[0], largest = populated[populated.length - 1]
const growth = smallest && largest && smallest.nodes!.mean > 0
  ? +(largest.nodes!.mean / smallest.nodes!.mean).toFixed(3) : 0

const report: Record<string, unknown> = {
  lane: "make",
  bands: buckets,
  linearity: {
    method: "cost per 1,000 AST nodes across FIXED node bands, not quartiles — 50 of 99 files sit within a few nodes of each other, so quartiles collapse to n=1/n=0",
    smallestPopulatedBand: smallest?.band, largestPopulatedBand: largest?.band,
    perKratioLargestOverSmallest: growth,
    verdict: growth > 0 && growth <= 1.25
      ? "no growth in per-node cost with file size: consistent with linear"
      : `per-node cost ${growth}x higher at the large end: investigate`,
  },
  load: { atStart: loadAtStart, atEnd: loadAtEnd },
}

// ---- the fixed-band sibling comparison ----
// A fixed node-count band, because a raw ms/file number is a comparison of
// corpus sizes rather than of analyzers.
const BAND_LO = 40, BAND_HI = 200

// production entry, so the timing includes the layer the product actually calls
{
  const band = sized.filter((s: { nodes: number }) => s.nodes >= BAND_LO && s.nodes <= BAND_HI)
  const times: number[] = []
  for (const s of band) {
    const content = readFileSync(s.abs, "utf8")
    try { await ASTEngine.parseFile(s.abs, content) } catch { continue }
    const t0 = performance.now()
    for (let r = 0; r < 3; r++) await ASTEngine.parseFile(s.abs, content)
    times.push((performance.now() - t0) / 3)
  }
  const perFile = stats(times)
  const perK2 = stats(times.map((ms, i) => (ms / band[i]!.nodes) * 1000))
  report.bandComparison = {
    band: `${BAND_LO}-${BAND_HI} nodes`, files: band.length, via: "ASTEngine.parseFile (production)",
    perFile, perK: perK2,
  }
}

writeFileSync(`${OUT}/complexity.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`cost by fixed node band (ms per 1,000 AST nodes, and ms per file):`)
for (const b of buckets) {
  if (!b.nodes || !b.perFile) { console.log(`  ${String(b.band).padEnd(10)} (no files)`); continue }
  console.log(`  ${String(b.band).padEnd(10)} n=${String(b.nodes.n).padStart(2)}  per-1k mean ${String(b.nodes.mean).padStart(8)} (min ${b.nodes.min}, max ${b.nodes.max})   per-file mean ${b.perFile.mean}`)
}
console.log(`  per-node cost ratio, largest populated band / smallest populated band: ${growth}`)
console.log(`  verdict: ${(report.linearity as any).verdict}`)
const bc = report.bandComparison as any
console.log(`\nband ${bc.band}, ${bc.files} files, via ${bc.via}:`)
console.log(`  per file : mean ${bc.perFile.mean} ms  (min ${bc.perFile.min}, max ${bc.perFile.max})`)
console.log(`  per 1k   : mean ${bc.perK.mean} ms`)
console.log(`\nload: ${loadAtStart} -> ${loadAtEnd}  (recorded because every timing above is a timing on a shared box)`)
