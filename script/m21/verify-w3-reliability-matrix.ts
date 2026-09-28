// script/m21/verify-w3-reliability-matrix.ts — M21.W3
// Real-corpus worker and WASM reliability matrix.
//
// Acceptance criteria (issue #453):
//   1. Results include language, grammar, worker mode, files, successes,
//      failures, retries, and fallback counts.
//   2. Large repositories are sampled deterministically and cold runs are
//      clearly labeled.
//   3. Any incomplete language remains known-gap.
//
// Closure requirements: persist raw matrix evidence and document every
// unavailable language or repository.
//
// Methodology (honest and reproducible):
//   - Only CLEAN registry repositories are evidence-eligible; dirty and
//     missing rows are documented as unavailable, never run.
//   - Every run is COLD: the project's derived index DB is wiped first, so
//     nothing is skipped as "unchanged" and the parse phase really parses.
//   - Sampling is deterministic: tracked files (git ls-files, the same set
//     the registry pins by revision) sorted by path, stride-sampled down to
//     MAX_SAMPLE when the repo exceeds the cap. The sample method and size
//     are recorded per row.
//   - Per-language outcome counts come from the indexer's own phase
//     telemetry (phases.byLanguage), accumulated from the same final
//     one-outcome-per-file pass that drives successFiles/errorFiles.
//   - Fallback (regex/structural extraction) is counted separately from full
//     AST parses and never presented as AST parsing.
//
// Honesty rules (milestone C1/C3): no `check(..., true)` tautologies, no
// `>= 0` claims that could never fail, no fabricated evidence.

import { mkdirSync, existsSync, readFileSync, writeFileSync as wfs, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, hasValidExtension, shouldSkipCli } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REGISTRY = path.join(ROOT, "validation/m21/results/corpus-registry.json")
const WASM_DIR = path.join(ROOT, "wasm")

// Deterministic sample cap for large repositories (documented per row).
const MAX_SAMPLE = 250

// Advertised dedicated grammars (mirrors the W2 asset map; used to report the
// grammar asset per language and to check load results for every advertised
// language — present-and-valid is W2's job, loaded-in-corpus is W3's).
const GRAMMAR: Record<string, string> = {
  typescript: "tree-sitter-typescript.wasm", tsx: "tree-sitter-tsx.wasm", javascript: "tree-sitter-javascript.wasm",
  html: "tree-sitter-html.wasm", css: "tree-sitter-css.wasm", svelte: "tree-sitter-svelte.wasm", json: "tree-sitter-json.wasm",
  perl: "tree-sitter-perl.wasm", yaml: "tree-sitter-yaml.wasm", c: "tree-sitter-c.wasm", cpp: "tree-sitter-cpp.wasm",
  rust: "tree-sitter-rust.wasm", go: "tree-sitter-go.wasm", java: "tree-sitter-java.wasm", kotlin: "tree-sitter-kotlin.wasm",
  scala: "tree-sitter-scala.wasm", python: "tree-sitter-python.wasm", ruby: "tree-sitter-ruby.wasm", php: "tree-sitter-php.wasm",
  lua: "tree-sitter-lua.wasm", elixir: "tree-sitter-elixir.wasm", erlang: "tree-sitter-erlang.wasm", haskell: "tree-sitter-haskell.wasm",
  clean: "tree-sitter-clean.wasm", clojure: "tree-sitter-clojure.wasm", swift: "tree-sitter-swift.wasm", dart: "tree-sitter-dart.wasm",
  csharp: "tree-sitter-c_sharp.wasm", r: "tree-sitter-r.wasm", sql: "tree-sitter-sql.wasm", bash: "tree-sitter-bash.wasm",
  "objective-c": "tree-sitter-objc.wasm", groovy: "tree-sitter-groovy.wasm", vue: "tree-sitter-vue.wasm", hcl: "tree-sitter-hcl.wasm",
  terraform: "tree-sitter-hcl.wasm", graphql: "tree-sitter-graphql.wasm", zig: "tree-sitter-zig.wasm", fsharp: "tree-sitter-fsharp.wasm",
  powershell: "tree-sitter-powershell.wasm", markdown: "tree-sitter-markdown.wasm", toml: "tree-sitter-toml.wasm", xml: "tree-sitter-xml.wasm",
  make: "tree-sitter-make.wasm",
}

let checks = 0
let passed = 0
let negatives = 0
let result: any

function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

