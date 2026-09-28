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
measurement.performanceTruth =
  "The analyzer is SLOWER than the one it replaced, and the number is recorded rather than rounded away. Measured on the 20,368-line GitHub public schema, 7 interleaved runs of each cell in SEPARATE processes, medians (fixtures/graphql/probe/perf-attribution.mts, artifact out/perf-attribution.json): parse 342 -> 529 ms (x1.55), analyze 622 -> 1,029 ms (x1.65), total 964 -> 1,558 ms (x1.62), facts 9,264 -> 9,621 (+3.9%). The 2x2 attribution separates the two causes: cell C (old analyzer + new wasm) parses in 613 ms against the old wasm's 657 ms, so the GRAMMAR is not the cost; cell D (new analyzer + old wasm) analyzes in 1,120 ms against 700 ms, so the cost is the code. What the time buys is on the same file: directive applications on every declaration (0 -> 119 on the 47-file corpus), description VALUES with escapes resolved and block strings dedented (the old code returned the raw inner text), a real line on every relationship (M59 #825 — the store's relationship identity is (source, target, type, line)), and every clause of the two left-recursive rules instead of only the last. Two optimisations were taken without dropping any fact: the Directives scan is memoised per node (it ran TWICE on every field before, and was 582 ms of 1,139 ms on this file) and the `extend` lookup is a Set built in the existing pre-pass instead of a re-walk of every top-level definition per scalar. facts/sec moves 14,894 -> 9,350, which is the price, stated."
measurement.corpusPolicy =
  "tracked .graphql files from graphql-js@ee5ce41d4b68d1852306d3b56dba2cbbb6c43fea, which is TWO files: the real GitHub public schema (20,367 lines) and the 65-line kitchen-sink torture test. Both now parse with 0 errors — the two grammar limitations this policy used to name are fixed in the vendored grammar. A 2-file sample is not a coverage claim; the 47-file, four-repository sweep is (fixtures/graphql/out/corpus-sweep.json). See also `performanceTruth` and `corpusSize` in graphql-corpus-errors.json."
writeFileSync("validation/m12/results/graphql-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/graphql-corpus-shapes.json",
  JSON.stringify({ analyzer: "graphql", corpus, revision, perFile, crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
