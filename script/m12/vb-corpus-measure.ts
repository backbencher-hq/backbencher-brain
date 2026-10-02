import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

// M60 (vb, 2026-09-29). VB was the ONE lane of 42 with no entry in
// validation/m60/analyzer-budget-register.json — not because it was measured and
// passed, but because nothing had ever produced its artifact, so R6's
// "analyzer's time-complexity envelope must be a measurement" had no row to
// read. 41 sibling lanes have one, including every lane added in this wave
// (hcl, lua, make, perl, sql, xml, r, zig). This is that artifact.
//
// The primary corpus is P3D-Legacy: 1,880 tracked .vb files of a real Windows
// Forms codebase, the largest VB.NET-dominant holding in the box. DISMTools (483
// files, a Windows Forms authoring tool) is the lane's second opinion and is
// measured by the same script under --repo; the register reads the primary.
//
// `passed` is deliberately NOT tuned. It requires zero error files and zero
// crashes, and this grammar does not parse the whole corpus clean: the profile
// measured over 2,660 files is 1,386 clean, 950 EOF-only and 324 with real
// errors, so an error-file count above zero is the honest result and is recorded
// as such rather than absorbed into a threshold. A gate that reports the truth
// about a vendored grammar is worth more than a green row.
const ROOT = process.cwd()
const repoArg = process.argv.find((a) => a.startsWith("--repo="))
const repo = repoArg ? repoArg.split("=")[1]! : "p3d"
const CORPUS_ROOT = "$HOME/fixtures/vb-corpus"
const corpus = `${CORPUS_ROOT}/${repo}`
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const allRelative = execFileSync("git", ["-C", corpus, "ls-files", "*.vb"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = allRelative.map((file) => `${corpus}/${file}`)
const perFile: Record<string, { symbols: number; relationships: number; errors: number; ms: number }> = {}
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation(`vb-corpus-production`, async () => {
  let symbols = 0
  let relationships = 0
  let errors = 0
  for (let i = 0; i < files.length; i++) {
    const started = performance.now()
    try {
      const parsed = await parseFile(files[i]!, ROOT)
      const fileSymbols = parsed.symbols?.length ?? 0
      const fileRelationships = parsed.relationships?.length ?? 0
      const fileErrors = parsed.errors?.length ?? 0
      symbols += fileSymbols
      relationships += fileRelationships
      errors += fileErrors
      perFile[allRelative[i]!] = {
        symbols: fileSymbols,
        relationships: fileRelationships,
        errors: fileErrors,
        ms: Math.round((performance.now() - started) * 100) / 100,
      }
    } catch (error: any) {
      crashes.push({ file: allRelative[i]!, error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  return { symbols, relationships, errors }
}, { files: files.length, corpus, revision })

measurement.trackedFiles = allRelative.length
measurement.files = files.length
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = Object.values(perFile).filter((entry) => entry.errors > 0).length
measurement.crashFiles = crashes.length
measurement.crashSamples = crashes
measurement.acceptanceFiles = files.length - measurement.errorFiles - crashes.length
measurement.excludedFiles = [] as string[]
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = measurement.errorFiles === 0 && crashes.length === 0
measurement.complexityPolicy =
  "one production parseFile pass per tracked file; the vb analyzer's walk is a single pre-order sweep with containment resolved in one trailing pass, and relationship dedupe is a per-file Set keyed label+target, so the envelope is O(nodes + emitted facts) with no per-symbol rescan of the tree"
measurement.corpusPolicy =
  `tracked .vb files from a clean ${repo}@${revision.slice(0, 8)}; the whole holding is measured and nothing is excluded, so errorFiles below is the real parse-error profile of a vendored, patched grammar rather than a curated subset`

const out = `validation/m12/results/vb-corpus-complexity.json`
writeFileSync(out, JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  `validation/m12/results/vb-corpus-shapes.json`,
  JSON.stringify({ analyzer: "vb", repo, corpus, revision, perFile, crashes }, null, 2) + "\n",
)
console.log(
  `vb ${repo}@${revision.slice(0, 8)}  files=${measurement.files}  symbols=${measurement.symbols}  ` +
    `relationships=${measurement.relationships}  errors=${measurement.errors}  ` +
    `errorFiles=${measurement.errorFiles}  crashes=${measurement.crashFiles}  ` +
    `wallMs=${measurement.wallTimeMs}  filesPerSec=${measurement.filesPerSecond?.toFixed(1)}  ` +
    `passed=${measurement.passed}`,
)
