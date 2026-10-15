/**
 * THE DERIVATION DEBT, paid for `contains` — the lane's own independent oracle,
 * actually run.
 *
 * ## What a DERIVATION finding is
 *
 * A type the analyzer EMITS that the differential never AUDITS: stored, and
 * compared against nothing. `validation/m60/rel-type-coverage-baseline.json`
 * (2026-10-01) records two for rust:
 *
 *   DERIVATION|rust|emits `contains` but the differential audits
 *     ["calls","extends","implements","instantiates","overrides","references","uses"]
 *   DERIVATION|rust|emits `exports` but the differential audits [same eight]
 *
 * and the audited set is read by EVALUATING `differential.ts`'s own filter
 * expression, so those are the harness's words and not a restatement. A third
 * (`imports`) was added after that baseline was taken, by the lane's own
 * INCOMING_RUST commit: the allowlist's per-language clause has no `rust` arm
 * for it.
 *
 * ## The half of it that is a one-line finding
 *
 * `script/m14/differential.ts:57` IMPORTS `deriveRustContainsTruth` from
 * `script/m14/oracles/rust-contains.ts` — a 225-line, lane-owned oracle with its
 * rule documented — and CALLS IT ZERO TIMES (`grep -c` over the file returns 1,
 * which is the import line itself). So the truth exists and nothing compares it.
 * `differential.ts` and the coverage gate are MASTER-owned, so this script does
 * not edit them; it RUNS the oracle instead, which is the measurement the master
 * needs in order to make the change safely.
 *
 * ## What independence this has, and what it does not
 *
 * The oracle is a separate walker over the SAME grammar. It shares no rule table,
 * key set, member list or resolver with `RealRustAnalyzer` — its own header says
 * so and the claim is checkable by reading both. So a DISAGREEMENT is a real
 * finding. What it CANNOT show is agreement about anything the grammar itself
 * gets wrong, because a shared grammar bug is invisible to two walkers over it.
 * That is the harness's declared limitation and it is stated here rather than
 * papered over with a percentage.
 *
 * ## NO REGULAR EXPRESSION
 *
 * Tree walk and `Set` membership only.
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-contains-oracle-check.ts [--repo=ripgrep] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"
import { RealRustAnalyzer } from "../../src/ast/real-rust-analyzer"
import { deriveRustContainsTruth } from "../m14/oracles/rust-contains"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const WANT_JSON = ARGS.includes("--json")
const REPO_FILTER = ARGS.find((a) => a.startsWith("--repo="))?.slice(7)

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && e !== REPO_FILTER) continue
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
    try { if (statSync(abs).size > 2 * 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs, "") !== "rust") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))

const parser = await getParser("rust")
const analyzer = new RealRustAnalyzer()

/** Analyzer `contains` rows for one file, as `owner|target`. */
function analyzerContains(root: any, content: string, abs: string): Set<string> {
  const res: any = analyzer.analyze(root, content, abs)
  const out = new Set<string>()
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    if (t.toLowerCase() !== "contains") continue
    out.add(`${r.source}|${r.target}`)
  }
  return out
}

let filesCompared = 0
let truthTotal = 0
let analyzerTotal = 0
let agreed = 0
let onlyTruth = 0
let onlyAnalyzer = 0
let cleanFiles = 0
const truthOnlyExamples: string[] = []
const analyzerOnlyExamples: string[] = []
const failures: string[] = []

for (const f of files) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { failures.push(`${f.repo}/${f.rel}`); continue }
  let tree: any
  try { tree = await parser.parse(content, f.abs) } catch { failures.push(`${f.repo}/${f.rel}`); continue }
  const truth = new Set<string>()
  for (const t of deriveRustContainsTruth(tree.rootNode)) truth.add(`${t.from}|${t.target}`)
  const got = analyzerContains(tree.rootNode, content, f.abs)
  tree?.delete?.()
  filesCompared++
  truthTotal += truth.size
  analyzerTotal += got.size
  let fileClean = true
  for (const k of truth) {
    if (got.has(k)) agreed++
    else {
      onlyTruth++
      fileClean = false
      if (truthOnlyExamples.length < 12) truthOnlyExamples.push(`${f.repo}/${f.rel}  ${k}`)
    }
  }
  for (const k of got) {
    if (!truth.has(k)) {
      onlyAnalyzer++
      fileClean = false
      if (analyzerOnlyExamples.length < 12) analyzerOnlyExamples.push(`${f.repo}/${f.rel}  ${k}`)
    }
  }
  if (fileClean) cleanFiles++
}

const union = agreed + onlyTruth + onlyAnalyzer
const report = {
  population: { root: CR, repos: [...new Set(files.map((f) => f.repo))], files: files.length },
  filesCompared,
  cleanFiles,
  parseFailures: failures,
  oracle: {
    module: "script/m14/oracles/rust-contains.ts",
    calledByDifferential: false,
    edges: truthTotal,
  },
  analyzerEdges: analyzerTotal,
  agreed,
  onlyOracle: onlyTruth,
  onlyAnalyzer,
  oracleOnlyExamples: truthOnlyExamples,
  analyzerOnlyExamples,
  rates: {
    // Agreement over the ORACLE's set (does the analyzer publish everything the
    // rule says it should?) and over the ANALYZER's set (does it publish
    // anything the rule does not sanction?). Two numbers because one hides the
    // other: 100% recall with 200% precision is not a pass.
    recall: union === 0 ? null : agreed / (agreed + onlyTruth),
    precision: union === 0 ? null : agreed / (agreed + onlyAnalyzer),
  },
  independence: "a separate walker over the SAME grammar: a disagreement is a real finding, a shared grammar bug is invisible to both",
}

if (WANT_JSON) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log("rust `contains` — independent-oracle check")
  console.log(`  population: ${files.length} files in [${report.population.repos.join(", ")}] · ${filesCompared} compared · ${cleanFiles} with zero disagreement · parse failures ${failures.length}`)
  console.log(`  oracle ${report.oracle.module} (imported by differential.ts:57, called 0 times) -> ${truthTotal} edges`)
  console.log(`  analyzer                                                          -> ${analyzerTotal} edges`)
  console.log(`  agreed ${agreed} · oracle-only ${onlyTruth} · analyzer-only ${onlyAnalyzer}`)
  const pc = (x: number): string => `${(x * 100).toFixed(2)}%`
  console.log(`  recall (of the oracle's edges)     ${report.rates.recall === null ? "-" : pc(report.rates.recall)}`)
  console.log(`  precision (of the analyzer's edges) ${report.rates.precision === null ? "-" : pc(report.rates.precision)}`)
  if (truthOnlyExamples.length) {
    console.log(`\n  oracle-only (the analyzer omits these):`)
    for (const x of truthOnlyExamples) console.log(`    ${x}`)
  }
  if (analyzerOnlyExamples.length) {
    console.log(`\n  analyzer-only (the oracle does not sanction these):`)
    for (const x of analyzerOnlyExamples) console.log(`    ${x}`)
  }
  console.log(`\n  ${report.independence}`)
}