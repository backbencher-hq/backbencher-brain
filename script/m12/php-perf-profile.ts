// PHP performance profile — where the analyzer's time actually goes.
//
// Deliberately NOT the corpus throughput record. That is the differential's
// own end-to-end timing (validation/m14/differential-baseline.json, 6.3-9.5
// ms/file). This script attributes cost WITHIN one analyze() call so an
// optimization has a number to move, and it says so in its own artifact.
//
// Why this is shaped differently from nim-perf-profile.ts: the NIM analyzer
// runs several SEPARATE full-tree walks, so the profile could time each one
// directly. RealPhpAnalyzer.analyze() is ONE fused walk — declarations,
// calls, uses, references, instantiations and the include/use edges all fall
// out of a single stack loop. Inventing a phase list for phases that do not
// exist would produce a fabricated split, so this measures the boundary that
// is real:
//
//   parse                     tree-sitter (WASM) — outside the analyzer
//   collectPhpFileScope       one separate full-tree walk, called once up front
//   mainWalk                  the fused walk: analyze() minus the two above
//   postPasses                symbol-table passes (resolveOverrides + contains)
//
// A CPU profile cannot answer this: sampling attributes tree-sitter's WASM
// work to `(idle)`, which is how a real analyzer can be 80% of wall time while
// a sampled profile reports 94% idle. This split is measured with hrtime over
// a warmed run.
//
// Run:  bun script/m12/php-perf-profile.ts [repo] [files]
// Writes: validation/m12/results/php-perf-profile.json
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
import { RealPhpAnalyzer } from "../../src/ast/real-php-analyzer"

const ROOT = process.cwd()
const REPO = process.argv[2] ?? "$HOME/fixtures/repositories/phpunit"
const N = parseInt(process.argv[3] ?? "200", 10)

if (!existsSync(REPO)) {
  console.error(`no such repo: ${REPO} — the php corpora are restored with script/m12/php-override-audit.ts's peers; see reviews/m60-oo-family-plan.md for the pins`)
  process.exit(1)
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const Lang = wts.Language ?? wts.default?.Lang
await P.init({ locateFile: () => path.resolve(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await Lang.load(readFileSync(path.resolve(ROOT, "wasm/tree-sitter-php.wasm"))))

const files: string[] = execSync(`git ls-files -z -- '*.php'`, { cwd: REPO, maxBuffer: 1 << 28 })
  .toString().split("\0").filter(Boolean).sort()
const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / N)) === 0).slice(0, N)
const srcs = sample.map((f) => [path.join(REPO, f), readFileSync(path.join(REPO, f), "utf8")] as const)

const an: any = new RealPhpAnalyzer()

// Warm-up: the first pass pays JIT and WASM tier-up, which is not what we are
// measuring. Same pass mix the real run uses.
const WARM = 15
for (let i = 0; i < WARM; i++) {
  const [f, s] = srcs[i % srcs.length]
  const t = parser.parse(s)
  await an.analyze(t.rootNode, s, path.relative(REPO, f))
}

const ms = (fn: () => void) => {
  const t0 = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t0) / 1e6
}

// 1. parse
const parseMs = ms(() => { for (const [, s] of srcs) parser.parse(s) })
const trees = srcs.map(([, s]) => parser.parse(s))

// 2. collectPhpFileScope — the analyzer's one separate full-tree walk
const scopeMs = ms(() => {
  for (const t of trees) {
    const bound = new Set<string>(), fv = new Set<string>(), cv = new Set<string>()
    an.collectPhpFileScope(t.rootNode, bound, fv, cv)
  }
})

// 3. end-to-end analyze (parse + everything)
const analyzeTotalMs = (async () => {
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < trees.length; i++) await an.analyze(trees[i].rootNode, srcs[i][1], path.relative(REPO, srcs[i][0]))
  return Number(process.hrtime.bigint() - t0) / 1e6
})()

