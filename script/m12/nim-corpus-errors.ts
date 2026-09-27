// M12 (nim wave, 2026-09-27): scan the PINNED Nim corpora for grammar errors
// and parser crashes, through the production pool-worker parseFile path — the
// same route the indexer takes, so this measures the shipped pipeline and not a
// tree-walk-only approximation.
//
// Three numbers, kept separate because they mean different things:
//   errorFiles  — files whose parse tree carries at least one ERROR or MISSING
//                 node. This is the GRAMMAR's rate, and the only number a reader
//                 should compare against another grammar.
//   errorNodes  — the ERROR/MISSING node count, which is a grammar-detail
//                 measure and grows with file length; it is NOT a defect rate.
//   crashFiles  — parseFile threw. Always a product defect, never a grammar one.
//
// Exit code is deliberately NOT set from errorFiles: a corpus is allowed to
// contain files the grammar cannot represent, and the M12 evidence rules
// require those to be RECORDED as measured negatives, not to make the gate
// lie. The gate that cares is `nim-corpus-errors.json`'s own consumer.
import { parseFile } from "../../src/ast/pool-worker"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m12/results/nim-corpus-errors.json")

/** The pinned corpora, in the order they are reported. `primary` is the one the
 *  analyzer's own claims are stated against. */
const CORPORA: { name: string; primary?: boolean; why: string }[] = [
  {
    name: "nim",
    primary: true,
    why: "the Nim compiler and the whole standard library: every construct the analyzer must know appears under compiler/ or lib/, and it is the language's own reference implementation rather than a user of it",
  },
  {
    name: "nimble",
    why: "the package manager: a real application of Nim, heavy on import statements, nimble task definitions and shell-out statements",
  },
  {
    name: "arraymancer",
    why: "the most GENERIC-heavy real codebase reachable — multi-parameter type classes, concept dispatch, and a `when` per element type",
  },
  { name: "prologue", why: "a web framework: import/re-export discipline, templates, async procs" },
  { name: "pixie", why: "a 2D graphics library: operator overloads, value objects, variant objects, generic containers" },
  { name: "nitter", why: "the largest real-world Nim application by stars; async, template-heavy, an actual service" },
  { name: "nimterop", why: "C++ interop: the most pragma- and emit-heavy real codebase in the ecosystem" },
  { name: "nigui", why: "a cross-platform desktop GUI toolkit: JS-backend emit, FFI pragmas, destructors" },
  { name: "jester", why: "a sinatra-like web framework: async procs, template DSL, JS backend" },
  { name: "nimtest", why: "a test framework: templates, macros, a unittest DSL, the {.raises.} pragma" },
  { name: "torrentinim", why: "a real self-hosted service (jester + jesterpkg + SQL-ish state)" },
  { name: "mosdepth", why: "a real bioinformatics CLI: a let/var-heavy application with a JS-target conditional tree" },
]

const argRepos = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const chosen = argRepos.length > 0 ? CORPORA.filter((c) => argRepos.includes(c.name)) : CORPORA

interface RepoResult {
  corpus: string
  primary: boolean
  why: string
  revision: string
  files: number
  errorFiles: number
  errorNodes: number
  crashFiles: number
  symbols: number
  relationships: number
  errorRate: number
  damaged: { file: string; errors: number }[]
}

const results: RepoResult[] = []
let totalFiles = 0
let totalErrorFiles = 0
let totalErrorNodes = 0
let totalCrashFiles = 0

