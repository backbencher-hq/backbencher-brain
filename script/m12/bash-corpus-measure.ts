import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/fsharp"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const allRelative = execFileSync("git", ["-C", corpus, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

// The two files with named grammar-level limitations (audited by
// bash-corpus-errors.ts) are excluded from the strict acceptance measurement
// so throughput reflects clean bash.
const excluded = new Set([
  "eng/common/init-tools-native.sh",
  "eng/common/pipeline-logging-functions.sh",
])
const relative = allRelative.filter((file) => !excluded.has(file))
const files = relative.map((file) => `${corpus}/${file}`)
const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation("bash-corpus-production", async () => {
  let symbols = 0
  let relationships = 0
  let errors = 0
  for (let i = 0; i < files.length; i++) {
    try {
      const parsed = await parseFile(files[i], ROOT)
      const fileSymbols = parsed.symbols?.length ?? 0
      const fileRelationships = parsed.relationships?.length ?? 0
      const fileErrors = parsed.errors?.length ?? 0
      symbols += fileSymbols
      relationships += fileRelationships
      errors += fileErrors
      perFile[relative[i]] = { symbols: fileSymbols, relationships: fileRelationships, errors: fileErrors }
    } catch (error: any) {
      crashes.push({ file: relative[i], error: String(error?.message ?? error).slice(0, 300) })
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
measurement.excludedFiles = [...excluded]
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = measurement.errorFiles === 0 && crashes.length === 0
measurement.complexityPolicy =
  "one production parseFile pass per acceptance file; the bash analyzer uses one iterative DFS over the tree with constant-time scope stack, Map-based function params, declaration-dedupe set, and Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol relationship scan"
measurement.corpusPolicy =
  "tracked .sh/.bash files from clean fsharp@22a8a5dc; two named grammar-level limitations (POSIX-class regex match and ] pattern expansion) are excluded and measured separately by bash-corpus-errors.ts"
writeFileSync("validation/m12/results/bash-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/bash-corpus-shapes.json",
  JSON.stringify({ analyzer: "bash", corpus, revision, perFile, excludedFiles: [...excluded], crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