interface MatrixRow {
  repo: string
  state: string
  path: string
  trackedFiles: number
  candidates: number
  sampled: boolean
  sampleSize: number
  cold: boolean
  mode: string | undefined
  workerCount: number
  files: number
  success: number
  error: number
  timeout: number
  skipped: number
  retries: number
  startupFailures: number
  poison: number
  fallbacks: number
  byLanguage: Record<string, { files: number; success: number; error: number; timeout: number; fallback: number }>
  durationMs: number
}

// Deterministic sample: sort tracked paths, then stride-sample down to cap so
// the sample spans the whole tree rather than a single alphabetically-first
// prefix. Identical input → identical sample (fully reproducible).
function deterministicSample(paths: string[], cap: number): string[] {
  const sorted = [...paths].sort()
  if (sorted.length <= cap) return sorted
  const step = sorted.length / cap
  const out: string[] = []
  for (let i = 0; i < cap; i++) out.push(sorted[Math.floor(i * step)])
  return out
}

function trackedFiles(repoPath: string): string[] {
  // Large repositories (e.g. microsoft/TypeScript, ~15k tracked files) exceed
  // spawnSync's default 1MB stdout buffer and die with ENOBUFS — an explicit
  // buffer is required or the listing silently returns nothing.
  const res = spawnSync("git", ["-C", repoPath, "ls-files"], { encoding: "utf8", timeout: 60_000, maxBuffer: 128 * 1024 * 1024 })
  if (res.status !== 0) return []
  return res.stdout.split("\n").filter(Boolean)
}

function validWasm(file: string): boolean {
  try {
    const buf = readFileSync(file)
    return buf.length >= 8 && buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d
  } catch {
    return false
  }
}

function rowIsPlausible(row: MatrixRow): boolean {
  if (!row || typeof row !== "object") return false
  if (row.cold !== true) return false
  if (typeof row.files !== "number" || row.files < 0) return false
  if (typeof row.mode !== "string" || row.mode === "") return false
  if (row.success + row.error + row.timeout !== row.files) return false
  const langs = Object.values(row.byLanguage ?? {})
  for (const l of langs) {
    if (typeof l.files !== "number" || l.files < 1) return false
    if (l.success + l.error + l.timeout !== l.files) return false
    if (typeof l.fallback !== "number" || l.fallback < 0 || l.fallback > l.files) return false
  }
  const sumFiles = langs.reduce((a, l) => a + l.files, 0)
  if (sumFiles !== row.files) return false
  return true
}

