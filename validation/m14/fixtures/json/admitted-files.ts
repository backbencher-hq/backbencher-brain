/**
 * THE ADMITTED POPULATION — one enumerator, so the lane has one denominator.
 *
 * ## Why this file exists
 *
 * This lane's §*Declared limitations* 7 recorded three instruments disagreeing
 * about how many json files the corpus holds:
 *
 *   - `census.ts`                     : 13,951
 *   - `top-level-array-selection.ts` : 13,884
 *   - an independent walk of "the same rules": 13,851
 *
 * and could not say which was right. It is now possible to say, because the three
 * walks differ in TWO ways and both were real:
 *
 *   1. **A symlinked repository was dropped.** `Dirent.isDirectory()` is FALSE for a
 *      symlink — it reports the link, not its target. Every walk built on it therefore
 *      omitted `proxicall`, which in this corpus is a symlink to
 *      /home/ishaq2321/ProxiCall and is a real repository with 114 git-tracked
 *      json-family files. The census already used `statSync(dir).isDirectory()`,
 *      which follows the link, so the census counted it and the probes did not.
 *      Nothing printed the omission: a repository simply was not there.
 *   2. **The filesystem walk admits untracked build output.** `git ls-files` sees 114
 *      json files in `proxicall`; the walk over the same tree sees **781**, of which
 *      **450 are under `.dart_tool`**. A build artifact is not what a consumer of the
 *      graph sees, which is the reason the census took tracked files only in the
 *      first place — and the reason the walk's own count drifted upward every time
 *      somebody ran a build.
 *
 * Neither walk was lying; they were admitting different populations under rules that
 * were never written down in one place. So the rules are written down here, once, and
 * both instruments import them.
 *
 * ## The admission test, and why each clause is here
 *
 *   - one entry per repository, **symlinks followed** (`statSync`, not `isDirectory`),
 *     because a symlinked checkout is a checkout;
 *   - `git rev-parse --git-dir` must succeed, so a stray directory in the corpus root
 *     is not walked as a repository;
 *   - **`git ls-files` only** — tracked files. An untracked artifact is not a document
 *     a consumer of the graph reads;
 *   - size ≤ `maxBytes` (default 512 KB), the census's per-file cap;
 *   - `detectLanguageFromPath(abs, text) === "json"`, the same admission test the
 *     ontology gate uses, so every instrument here answers about the same population
 *     the gate does;
 *   - paths sorted by (repo, git path), so the enumeration is a function of the corpus
 *     and not of directory-read order.
 *
 * ## What callers may still vary
 *
 * `maxBytes` is a parameter rather than a constant because the ruling recheck
 * deliberately measures a SUPERSET of the census population — it does not apply the
 * cap, and says so, so its denominator is larger and its ruling is stronger. It is the
 * one instrument that overrides this default, and it prints the override.
 *
 * Regex-free: every predicate is a string or path-segment test.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

export const DEFAULT_MAX_BYTES = 512 * 1024

export type AdmittedFile = { repo: string; dir: string; rel: string; abs: string }

export type AdmittedWalk = {
  files: AdmittedFile[]
  repos: string[]
  /** Repositories in the corpus root, and why each was not walked. Never silent. */
  skipped: { name: string; reason: "not-a-directory" | "not-a-git-repository" }[]
  overCap: number
  rejectedByLanguageDetection: number
  unreadable: number
  maxBytes: number
}

const GIT_ARGS = { stdio: "ignore" as const }
const LS_FILES_BUFFER = 512 * 1024 * 1024

/**
 * The admitted population of the corpus at `corpusRoot`.
 *
 * Expensive: one `git ls-files` per repository. Call it once and share the result;
 * the census already passes its population to children as a JSON manifest for exactly
 * this reason.
 */
