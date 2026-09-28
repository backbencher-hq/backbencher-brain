// M12.31: measure NIM extraction on every tracked .nim/.nims file of the 12-repo
// corpus, through the production pool-worker parseFile path.
//
// Mirrors perl-corpus-measure.ts (M12.30) and keeps the same three claims apart:
// THROUGHPUT (wall time, symbols/s, relationships/s over the whole corpus),
// EXTRACTION YIELD (symbols and relationships per file, so a regression that
// drops edges shows up as a number rather than as silence), and COMPLEXITY
// (the analyzer's own cyclomatic measure, with the worst files named so the
// number is anchored to real code instead of floating as an average).
//
// `git ls-files -z` is used rather than the newline form: a NIM corpus contains
// non-ASCII paths (the Nim compiler ships lib/pure/unicode and a UTF-8 filename
// in its own test suite), and the newline split silently mangled them into
// phantom "file not found" errors that were then counted as analyzer crashes.
// That was a harness bug reported as 3,000+ parse failures.
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

// `--direct` measures the analyzer in-process with one parser instead of through
// the pool-worker. It exists because the two numbers are DIFFERENT claims and the
// artifact must say which one it is making:
//
//   (default)  the production indexer route, pool-worker parseFile per file —
//              this is the number that says what indexing a NIM repository costs;
//   (--direct) one parser, one process, no worker pool — this is the number that
//              isolates the ANALYZER, and it excludes pool dispatch overhead.
//
// The direct path is also the one that completes on a contended machine: the pool
// stalls at worker startup under load, and a stalled pool produces no artifact at
// all, which is indistinguishable from "never ran". Whichever path ran is written
// into the artifact as `measurement.path`, so the number is never ambiguous.
const DIRECT = process.argv.includes("--direct")
const MEASURE_PATH = DIRECT ? "direct-single-parser" : "production-pool-worker"

const ROOT = process.cwd()

// The 12 pinned corpora, with the revision each was measured at. These are the
// same checkouts nim-corpus-errors.ts scans, so a number here and a count there
// describe one corpus rather than two.
const CORPORA: { name: string; dir: string; revision: string }[] = [
  { name: "nim", dir: "nim", revision: "bb85d2dda5" },
  { name: "nimble", dir: "nimble", revision: "33a6bc8e50" },
  { name: "arraymancer", dir: "arraymancer", revision: "d3b67712a3" },
  { name: "prologue", dir: "prologue", revision: "2956ef2b2d" },
  { name: "pixie", dir: "pixie", revision: "30bb510877" },
  { name: "nitter", dir: "nitter", revision: "376f14908e" },
  { name: "nimterop", dir: "nimterop", revision: "2532ce0d3c" },
  { name: "nigui", dir: "nigui", revision: "8a1bb04bfb" },
  { name: "jester", dir: "jester", revision: "8a491a8e28" },
  { name: "nimtest", dir: "nimtest", revision: "ce88334735" },
  { name: "torrentinim", dir: "torrentinim", revision: "8a0f2294c7" },
  { name: "mosdepth", dir: "mosdepth", revision: "3211a79388" },
]
const BASE = process.env.BB_NIM_CORPUS ?? "$HOME/fixtures/repositories"

// `--repos a,b` narrows the draw. The full 12-repo run needs the whole 41 MB
// grammar resident plus a parsed tree per file, and on a contended machine that
// is a multi-gigabyte peak; when the process is killed mid-run the artifact is
// simply never written, which reads as "no data" rather than as "died". A filter
// makes the scope explicit and the artifact states which repos it covers.
const repoFilter = process.argv.includes("--repos")
  ? new Set(process.argv[process.argv.indexOf("--repos") + 1].split(",").map((x) => x.trim()).filter(Boolean))
  : null

const files: { corpus: string; path: string }[] = []
for (const c of CORPORA) {
  if (repoFilter && !repoFilter.has(c.name)) continue
  const dir = `${BASE}/${c.dir}`
  let tracked: string[] = []
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.nim", "*.nims"], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    })
    tracked = out.toString("utf8").split("\0").filter(Boolean).sort()
  } catch {
    continue
  }
  for (const rel of tracked) files.push({ corpus: c.name, path: `${dir}/${rel}` })
}

if (files.length === 0) {
  console.error("no tracked .nim/.nims files found — refusing to write an empty measurement")
  process.exit(1)
}

const perCorpus: Record<string, { files: number; symbols: number; relationships: number; errors: number }> = {}
for (const c of CORPORA) perCorpus[c.name] = { files: 0, symbols: 0, relationships: 0, errors: 0 }

const complexityByFile: { file: string; max: number; mean: number; count: number }[] = []
const kinds: Record<string, number> = {}
const relKinds: Record<string, number> = {}