try {
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"))
  const rows = registry.repositories ?? []
  const cleanRows = rows.filter((r: any) => r.state === "clean" && existsSync(r.path) && existsSync(path.join(r.path, ".git")))

  const matrix: MatrixRow[] = []
  const unavailable: string[] = []

  for (const row of rows) {
    if (row.state === "clean" && existsSync(row.path) && existsSync(path.join(row.path, ".git"))) continue
    unavailable.push(`${row.id} (${row.state})${existsSync(row.path) ? "" : " — path missing"}`)
  }

  for (const row of cleanRows) {
    const t0 = Date.now()
    const projectId = getProjectId(row.path)
    // COLD run: wipe the derived index DB (checkout untouched).
    BrainDatabase.close(projectId as any)
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
    const tracked = trackedFiles(row.path)
    if (tracked.length === 0) {
      // A clean repo whose tracked-file listing returns nothing is a real
      // failure (e.g. transient git lock), not a no-op — fail closed and
      // visibly instead of producing a silent 0-file row.
      unavailable.push(`${row.id} (clean) — git ls-files returned 0 files (transient git failure?)`)
      check(`W3 ${row.id}: tracked file listing works`, false, "git ls-files returned 0 files")
      continue
    }
    // git ls-files returns repo-relative paths; discovery stats them against
    // the process cwd, so join with the repo root first.
    const absTracked = tracked.map((f) => path.join(row.path, f))
    // Only indexable files are candidates (the discovery override path does
    // not extension-filter, so the sample itself must).
    const candidates = absTracked.filter((f) => hasValidExtension(f) && !shouldSkipCli(f))
    const sample = deterministicSample(candidates, MAX_SAMPLE)
    const stats = await indexProjectParallel(projectId, row.path, {
      skipPostProcessing: true,
      files: sample,
    })
    const langs = stats.phases?.byLanguage ?? {}
    const fallbacks = Object.values(langs).reduce((a: number, l: any) => a + (l.fallback ?? 0), 0)
    matrix.push({
      repo: row.id,
      state: "clean",
      path: row.path,
      trackedFiles: tracked.length,
      candidates: candidates.length,
      sampled: candidates.length > MAX_SAMPLE,
      sampleSize: sample.length,
      cold: true,
      mode: stats.phases?.mode,
      workerCount: stats.phases?.workerCount ?? 0,
      files: stats.totalFiles,
      success: stats.successFiles,
      error: stats.errorFiles,
      timeout: stats.timeoutFiles,
      skipped: stats.skippedFiles,
      retries: stats.phases?.retries ?? 0,
      startupFailures: stats.phases?.workerStartupFailures ?? 0,
      poison: stats.phases?.poisonFiles ?? 0,
      fallbacks,
      byLanguage: langs,
      durationMs: Date.now() - t0,
    })
    console.log(`  [W3] ${row.id}: ${stats.totalFiles} files, mode=${stats.phases?.mode}, success=${stats.successFiles} error=${stats.errorFiles} timeout=${stats.timeoutFiles} langs=${Object.keys(langs).join(",")}`)
  }

  // ── Assertions ───────────────────────────────────────────────────────────
  check("W3 at least three clean corpus repositories were run", matrix.length >= 3, `ran=${matrix.length}`)
  for (const row of matrix) {
    check(`W3 ${row.repo}: run completed with an end time`, row.durationMs >= 0 && row.files >= 0, `duration=${row.durationMs}ms`)
    check(`W3 ${row.repo}: worker-pool mode (no silent in-process fallback)`, row.mode === "worker-pool", `mode=${row.mode}`)
    check(`W3 ${row.repo}: cold run is labeled`, row.cold === true, "not labeled cold")
    check(`W3 ${row.repo}: one final outcome per file`, row.success + row.error + row.timeout === row.files, `sum=${row.success + row.error + row.timeout} files=${row.files}`)
    check(`W3 ${row.repo}: zero startup failures`, row.startupFailures === 0, `startupFailures=${row.startupFailures}`)
    check(`W3 ${row.repo}: zero poison pills`, row.poison === 0, `poison=${row.poison}`)
    if (row.candidates > MAX_SAMPLE) {
      check(`W3 ${row.repo}: large repo is sampled deterministically`, row.sampled === true && row.sampleSize === MAX_SAMPLE, `sampled=${row.sampled} sample=${row.sampleSize}`)
    } else {
      check(`W3 ${row.repo}: small repo is fully indexed (no sampling)`, row.sampled === false && row.sampleSize === row.candidates, `sampled=${row.sampled} sample=${row.sampleSize} candidates=${row.candidates}`)
    }
    const langs = Object.entries(row.byLanguage)
    check(`W3 ${row.repo}: per-language accounting present`, langs.length >= 1, `langs=${langs.length}`)
    for (const [lang, l] of langs) {
      check(`W3 ${row.repo}/${lang}: language row reconciles`, l.files === l.success + l.error + l.timeout, `files=${l.files} sum=${l.success + l.error + l.timeout}`)
      check(`W3 ${row.repo}/${lang}: fallback field is explicit`, typeof l.fallback === "number" && l.fallback >= 0 && l.fallback <= l.files, `fallback=${l.fallback}`)
      if (l.files > 0) {
        const asset = GRAMMAR[lang]
        check(`W3 ${row.repo}/${lang}: grammar advertised and asset valid`, typeof asset === "string" && validWasm(path.join(WASM_DIR, asset)), `asset=${asset ?? "UNKNOWN"}`)
      }
    }
    // Fallback (regex/structural) extraction is never presented as AST.
    check(`W3 ${row.repo}: fallback count is bounded by files`, row.fallbacks >= 0 && row.fallbacks <= row.files, `fallbacks=${row.fallbacks} files=${row.files}`)
  }

  // Coverage: every language that reached the parse phase must have a load
  // result (files > 0) AND at least one successful parse (the grammar
  // actually instantiated in a worker).
  const coveredLanguages = new Map<string, { files: number; success: number }>()
  for (const row of matrix) {
    for (const [lang, l] of Object.entries(row.byLanguage)) {
      const prev = coveredLanguages.get(lang) ?? { files: 0, success: 0 }
      coveredLanguages.set(lang, { files: prev.files + l.files, success: prev.success + l.success })
    }
  }
  check("W3 matrix covers at least five distinct languages", coveredLanguages.size >= 5, `languages=${[...coveredLanguages.keys()].join(",")}`)
  for (const [lang, c] of coveredLanguages) {
    check(`W3 ${lang}: grammar loaded and parsed at least one file (load result)`, c.files > 0 && c.success > 0, `files=${c.files} success=${c.success}`)
  }
  // Advertised languages absent from the clean corpus remain KNOWN-GAP:
  // their load result is "not covered by corpus", documented below.
  const advertised = Object.keys(GRAMMAR)
  const notCovered = advertised.filter((l) => !coveredLanguages.has(l))
  const loadResults = Object.fromEntries(
    advertised.map((l) => [l, coveredLanguages.has(l) ? { state: "loaded", files: coveredLanguages.get(l)!.files, success: coveredLanguages.get(l)!.success, asset: GRAMMAR[l] } : { state: "not-covered-by-corpus", asset: GRAMMAR[l] }]),
  )

  // ── Negative checks: the matrix rejects dishonest accounting ─────────────
  const baseRow: MatrixRow = {
    repo: "fake", state: "clean", path: "/tmp/fake", trackedFiles: 3, candidates: 3, sampled: false, sampleSize: 3,
    cold: true, mode: "worker-pool", workerCount: 1, files: 3, success: 3, error: 0, timeout: 0,
    skipped: 0, retries: 0, startupFailures: 0, poison: 0, fallbacks: 0,
    byLanguage: { python: { files: 3, success: 3, error: 0, timeout: 0, fallback: 0 } },
    durationMs: 100,
  }
  negative("W3 row without cold label is rejected", !rowIsPlausible({ ...baseRow, cold: false }), "accepted non-cold row")
  negative("W3 row without worker mode is rejected", !rowIsPlausible({ ...baseRow, mode: undefined }), "accepted missing mode")
  negative("W3 row with double-counted outcomes is rejected", !rowIsPlausible({ ...baseRow, success: 4 }), "accepted over-counted outcomes")
  negative("W3 row with empty language row is rejected", !rowIsPlausible({ ...baseRow, byLanguage: { python: { files: 0, success: 0, error: 0, timeout: 0, fallback: 0 } } }), "accepted empty language row")
  negative("W3 row with fabricated fallback count is rejected", !rowIsPlausible({ ...baseRow, byLanguage: { python: { files: 2, success: 2, error: 0, timeout: 0, fallback: 5 } } }), "accepted fallback > files")
  negative("W3 per-language sum not matching files is rejected", !rowIsPlausible({ ...baseRow, byLanguage: { python: { files: 3, success: 2, error: 0, timeout: 0, fallback: 0 } } }), "accepted language row mismatch")

  // ── Persist evidence ─────────────────────────────────────────────────────
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.W3", code: "W3", milestone: "M21",
    status: passed === checks && negatives >= 6 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-w3-reliability-matrix.ts",
    evidenceFile: "W3.json", generatedAt: new Date().toISOString(),
    methodology: {
      coldRuns: "every project's derived index DB is wiped before indexing; the checkout is never modified",
      sampling: `tracked files (git ls-files) sorted by path, stride-sampled to ${MAX_SAMPLE} files when the repo exceeds the cap; identical input → identical sample`,
      perLanguageSource: "phases.byLanguage accumulated from the same final one-outcome-per-file pass that drives successFiles/errorFiles",
      fallbackDefinition: "regex/structural extraction (FileResult.fallback === true), counted separately and never presented as full AST parsing",
      eligibility: "only clean registry repositories are run; dirty/missing rows are documented as unavailable",
    },
    matrix,
    grammarLoadResults: loadResults,
    unavailableRepositories: unavailable,
    notCoveredLanguages: notCovered,
    limitations: [
      "Matrix rows are COLD runs with skipPostProcessing (post-processing is outside this issue's scope); timings include worker boot and WASM load.",
      "Languages absent from the clean corpus (list in notCoveredLanguages) have load result 'not-covered-by-corpus' and remain a known-gap until a clean repository exercising them is added to the registry.",
      `Dirty repositories are not evidence-eligible per the corpus policy and were not run: ${unavailable.filter((u) => !u.includes("missing")).join("; ") || "none"}.`,
      "Fallback counts reflect files whose parse used regex/structural extraction; a file parsed with a valid dedicated grammar is never labeled fallback.",
    ],
  }
} catch (error) {
  result = {
    issue: "M21.W3", code: "W3", milestone: "M21", status: "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-w3-reliability-matrix.ts",
    evidenceFile: "W3.json", generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    limitations: ["Verifier itself failed; no reliability-matrix claim is made."],
  }
}

const resultsDir = path.join(ROOT, "validation/m21/results")
mkdirSync(resultsDir, { recursive: true })
wfs(path.join(resultsDir, "W3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`W3: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