export function admittedFiles(corpusRoot: string, maxBytes: number = DEFAULT_MAX_BYTES): AdmittedWalk {
  const files: AdmittedFile[] = []
  const repos: string[] = []
  const skipped: AdmittedWalk["skipped"] = []
  let overCap = 0
  let rejectedByLanguageDetection = 0
  let unreadable = 0

  const entries = readdirSync(corpusRoot).sort()
  for (const name of entries) {
    const dir = path.join(corpusRoot, name)
    // statSync FOLLOWS a symlink. `Dirent.isDirectory()` does not, and using it here
    // is how this corpus's `proxicall` went missing from three instruments.
    try {
      if (!statSync(dir).isDirectory()) {
        skipped.push({ name, reason: "not-a-directory" })
        continue
      }
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], GIT_ARGS)
    } catch {
      skipped.push({ name, reason: "not-a-git-repository" })
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: LS_FILES_BUFFER,
      })
        .split("\0")
        .filter(Boolean)
        .sort()
    } catch {
      skipped.push({ name, reason: "not-a-git-repository" })
      continue
    }
    let kept = 0
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        // `maxBytes <= 0` means UNCAPPED, which this file's header promises callers: a
        // superset walk for testing a ruling where it is weakest. It did not mean that —
        // `size > 0` drops every non-empty file, so asking for the superset returned 20
        // files out of 14,095 and the number looked like a finding about the language.
        if (maxBytes > 0 && statSync(abs).size > maxBytes) {
          overCap++
          continue
        }
        text = readFileSync(abs, "utf8")
      } catch {
        unreadable++
        continue
      }
      if (detectLanguageFromPath(abs, text) !== "json") {
        rejectedByLanguageDetection++
        continue
      }
      files.push({ repo: name, dir, rel, abs })
      kept++
    }
    if (kept > 0) repos.push(name)
  }

  return {
    files,
    repos,
    skipped,
    overCap,
    rejectedByLanguageDetection,
    unreadable,
    maxBytes,
  }
}

/**
 * `PER_REPO` files from each repository, by STRIDE — index floor(i * n / PER_REPO).
 *
 * A stride rather than a prefix, because a prefix clusters in a repository's first
 * sorted directory, which for most of this corpus is a fixtures or changelog dump.
 * Paths containing a space are dropped and RETURNED, because the documented
 * invocation passes them through the shell and a space splits one path into two
 * arguments, which throws inside `parseFile` and contributes zero symbols silently.
 */
export function stridePerRepo(
  files: AdmittedFile[],
  perRepo: number,
): { selected: AdmittedFile[]; droppedForSpace: number } {
  const byRepo = new Map<string, AdmittedFile[]>()
  for (const f of files) {
    const list = byRepo.get(f.repo)
    if (list) list.push(f)
    else byRepo.set(f.repo, [f])
  }
  const selected: AdmittedFile[] = []
  let droppedForSpace = 0
  for (const repo of [...byRepo.keys()].sort()) {
    const list = byRepo.get(repo)!.slice().sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    const take = Math.min(perRepo, list.length)
    for (let i = 0; i < take; i++) {
      const index = Math.floor((i * list.length) / take)
      const picked = list[Math.min(index, list.length - 1)]
      if (picked.abs.includes(" ")) {
        droppedForSpace++
        continue
      }
      selected.push(picked)
    }
  }
  return { selected, droppedForSpace }
}

/** The header both instruments print, so no number is quotable without its denominator. */
export function describeWalk(walk: AdmittedWalk, corpusRoot: string): string {
  const linked = skippedSymlinks(corpusRoot, walk)
  return [
    `corpus root        : ${corpusRoot}`,
    `repositories walked: ${walk.repos.length} with admitted json files`,
    `admitted files     : ${walk.files.length}  (cap ${walk.maxBytes} B)`,
    `over the size cap  : ${walk.overCap}`,
    `not json by detect : ${walk.rejectedByLanguageDetection}`,
    `unreadable         : ${walk.unreadable}`,
    `root entries skipped: ${walk.skipped.length}` +
      (walk.skipped.length ? ` (${walk.skipped.map((s) => `${s.name}: ${s.reason}`).join(", ")})` : ""),
    `root entries that are SYMLINKS to a directory, and are therefore walked: ${linked}`,
  ].join("\n")
}

/**
 * How many corpus-root entries are symlinks resolving to a directory.
 *
 * Printed by `describeWalk` because the number of files such a link contributes is the
 * difference between this enumerator and a `Dirent.isDirectory()` walk, and that
 * difference was invisible for the whole life of limitation 7.
 */
function skippedSymlinks(corpusRoot: string, walk: AdmittedWalk): number {
  let n = 0
  for (const name of readdirSync(corpusRoot)) {
    const p = path.join(corpusRoot, name)
    try {
      if (statSync(p).isDirectory() && readdirSync(corpusRoot, { withFileTypes: true })
        .find((e) => e.name === name && e.isSymbolicLink())) n++
    } catch {
      /* an entry that cannot be stat'd is counted by the walk's own skip list */
    }
  }
  return n
}