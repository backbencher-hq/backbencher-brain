// M12.29: measure PHP extraction on a deterministic tracked phpunit sample.
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/phpunit"
const allRelative = execFileSync("git", ["-C", corpus, "ls-files", "*.php"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const sample = allRelative.slice(0, 400)
const files = sample.map((file) => `${corpus}/${file}`)
const { value, measurement } = await measureOperation(
  "php-corpus-tracked-sample",
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
  kind: "php_corpus_tracked_complexity",
  corpus: "phpunit",
  revision: "c8d6921fb601b6988854cd84a672f06c1e49f80e",
  trackedPhpFiles: allRelative.length,
  sampledFiles: files.length,
  measurement,
  note: "Deterministic first-400 sorted tracked .php files; production pool-worker parseFile path.",
}
writeFileSync("validation/m12/results/php-corpus-complexity.json", JSON.stringify(document, null, 2) + "\n")
console.log(`tracked=${allRelative.length} sampled=${files.length} symbols=${value.symbols} relationships=${value.relationships} parseErrors=${value.errors} wall=${measurement.wallTimeMs.toFixed(1)}ms peakRSS=${(measurement.peakRssBytes / 1048576).toFixed(1)}MB`)
