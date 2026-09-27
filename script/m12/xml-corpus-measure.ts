import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || process.env.XML_CORPUS || "$HOME/fixtures/xml/repos/grails-core"

/**
 * The SAME manifest and the SAME mechanism as xml-corpus-errors.ts, because the
 * two gates must not disagree: the first run of this pair reported green and red
 * respectively on the same corpus, which is the "two artifacts, two verdicts"
 * class the M14 ledger exists to prevent. A declared negative control is
 * measured and reported here too, never excluded.
 */

/** Every tracked file of a corpus matching a glob, so a declared control can be a PATTERN. */
function listOfCorpusFiles(dir: string, pattern: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", pattern], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n").filter(Boolean)
  } catch { return [] }
}
const MANIFEST = process.env.XML_MANIFEST || "$HOME/fixtures/xml/repositories/MANIFEST.json"
const negativeControls = new Map<string, string>()
if (existsSync(MANIFEST)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
  for (const entry of manifest.corpora ?? []) {
    if (entry.path !== corpus) continue
    for (const fixture of entry.knownNegativeFixtures ?? []) {
      if (typeof fixture.verdict !== "string" || !fixture.verdict.trim()) {
        throw new Error(`manifest entry for ${fixture.path} has no verdict; a negative control must say why it is negative`)
      }
      for (const rel of listOfCorpusFiles(corpus, fixture.pathGlob ?? fixture.path)) negativeControls.set(rel, fixture.verdict)
    }
  }
}
const declaredNegatives: { file: string; errors: number; verdict: string }[] = []
const relative = execFileSync("git", ["-C", corpus, "ls-files", ...(process.env.XML_CORPUS_EXTS?.split(",") ?? ["*.xml", "*.xsd", "*.dtd", "*.xsl", "*.xslt", "*.svg", "*.rng"])], { encoding: "utf8" })
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
      if (fileErrors) {
        // A DECLARED negative control is measured and reported here, never
        // counted as a failure and never excluded by a glob: the two M12 xml
        // gates disagreed on the same corpus until both read the manifest.
        const control = negativeControls.get(relative[i])
        if (control) declaredNegatives.push({ file: relative[i], errors: fileErrors, verdict: control })
        else errorSamples.push({ file: relative[i], errors: fileErrors })
      }
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
measurement.declaredNegativeControls = declaredNegatives
measurement.manifest = MANIFEST
measurement.manifestPresent = existsSync(MANIFEST)
measurement.complexityPolicy = "single iterative AST traversal per file; attribute and relationship insertion are O(1) per emitted node, with a Set-based relationship dedupe"
writeFileSync("validation/m12/results/xml-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync("validation/m12/results/xml-corpus-shapes.json", JSON.stringify({ analyzer: "xml", perFile, errors: errorSamples, crashes }, null, 2) + "\n")
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
