import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
const CORPUS: { name: string; dir: string }[] = [
  { name: "elixir", dir: "$HOME/fixtures/repositories/elixir" },
  { name: "cabal", dir: "$HOME/fixtures/repositories/cabal" },
  { name: "luarocks", dir: "$HOME/fixtures/repositories/luarocks" },
  { name: "terraform", dir: "$HOME/fixtures/repositories/terraform" },
  { name: "cython", dir: "$HOME/fixtures/repositories/cython" },
  { name: "tree-sitter-clean", dir: "$HOME/fixtures/repositories/tree-sitter-clean" },
]
const revisions: Record<string, string> = {}
const files: { repo: string; file: string; abs: string }[] = []
for (const repo of CORPUS) {
  revisions[repo.name] = execFileSync("git", ["-C", repo.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const rels = execFileSync("git", ["-C", repo.dir, "ls-files", "*.mk", "Makefile", "GNUmakefile", "makefile"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort()
  for (const rel of rels) files.push({ repo: repo.name, file: rel, abs: `${repo.dir}/${rel}` })
}

const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const crashes: { file: string; error: string }[] = []

const { value, measurement } = await measureOperation("make-corpus-production", async () => {
  let symbols = 0
  let relationships = 0
  let errors = 0
  for (const f of files) {
    try {
      const parsed = await parseFile(f.abs, ROOT)
      const fileSymbols = parsed.symbols?.length ?? 0
      const fileRelationships = parsed.relationships?.length ?? 0
      const fileErrors = parsed.errors?.length ?? 0
      symbols += fileSymbols
      relationships += fileRelationships
      errors += fileErrors
      perFile[`${f.repo}/${f.file}`] = { symbols: fileSymbols, relationships: fileRelationships, errors: fileErrors }
    } catch (error: any) {
      crashes.push({ file: f.file, error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  return { symbols, relationships, errors }
}, { files: files.length, corpus: "make-union", revisions })

measurement.trackedFiles = files.length
measurement.files = files.length
measurement.symbols = value.symbols
measurement.relationships = value.relationships
measurement.errors = value.errors
measurement.errorFiles = Object.values(perFile).filter((entry) => entry.errors > 0).length
measurement.crashFiles = crashes.length
measurement.crashSamples = crashes
measurement.acceptanceFiles = files.length - measurement.errorFiles - crashes.length
measurement.filesPerSecond = measurement.wallTimeMs ? files.length / (measurement.wallTimeMs / 1000) : null
measurement.symbolsPerSecond = measurement.wallTimeMs ? value.symbols / (measurement.wallTimeMs / 1000) : null
measurement.relationshipsPerSecond = measurement.wallTimeMs ? value.relationships / (measurement.wallTimeMs / 1000) : null
measurement.passed = measurement.errorFiles === 0 && crashes.length === 0
measurement.complexityPolicy =
  "one production parseFile pass per acceptance file; the make analyzer uses one iterative DFS over the tree with O(1) Map-backed symbol dedupe (name:kind) and Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol O(n) scans"
measurement.corpusPolicy =
  "union of all tracked Makefiles across the six pinned clean repos (elixir, cabal, luarocks, terraform, cython, tree-sitter-clean) — the make ecosystem has no single representative repository"
writeFileSync("validation/m12/results/make-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/make-corpus-shapes.json",
  JSON.stringify({ analyzer: "make", revisions, perFile, crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
