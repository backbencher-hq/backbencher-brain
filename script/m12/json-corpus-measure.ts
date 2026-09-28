import { execFileSync } from "node:child_process"
import { writeFileSync, readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/roslyn"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.json"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

function strictJson(file: string): boolean {
  try {
    const text = readFileSync(`${corpus}/${file}`, "utf8")
    JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return true
  } catch {
    return false
  }
}

const unsupportedFiles = relative.filter((file) => !strictJson(file))
const cleanRelative = relative.filter((file) => strictJson(file))
const files = cleanRelative.map((file) => `${corpus}/${file}`)
const perFile = new Map<string, { symbols: number; relationships: number; errors: number }>()
const errorFiles: { file: string; errors: number }[] = []
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation(
  "json-corpus-production",
  async () => {
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
        perFile.set(cleanRelative[i], { symbols: fileSymbols, relationships: fileRelationships, errors: fileErrors })
        if (fileErrors) errorFiles.push({ file: cleanRelative[i], errors: fileErrors })
      } catch (error: any) {
        crashes.push({ file: cleanRelative[i], error: String(error?.message ?? error).slice(0, 300) })
      }
    }
    return { symbols, relationships, errors }
  },
  {
    files: files.length,
    corpus,
    revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  },
)

measurement.files = files.length
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = errorFiles.length
measurement.crashFiles = crashes.length
measurement.errorSamples = errorFiles
measurement.crashSamples = crashes
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.acceptanceFiles = cleanRelative.length
measurement.excludedFiles = unsupportedFiles
measurement.excludedFileCount = unsupportedFiles.length
measurement.corpusPolicy = "strict JSON acceptance subset from all git-tracked JSON files at the clean pinned Roslyn revision; non-strict JSONC/encoding files are explicit exclusions"
measurement.passed = errorFiles.length === 0 && crashes.length === 0
writeFileSync("validation/m12/results/json-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
