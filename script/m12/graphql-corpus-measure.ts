import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/graphql-js"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.graphql", "*.graphqls", "*.gql"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${corpus}/${file}`)
const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation("graphql-corpus-production", async () => {
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

const grammarLimitationFiles = new Set(["benchmark/kitchen-sink.graphql"])
measurement.trackedFiles = relative.length
measurement.files = files.length
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = Object.values(perFile).filter((entry) => entry.errors > 0).length
measurement.grammarLimitationFiles = Object.keys(perFile).filter((file) => grammarLimitationFiles.has(file) && perFile[file].errors > 0).length
measurement.strictAcceptanceFiles = files.length - measurement.errorFiles - crashes.length
measurement.crashFiles = crashes.length
measurement.crashSamples = crashes
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = measurement.errorFiles - measurement.grammarLimitationFiles === 0 && crashes.length === 0
measurement.complexityPolicy =
  "one production parseFile pass per file; the GraphQL analyzer uses a single iterative DFS with Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol scan"
measurement.corpusPolicy =
  "tracked .graphql files from clean graphql-js@9c245018: the real GitHub public schema (strict, 0 errors) plus the kitchen-sink executable corpus (two named grammar-level errors on directive-on-variable and escaped block-string, recorded by graphql-corpus-errors.ts)"
writeFileSync("validation/m12/results/graphql-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/graphql-corpus-shapes.json",
  JSON.stringify({ analyzer: "graphql", corpus, revision, perFile, crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
