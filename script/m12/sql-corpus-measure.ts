import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/ProxiCall"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.sql", "*.SQL", "*.psql", "*.ddl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${corpus}/${file}`)
const errorsByFile: { file: string; errors: number }[] = []
const crashes: { file: string; error: string }[] = []
const fileCounts = new Map<string, { symbols: number; relationships: number; errors: number }>()

const { value, measurement } = await measureOperation(
  "sql-corpus-production",
  async () => {
    let symbols = 0
    let relationships = 0
    let errors = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const parsed = await parseFile(file, ROOT)
        symbols += parsed.symbols?.length ?? 0
        relationships += parsed.relationships?.length ?? 0
        const count = parsed.errors?.length ?? 0
        errors += count
        fileCounts.set(relative[i], { symbols: parsed.symbols?.length ?? 0, relationships: parsed.relationships?.length ?? 0, errors: count })
        if (count) errorsByFile.push({ file: relative[i], errors: count })
      } catch (error: any) {
        crashes.push({ file: relative[i], error: String(error?.message ?? error).slice(0, 300) })
        errors++
      }
    }
    return { symbols, relationships, errors }
  },
  { files: files.length, corpus, revision: execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() },
)
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = errorsByFile.length
measurement.crashFiles = crashes.length
measurement.errorSamples = errorsByFile
measurement.crashSamples = crashes
const excluded = new Set(errorsByFile.map((entry) => entry.file))
measurement.cleanFiles = relative.filter((file) => !excluded.has(file))
measurement.excludedFiles = errorsByFile.map((entry) => entry.file)
measurement.cleanSymbols = measurement.cleanFiles.reduce((sum: number, file: string) => sum + (fileCounts.get(file)?.symbols ?? 0), 0)
measurement.cleanRelationships = measurement.cleanFiles.reduce((sum: number, file: string) => sum + (fileCounts.get(file)?.relationships ?? 0), 0)
measurement.cleanErrors = measurement.cleanFiles.reduce((sum: number, file: string) => sum + (fileCounts.get(file)?.errors ?? 0), 0)
measurement.corpusPolicy = "tracked SQL subset; cleanFiles are the acceptance subset, excluded files retain grammar-error evidence"
writeFileSync("validation/m12/results/sql-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
console.log(JSON.stringify({ files: files.length, cleanFiles: measurement.cleanFiles.length, excludedFiles: errorsByFile.length, symbols: value.symbols, relationships: value.relationships, errors: value.errors, crashes: crashes.length, measurement }, null, 2))
