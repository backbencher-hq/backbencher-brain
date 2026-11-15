// Deterministic corpus file selection for the go lane.
//
// NO REGEX anywhere in this file. Every decision is made by comparing
// `String.endsWith` / `String.localeCompare` / integer ranges, and every
// directory decision is made from `Dirent.isDirectory()`.
//
// WHY this exists rather than reusing script/m14/firing-check.mjs's picker:
// that harness picks the FIRST 12 files a depth-first walk happens to reach,
// which for go-stdlib lands in `src/cmd/...` and its generator tooling. A
// census that only ever reads one corner of a 11,800-file corpus cannot answer
// "does this type ever fire", which is the question JOB 1 asks. So the sample
// here is spread deterministically across the whole tree and its size is a
// parameter, not a constant.

import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export interface CorpusFile {
  path: string
  rel: string
  bytes: number
}

const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "testdata",
  "node_modules",
  "vendor",
  "_obj",
  "_test",
  "obj",
])

export function isGoSourceName(name: string): boolean {
  return name.endsWith(".go")
}

export function isTestFileName(name: string): boolean {
  // tree-sitter parses _test.go identically to any other file, but they are
  // 1/3 of go-stdlib and their shape (table-driven, one giant TestXxx) is not
  // representative of library code. Sampled separately so a verdict can say
  // which population it measured.
  return name.endsWith("_test.go")
}

export function collectAllGoFiles(root: string, maxDepth = 12): CorpusFile[] {
  const out: CorpusFile[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // Sort by name so the walk order is a function of the filesystem, not of
    // inode order. localeCompare with an explicit locale keeps it stable across
    // machines with different collation defaults.
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"))
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue
        walk(p, depth + 1)
      } else if (e.isFile() && isGoSourceName(e.name)) {
        let bytes = 0
        try {
          bytes = statSync(p).size
        } catch {
          continue
        }
        out.push({ path: p, rel: relative(root, p), bytes })
      }
    }
  }
  walk(root, 0)
  return out
}

/**
 * Evenly spaced deterministic sample.
 *
 * Walks the sorted candidate list and takes `want` entries at a fixed stride,
 * so the sample covers the first file, the last file and everything between at
 * a uniform interval. A stride sample beats a head sample here because go-stdlib
 * is alphabetical by package: the first N files are all `src/arena` and the last
 * N are all `src/vendor`-adjacent tooling.
 */
export function strideSample<T>(items: T[], want: number): T[] {
  if (want <= 0) return []
  if (items.length <= want) return items.slice()
  const stride = items.length / want
  const out: T[] = []
  for (let i = 0; i < want; i++) {
    out.push(items[Math.min(items.length - 1, Math.floor(i * stride))])
  }
  return out
}

export function splitTestAndNonTest(files: CorpusFile[]): { lib: CorpusFile[]; test: CorpusFile[] } {
  const lib: CorpusFile[] = []
  const test: CorpusFile[] = []
  for (const f of files) {
    const base = f.rel.slice(f.rel.lastIndexOf("/") + 1)
    if (isTestFileName(base)) test.push(f)
    else lib.push(f)
  }
  return { lib, test }
}

/**
 * Which top-level src/ package a file came from, read by string slicing on the
 * separator rather than a pattern. Used to report coverage spread.
 */
export function topPackage(rel: string): string {
  const parts = rel.split("/")
  // expected shape: src/<pkg>/... ; anything else is reported as itself so the
  // row cannot silently disappear.
  if (parts.length >= 2 && parts[0] === "src") return parts[1]
  return parts[0]
}