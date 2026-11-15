/**
 * THE TOP-LEVEL-ARRAY POPULATION, selected deterministically.
 *
 * `top-level-array-name-probe.ts` measures a defect that can only occur in a document whose
 * TOP LEVEL is an array, because only there does a qualified path hang off the module by an
 * INDEX rather than under a KEY. That population is a subset of the admitted corpus, so it
 * has to be selected the same way `incoming-selection.ts` selects the admitted corpus —
 * otherwise the two numbers in the lane's doc are measured over different universes and the
 * ratio between them means nothing.
 *
 * The previous run of the probe selected these files by hand and printed the count, so the
 * measurement was real but NOT REPRODUCIBLE: there was no file in the repository that named
 * the 514 paths. This file is that name, and it is committed for the same reason
 * `incoming-selection.ts` is.
 *
 * Method, stated so a reader can falsify it. Steps 1-5 are `incoming-selection.ts` verbatim,
 * so the admitted population here IS the admitted population there:
 *
 *   1. list the immediate children of CORPUS_ROOT (one entry per repository);
 *   2. within each repository, walk for `*.json` / `*.jsonc` / `*.json5`, skipping build and
 *      VCS directories by SEGMENT (never by substring);
 *   3. drop anything over 5MB — the indexer's own cut, so the sample stays inside the
 *      admitted population the census counted;
 *   4. drop any path containing a space (the documented invocation passes paths through
 *      `xargs -d '\n'`, and a space is what that flag exists to survive — but the probe is
 *      also run by hand, and the dropped count is printed so it stays a number);
 *   5. keep a file if its first non-whitespace byte is `[`.
 *
 * Then STRIDE: take every STRIDE-th file of the population in sorted order, so the sample
 * spreads across the whole population instead of clustering in one repository's alphabetically
 * first directory. The default stride reproduces the 514-file sample the defect was measured
 * on; pass a smaller stride for a larger one.
 *
 * Step 5 is a byte comparison, not a parse. It is deliberately NOT a parse: the point is to
 * select on the SHAPE of the document as the analyzer's frame builder sees it, and reading
 * the first non-whitespace byte is the cheapest test that cannot disagree with the grammar
 * about where the top level starts. It admits one thing a parse would not — a file that
 * begins with `[` and then fails to parse — and the probe counts those separately
 * (`parse failures` below), because a file that contributes no symbols must not be silently
 * counted as a file that contributed none of the defect.
 *
 * Regex-free, per the lane's no-regex rule: every predicate below is a string comparison, a
 * character-code test, or a path-segment test.
 *
 *   npx tsx validation/m14/fixtures/json/top-level-array-selection.ts /tmp/json-tla-files.txt
 *   xargs -a /tmp/json-tla-files.txt -d '\n' \
 *     npx tsx validation/m14/fixtures/json/top-level-array-name-probe.ts
 */

import fs from "node:fs"
import path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const STRIDE = Number(process.env.BB_TLA_STRIDE ?? "5")

const SKIP_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
])

const EXTENSIONS = [".json", ".jsonc", ".json5"]

function hasJsonExtension(p: string): boolean {
  for (const ext of EXTENSIONS) if (p.endsWith(ext)) return true
  return false
}

function isSkipped(relPath: string): boolean {
  const parts = relPath.split(path.sep)
  for (const part of parts) if (SKIP_SEGMENTS.has(part)) return true
  return false
}

/** True when the document's first non-whitespace byte opens a top-level array. */
function startsWithTopLevelArray(abs: string): boolean {
  let handle: number | undefined
  try {
    handle = fs.openSync(abs, "r")
    const buf = Buffer.alloc(4096)
    const read = fs.readSync(handle, buf, 0, buf.length, 0)
    for (let i = 0; i < read; i++) {
      const c = buf[i]
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c) continue
      return c === 0x5b // '['
    }
    return false
  } catch {
    return false
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle) } catch { /* already gone */ }
  }
}

function walkJsonFiles(absDir: string, rel: string, out: string[], depth: number): void {
  if (depth > 12) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_SEGMENTS.has(entry.name)) continue
    const childRel = rel === "" ? entry.name : `${rel}${path.sep}${entry.name}`
    const childAbs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      walkJsonFiles(childAbs, childRel, out, depth + 1)
    } else if (entry.isFile()) {
      if (!hasJsonExtension(entry.name)) continue
      if (isSkipped(childRel)) continue
      try {
        if (fs.statSync(childAbs).size > 5 * 1024 * 1024) continue
      } catch {
        continue
      }
      out.push(childAbs)
    }
  }
}

const outFile = process.argv[2] ?? "/tmp/json-tla-files.txt"

let repos: fs.Dirent[]
try {
  repos = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true })
} catch {
  console.error(`corpus root not readable: ${CORPUS_ROOT}`)
  process.exit(1)
}

const repoDirs = repos
  .filter((r) => r.isDirectory() && !SKIP_SEGMENTS.has(r.name))
  .map((r) => r.name)
  .sort()

let admitted = 0
let reposWithJson = 0
let droppedForSpace = 0
let overSize = 0
const population: string[] = []
const perRepo = new Map<string, number>()

for (const repo of repoDirs) {
  const files: string[] = []
  walkJsonFiles(path.join(CORPUS_ROOT, repo), "", files, 0)
  if (files.length === 0) continue
  reposWithJson++
  admitted += files.length
  let inRepo = 0
  for (const f of files) {
    if (!startsWithTopLevelArray(f)) continue
    if (f.includes(" ")) {
      droppedForSpace++
      continue
    }
    population.push(f)
    inRepo++
  }
  if (inRepo > 0) perRepo.set(repo, inRepo)
}

population.sort()

const selected: string[] = []
for (let i = 0; i < population.length; i += STRIDE) selected.push(population[i])

fs.writeFileSync(outFile, selected.length === 0 ? "" : `${selected.join("\n")}\n`)

console.log(`corpus root                    : ${CORPUS_ROOT}`)
console.log(`repositories                   : ${repoDirs.length}`)
console.log(`repos with json                : ${reposWithJson}`)
console.log(`json files admitted            : ${admitted}`)
console.log(`POPULATION: top level is array : ${population.length}`)
console.log(`  repos contributing          : ${perRepo.size}`)
console.log(`dropped for space              : ${droppedForSpace}`)
console.log(`stride                         : ${STRIDE}`)
console.log(`selected                       : ${selected.length}`)
console.log(`written                        : ${outFile}`)

const top = [...perRepo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log("")
console.log("largest contributors (repo: population files):")
for (const [repo, n] of top) console.log(`  ${repo.padEnd(34)} ${n}`)