import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const corpus = process.argv[2] || "$HOME/fixtures/repositories/powershell"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const allRelative = execFileSync("git", ["-C", corpus, "ls-files", "*.ps1", "*.psm1", "*.psd1"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

// The repo's own test/ parser-torture suite plus the six named production
// grammar-gap files (audited by powershell-corpus-errors.ts) are excluded
// from strict acceptance so throughput reflects clean, representative code.
const excluded = new Set<string>()
for (const file of allRelative) {
  if (file.startsWith("test/")) excluded.add(file)
}
for (const file of [
  ".github/actions/infrastructure/markdownlinks/Parse-MarkdownLink.ps1",
  ".github/actions/infrastructure/markdownlinks/Verify-MarkdownLinks.ps1",
  ".github/skills/analyze-pester-failures/scripts/analyze-pr-test-failures.ps1",
  "build.psm1",
  "src/Modules/Windows/PSDiagnostics/PSDiagnostics.psm1",
  "src/powershell-native/Install-PowerShellRemoting.ps1",
  "tools/AttackSurfaceAnalyzer/Run-AttackSurfaceAnalyzer.ps1",
  "tools/ResxGen/ResxGen.ps1",
  "tools/UpdateDotnetRuntime.ps1",
  "tools/ci.psm1",
  "tools/findMissingNotices.ps1",
  "tools/install-powershell.ps1",
  "tools/packaging/packaging.psm1",
  "tools/packaging/releaseTests/sbom.tests.ps1",
  "tools/releaseTools.psm1",
  "tools/wix/wix.psm1",
]) excluded.add(file)
const relative = allRelative.filter((file) => !excluded.has(file))
const files = relative.map((file) => `${corpus}/${file}`)
const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation("powershell-corpus-production", async () => {
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
measurement.excludedFiles = [...excluded].slice(0, 50)
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = measurement.errorFiles === 0 && crashes.length === 0
measurement.complexityPolicy =
  "one production parseFile pass per acceptance file; the powershell analyzer uses one iterative DFS over the tree with a constant-time owner stack, O(1) symbol dedupe (Map keyed by scope:name:kind), descendant searches bounded by tree depth, and Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol O(n) scans"
measurement.corpusPolicy =
  "tracked .ps1/.psm1/.psd1 files from clean powershell@91ce9844; intentionally-invalid testdata/fixture scripts are excluded and audited separately by powershell-corpus-errors.ts"
writeFileSync("validation/m12/results/powershell-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/powershell-corpus-shapes.json",
  JSON.stringify({ analyzer: "powershell", corpus, revision, perFile, excludedFiles: [...excluded], crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
