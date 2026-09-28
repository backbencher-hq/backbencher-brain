// M12.30: measure Perl extraction on all tracked Mojo Perl files.
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/mojo"
const relative = execFileSync("git", ["-C", corpus, "ls-files", "*.pm", "*.pl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const files = relative.map((file) => `${corpus}/${file}`)
const { value, measurement } = await measureOperation(
  "perl-corpus-tracked",
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
  kind: "perl_corpus_tracked_complexity",
  corpus: "mojo",
  revision: "93f591742a7dbc0cee36875ab80a38f0666e32ae",
  trackedPerlFiles: files.length,
  measurement,
  note: "Tracked .pm/.pl files only; production pool-worker parseFile path; no generated or untracked files included.",
}
writeFileSync("validation/m12/results/perl-corpus-complexity.json", JSON.stringify(document, null, 2) + "\n")
console.log(`files=${files.length} symbols=${value.symbols} relationships=${value.relationships} parseErrors=${value.errors} wall=${measurement.wallTimeMs.toFixed(1)}ms peakRSS=${(measurement.peakRssBytes / 1048576).toFixed(1)}MB`)