let analyzer: unknown = null
let directParser: any = null
if (DIRECT) {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.resolve(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  directParser = new P()
  directParser.setLanguage(await Lang.load(readFileSync(path.resolve(ROOT, "wasm/tree-sitter-nim.wasm"))))
  const mod: any = await import("../../src/ast/real-nim-analyzer")
  analyzer = new mod.RealNimAnalyzer()
}

const { value, measurement } = await measureOperation(
  "nim-corpus-tracked",
  async () => {
    let symbols = 0
    let relationships = 0
    let errors = 0
    let done = 0
    for (const f of files) {
      const bucket = perCorpus[f.corpus]
      bucket.files++
      // Progress per corpus, flushed: a silent 20-minute run that is OOM-killed
      // is indistinguishable from a slow one, and the artifact is only written
      // at the very end.
      done++
      if (done % 250 === 0) process.stderr.write(`  [${done}/${files.length}] ${f.corpus}\n`)
      try {
        const src = readFileSync(f.path, "utf8")
        const parsed = DIRECT
          ? ((await (analyzer as any).analyze((directParser as any).parse(src).rootNode, src, f.path)) as any)
          : await parseFile(f.path, ROOT)
        const syms = parsed?.symbols ?? []
        const rels = parsed?.relationships ?? []
        symbols += syms.length
        relationships += rels.length
        bucket.symbols += syms.length
        bucket.relationships += rels.length
        for (const s of syms) {
          const k = String((s as any).kind ?? "unknown")
          kinds[k] = (kinds[k] ?? 0) + 1
        }
        for (const r of rels) {
          const k = String((r as any).type ?? "unknown")
          relKinds[k] = (relKinds[k] ?? 0) + 1
        }
        // Complexity is per symbol; a file's worst symbol is the honest anchor,
        // because an average over a corpus of mostly-small files hides the fact
        // that one 4,000-line proc scored 1.
        let max = 0
        let sum = 0
        for (const s of syms) {
          const c = Number((s as any).complexity ?? (s as any).metadata?.complexity ?? 1)
          if (Number.isFinite(c)) {
            if (c > max) max = c
            sum += c
          }
        }
        if (syms.length > 0) complexityByFile.push({ file: f.path, max, mean: +(sum / syms.length).toFixed(2), count: syms.length })
        const perr = parsed?.errors?.length ?? 0
        errors += perr
        bucket.errors += perr
      } catch {
        errors++
        bucket.errors++
      }
    }
    return { symbols, relationships, errors }
  },
  { files: files.length },
)

measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.parseErrors = value.errors
measurement.symbolsPerSecond = measurement.wallTimeMs > 0 ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs > 0 ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.filesPerSecond = measurement.wallTimeMs > 0 ? files.length / (measurement.wallTimeMs / 1000) : null

const allComplexity = complexityByFile.flatMap((f) => Array<number>(f.count).fill(f.mean))
const sortedComplexity = [...complexityByFile].sort((a, b) => b.max - a.max)
const worst = sortedComplexity.slice(0, 15)

const document = {
  schemaVersion: 1,
  kind: "nim_corpus_tracked_complexity",
  measurementPath: MEASURE_PATH,
  corpora: CORPORA.map((c) => ({ name: c.name, revision: c.revision })),
  trackedNimFiles: files.length,
  measurement,
  yield: {
    symbolsPerFile: +(value.symbols / files.length).toFixed(2),
    relationshipsPerFile: +(value.relationships / files.length).toFixed(2),
    perCorpus,
  },
  kinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1])),
  relationshipKinds: Object.fromEntries(Object.entries(relKinds).sort((a, b) => b[1] - a[1])),
  complexity: {
    note: "The analyzer's own cyclomatic measure (nimCyclomaticComplexity), per symbol. `worstFiles` is the per-file maximum so the number is anchored to real code.",
    filesWithSymbols: complexityByFile.length,
    meanAcrossFiles: +(complexityByFile.reduce((a, f) => a + f.mean, 0) / Math.max(1, complexityByFile.length)).toFixed(2),
    maxAcrossFiles: sortedComplexity.length > 0 ? sortedComplexity[0].max : null,
    worstFiles: worst,
  },
  note: "Tracked .nim/.nims files only, via the production pool-worker parseFile path; no generated or untracked files included. Revisions are the pinned checkouts under $HOME/fixtures/repositories.",
}
writeFileSync("validation/m12/results/nim-corpus-complexity.json", JSON.stringify(document, null, 2) + "\n")
console.log(
  `nim: files=${files.length} symbols=${value.symbols} relationships=${value.relationships} ` +
    `wall=${measurement.wallTimeMs}ms symbols/s=${measurement.symbolsPerSecond?.toFixed(0)} ` +
    `maxComplexity=${document.complexity.maxAcrossFiles}`,
)
console.log("wrote validation/m12/results/nim-corpus-complexity.json")