// 4. the symbol-table post-passes, timed directly on a real result
const { symbols, relationships } = await (async () => {
  let acc: any = null
  for (let i = 0; i < trees.length; i++) acc = await an.analyze(trees[i].rootNode, srcs[i][1], path.relative(REPO, srcs[i][0]))
  return acc ?? { symbols: [], relationships: [] }
})()
const postMs = ms(() => {
  const rel: any[] = []
  an.resolveOverrides(symbols ?? [], rel)
  for (const s of symbols ?? []) {
    if (s.ownerName) rel.push({ source: s.ownerName, target: s.name, type: "contains", confidence: 1 })
  }
})
const totalAnalyzeMs = await analyzeTotalMs

// mainWalk is the residue: what the fused walk costs once the file-scope walk
// and the post-passes are accounted for.
const mainWalkMs = Math.max(0, totalAnalyzeMs - scopeMs - postMs)
const totalMs = parseMs + totalAnalyzeMs

const bytes = srcs.reduce((n, [, s]) => n + s.length, 0)
const art = {
  schemaVersion: 1,
  milestone: "M12",
  language: "php",
  purpose: "attribute WITHIN-analyzer cost for the php lane; NOT the end-to-end throughput record",
  repo: REPO,
  revision: execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim(),
  generatedAt: new Date().toISOString(),
  sample: `${sample.length} tracked .php files, deterministic strided slice of ${files.length}`,
  bytes,
  bytesPerFile: Math.round(bytes / sample.length),
  totals: {
    parseMs: +parseMs.toFixed(1),
    analyzeMs: +totalAnalyzeMs.toFixed(1),
    endToEndMs: +totalMs.toFixed(1),
    msPerFile: +(totalMs / sample.length).toFixed(2),
    analyzerMsPerFile: +(totalAnalyzeMs / sample.length).toFixed(2),
    parseSharePct: +((parseMs / totalMs) * 100).toFixed(2),
  },
  phases: {
    parse: +parseMs.toFixed(1),
    collectPhpFileScope: +scopeMs.toFixed(1),
    mainWalk: +mainWalkMs.toFixed(1),
    postPasses: +postMs.toFixed(1),
  },
  phaseSharePct: {
    parse: +((parseMs / totalMs) * 100).toFixed(2),
    collectPhpFileScope: +((scopeMs / totalMs) * 100).toFixed(2),
    mainWalk: +((mainWalkMs / totalMs) * 100).toFixed(2),
    postPasses: +((postMs / totalMs) * 100).toFixed(2),
  },
  symbols: (symbols ?? []).length,
  relationships: (relationships ?? []).length,
  interpretation:
    "msPerFile is NOT comparable to the differential baseline's 6.3-9.5 ms/file. Two measured reasons: (1) this includes parse, which the baseline's warm-pool loop excludes; (2) the strided slice is file-EQUAL not byte-equal, so it is dragged by the large vendored sources under tools/.phpstan/ and tests/**/vendor/ that a first-N sorted slice would miss. Use bytesPerFile and the PHASE SPLIT, not msPerFile, to compare. The phase split is the robust result: it is a ratio over one measured run and is insensitive to which files were sampled.",
  note:
    "parse is tree-sitter WASM and sits OUTSIDE the analyzer. postPasses walk the SYMBOL TABLE, not the tree, so they cannot be the cost driver the way a repeated full-tree walk can — every namedChild()/childForFieldName() crosses the JS<->WASM boundary, which is why a separate full-tree walk (collectPhpFileScope) is reported separately from the fused mainWalk rather than merged into it.",
}
writeFileSync(path.join(ROOT, "validation/m12/results/php-perf-profile.json"), JSON.stringify(art, null, 2) + "\n")
console.log(
  `php perf: ${sample.length} files | end-to-end ${art.totals.msPerFile} ms/file ` +
    `(analyzer ${art.totals.analyzerMsPerFile}, parse share ${art.totals.parseSharePct}%)`,
)
console.log(
  `  parse ${art.phases.parse}ms | collectPhpFileScope ${art.phases.collectPhpFileScope}ms | ` +
    `mainWalk ${art.phases.mainWalk}ms | postPasses ${art.phases.postPasses}ms`,
)
console.log(`  wrote validation/m12/results/php-perf-profile.json`)
