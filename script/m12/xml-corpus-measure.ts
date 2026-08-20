import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/grails-core"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.xml", "*.xsd"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${corpus}/${file}`)
const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const errorSamples: { file: string; errors: number }[] = []
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation("xml-corpus-production", async () => {
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
      if (fileErrors) errorSamples.push({ file: relative[i], errors: fileErrors })
    } catch (error: any) {
      crashes.push({ file: relative[i], error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  return { symbols, relationships, errors }
}, { files: files.length, corpus, revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() })

measurement.files = files.length
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = errorSamples.length
measurement.crashFiles = crashes.length
measurement.errorSamples = errorSamples
measurement.crashSamples = crashes
measurement.acceptanceFiles = files.length - errorSamples.length - crashes.length
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = errorSamples.length === 0 && crashes.length === 0
measurement.complexityPolicy = "single iterative AST traversal per file; attribute and relationship insertion are O(1) per emitted node, with a Set-based relationship dedupe"
writeFileSync("validation/m12/results/xml-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync("validation/m12/results/xml-corpus-shapes.json", JSON.stringify({ analyzer: "xml", perFile, errors: errorSamples, crashes }, null, 2) + "\n")
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
