// M12.27 evidence reconciliation: measure the pinned Cython Python corpus only.
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"
import { execFileSync } from "node:child_process"
import { statSync, writeFileSync } from "node:fs"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/cython"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.py"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
  .filter((file) => statSync(`${corpus}/${file}`).size >= 1024)
const files = relative.map((file) => `${corpus}/${file}`)
const { value, measurement } = await measureOperation(
  "python-corpus-tracked",
  async () => {
    let symbols = 0
    let relationships = 0
    let errors = 0
    for (const file of files) {
      try {
        const parsed = await parseFile(file, ROOT)
        symbols += parsed.symbols?.length ?? 0
        relationships += parsed.relationships?.length ?? 0
        errors += parsed.errors?.length ?? 0
      } catch {
        errors++
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
const document = {
  schemaVersion: 1,
  kind: "python_corpus_tracked_complexity",
  corpus: "cython",
  revision: "51a460b7d704eb11b6f47abe7983c816d0b77129",
  trackedPythonFiles: files.length,
  measurement,
  note: "Tracked .py files at or above 1 KiB only; production pool-worker parseFile path; no generated, untracked, Cython-only, or non-Python files included.",
}
writeFileSync("validation/m12/results/python-corpus-complexity.json", JSON.stringify(document, null, 2) + "\n")
console.log(`files=${files.length} symbols=${value.symbols} relationships=${value.relationships} parseErrors=${value.errors} wall=${measurement.wallTimeMs.toFixed(1)}ms peakRSS=${(measurement.peakRssBytes / 1048576).toFixed(1)}MB`)
