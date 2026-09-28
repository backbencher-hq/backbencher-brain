import { execFileSync } from "node:child_process"
import { makeCorpus, REPOS_ROOT } from "./make-corpus"
import { writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { measureOperation } from "../m11/differential-harness"

const ROOT = process.cwd()
  // Same defect as make-corpus-errors.ts: a hardcoded six-repository list, three
  // of which are not on this machine, so this gate died on `fatal: cannot change
  // to ...` before timing a single file. The corpus now comes from
  // make-corpus.ts, a missing checkout is skipped and RECORDED, and the
  // repositories actually used are written into the artifact.
  const corpus = makeCorpus()
  const revisions: Record<string, string> = {}
  for (const repo of corpus.repos) {
    try {
      revisions[repo] = execFileSync("git", ["-C", `${REPOS_ROOT}/${repo}`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    } catch { revisions[repo] = "not-a-git-checkout" }
  }
  const files = corpus.files.map((f) => ({ repo: f.repo, file: f.abs.slice(`${REPOS_ROOT}/${f.repo}/`.length), abs: f.abs }))

const perFile: Record<string, { symbols: number; relationships: number; errors: number }> = {}
const crashes: { file: string; error: string }[] = []
const hasErrorNoNode: string[] = []

const { value, measurement } = await measureOperation("make-corpus-production", async () => {
  let symbols = 0
  let relationships = 0
  let errors = 0
  for (const f of files) {
    try {
      const parsed = await parseFile(f.abs, ROOT)
      const fileSymbols = parsed.symbols?.length ?? 0
      const fileRelationships = parsed.relationships?.length ?? 0
      // Two error CLASSES, exactly as make-corpus-errors.ts now separates them.
      // The engine emits ONE GENERIC warning when `rootNode.hasError` is set but
      // no ERROR/MISSING node is traversable (engine.ts:1264). That is not a
      // defect in the FILE — torrentinim/Makefile has hasError=true with ZERO
      // ERROR and ZERO MISSING nodes, parses into the correct tree, and the
      // analyzer's output for it is right. Counting it as an error file made the
      // residual unpinnable and would have hidden the two real grammar gaps
      // behind a third phantom.
      const all = parsed.errors ?? []
      const real = all.filter((e: any) => !String(e.message ?? "").includes("hidden MISSING node"))
      const generic = all.length - real.length
      if (generic > 0) hasErrorNoNode.push(`${f.repo}/${f.file}`)
      const fileErrors = real.length
      symbols += fileSymbols
      relationships += fileRelationships
      errors += fileErrors
      perFile[`${f.repo}/${f.file}`] = { symbols: fileSymbols, relationships: fileRelationships, errors: fileErrors }
    } catch (error: any) {
      crashes.push({ file: f.file, error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  return { symbols, relationships, errors }
}, { files: files.length, corpus: "make-union", revisions, corpusRepositories: corpus.repos, corpusRepositoriesAbsent: corpus.missing, corpusFileCap: corpus.cap })

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
  // A PINNED residual, not a demand for zero, and the same reasoning as
  // make-corpus-errors.ts: the gate's policy asks for "zero ERROR/MISSING nodes" and
  // the honest answer on this corpus was 2 of 14 files with REAL grammar errors, both
  // documented in script/m14/spec/make-completeness.json (MAKE-G3, and the vault
  // `$$($(GO_CMD) …)` construct). Pinning the exact set means the gate is GREEN
  // while the residual matches the ruling and goes RED the moment it grows — which is
  // strictly stronger than staying red forever, because a permanently red gate is a
  // gate nobody reads. Both of those files are now clean, so the pin is empty;
  // the comment below records what it used to hold, because a pin that cannot be
  // seen to have changed is a pin nobody trusts.
// The grammar residual is now EMPTY, and it is the pin that says so rather than the
// constant having been quietly edited: this expectation previously read 2 files /
// 9 nodes, and the patched grammar took it to 0 — at which point this gate went
// RED, because the recorded residual no longer matched the measurement. A pin that
// can only report "no worse" is not a pin. This one failed on an improvement.
//
// Pre-patch, for the record (fixtures/make/out/grammar-ab.json):
//   boundary/Makefile  8 ERROR nodes  target-scoped `target: export VAR = value`  (was spec gap MAKE-G3)
//   vault/Makefile     1 ERROR node   `$$($(GO_CMD) list … | grep -v vendor/)`      (was spec gap MAKE-G4)
// Both are FIXED by the two grammar patches in grammars/tree-sitter-make, which
// add no node type and no field, so the source<->wasm proof is unaffected.
const RESIDUAL_EXPECTED: { file: string; errorNodes: number; cause?: string }[] = []
const erroredFiles = Object.entries(perFile).filter(([, v]) => v.errors > 0).map(([k]) => k).sort()
const residualMatches = erroredFiles.length === RESIDUAL_EXPECTED.length
  && erroredFiles.every((f, i) => f === RESIDUAL_EXPECTED[i].file)
  && RESIDUAL_EXPECTED.every((r) => perFile[r.file]?.errors === r.errorNodes)
measurement.residual = {
  policy: "real ERROR/MISSING nodes only; the engine's generic hasError-without-a-node warning is excluded and reported separately",
  expected: RESIDUAL_EXPECTED,
  erroredFiles,
  hasErrorNoNodeFiles: hasErrorNoNode,
  matches: residualMatches,
}
measurement.passed = crashes.length === 0 && residualMatches
measurement.complexityPolicy =
  "one production parseFile pass per acceptance file; the make analyzer uses one iterative DFS over the tree with O(1) Map-backed symbol dedupe (name:kind) and Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol O(n) scans"
measurement.corpusPolicy =
  `union of ${corpus.repos.length} repositories, ${corpus.via}`
writeFileSync("validation/m12/results/make-corpus-complexity.json", JSON.stringify(measurement, null, 2) + "\n")
writeFileSync(
  "validation/m12/results/make-corpus-shapes.json",
  JSON.stringify({ analyzer: "make", revisions, perFile, crashes }, null, 2) + "\n",
)
console.log(JSON.stringify(measurement, null, 2))
if (!measurement.passed) process.exitCode = 1