for (const c of chosen) {
  const dir = path.join(CORPUS_ROOT, c.name)
  let revision = ""
  let rel: string[] = []
  try {
    revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    // `-z` (NUL-separated) is REQUIRED, not a nicety: with the default
    // core.quotePath, `git ls-files` returns a path containing non-ASCII bytes
    // in git's C-quoted form ("tests/misc/\303\245\303\244\303\266.nim"), and
    // passing that string to parseFile is a path that does not exist. The Nim
    // corpus contains exactly such a file, and the first run of this script
    // reported it as a CRASH — a defect in the harness, not in the product.
    // 20+ other corpus scripts in script/m12 still call ls-files without -z;
    // see the review note, which records the class rather than one instance.
    rel = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.nim", "*.nims", "*.nimble"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  } catch {
    console.log(`${c.name}: NOT PRESENT at ${dir} — skipped, and recorded as absent rather than as zero files`)
    results.push({
      corpus: c.name,
      primary: !!c.primary,
      why: c.why,
      revision: "ABSENT",
      files: 0,
      errorFiles: 0,
      errorNodes: 0,
      crashFiles: 0,
      symbols: 0,
      relationships: 0,
      errorRate: 0,
      damaged: [],
    })
    continue
  }

  let errorFiles = 0
  let errorNodes = 0
  let crashFiles = 0
  let symbols = 0
  let relationships = 0
  const damaged: { file: string; errors: number }[] = []
  for (const r of rel) {
    const file = path.join(dir, r)
    try {
      const parsed = await parseFile(file, ROOT)
      const errs = parsed.errors?.length ?? 0
      symbols += parsed.symbols?.length ?? 0
      relationships += parsed.relationships?.length ?? 0
      if (errs > 0) {
        errorFiles++
        errorNodes += errs
        if (damaged.length < 400) damaged.push({ file: r, errors: errs })
      }
    } catch (e: any) {
      crashFiles++
      if (damaged.length < 400) damaged.push({ file: r, errors: -1, } as any)
    }
  }
  const pct = rel.length > 0 ? (errorFiles / rel.length) * 100 : 0
  results.push({
    corpus: c.name,
    primary: !!c.primary,
    why: c.why,
    revision,
    files: rel.length,
    errorFiles,
    errorNodes,
    crashFiles,
    symbols,
    relationships,
    errorRate: Number(pct.toFixed(3)),
    damaged,
  })
  totalFiles += rel.length
  totalErrorFiles += errorFiles
  totalErrorNodes += errorNodes
  totalCrashFiles += crashFiles
  console.log(
    `${c.name.padEnd(12)} rev=${revision.slice(0, 10)} files=${String(rel.length).padStart(5)} errorFiles=${String(errorFiles).padStart(4)} (${pct.toFixed(2)}%) errorNodes=${String(errorNodes).padStart(6)} crashes=${crashFiles} symbols=${symbols} relationships=${relationships}`,
  )
}

const document = {
  schemaVersion: 1,
  kind: "nim_corpus_parse_errors",
  analyzer: "src/ast/real-nim-analyzer.ts",
  grammar: {
    file: "wasm/tree-sitter-nim.wasm",
    sha256: "421369fe6a8814dd28d0548f56dbab8877576da877b0b98ca1b905c024b5d1ad",
    upstream: "alaviss/tree-sitter-nim 0.6.2 @ ac72ba30d16edf0be021588a9301ede4accd6cf4",
    note: "the pin, its provenance and the rejected alternatives are recorded in grammars/tree-sitter-nim/PIN.md and validation/m14/grammar-pins.json",
  },
  method:
    "production pool-worker parseFile per tracked file (the indexer's own route), ERROR and MISSING nodes counted as parse errors",
  totals: {
    corpora: results.length,
    files: totalFiles,
    errorFiles: totalErrorFiles,
    errorNodes: totalErrorNodes,
    crashFiles: totalCrashFiles,
    errorRatePct: totalFiles > 0 ? Number(((totalErrorFiles / totalFiles) * 100).toFixed(3)) : 0,
  },
  corpora: results,
}
writeFileSync(OUT, JSON.stringify(document, null, 2) + "\n")
console.log(
  `\nTOTAL corpora=${results.length} files=${totalFiles} errorFiles=${totalErrorFiles} errorNodes=${totalErrorNodes} crashes=${totalCrashFiles} errorRate=${document.totals.errorRatePct}%`,
)
console.log(`wrote ${path.relative(ROOT, OUT)}`)
if (totalCrashFiles > 0) process.exitCode = 1
