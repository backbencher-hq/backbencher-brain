/**
 * go-corpus — resolve a Go corpus repo, and REFUSE to let an absent one pass as a clean result.
 *
 * WHY THIS EXISTS. The Go lane scripts each enumerated their corpus with
 *
 *     const dir = path.join(CR, repo)
 *     try { statSync(dir) } catch { continue }        // <-- the defect
 *
 * and defaulted their `--repo` to `go-stdlib,cobra`. Both of those repos were later REMOVED
 * from the corpus, so every one of those scripts ran to completion, printed a report, and
 * reported ZERO for every counter — because it had examined zero files. The output was
 * indistinguishable from a clean run, which is the failure this project already has a name
 * for: A CORPUS LEG THAT PASSED VACUOUSLY.
 *
 * The rule this module enforces is the one that distinguishes the two cases: a repo that was
 * REQUESTED and does not exist is a FATAL input error, while a file that exists and cannot be
 * read stays an ordinary per-file skip. Collapsing those two into one `continue` is what let a
 * missing input read as a passing gate.
 *
 * The defaults name the repos that actually exist today. `go-tools` carries the language's own
 * tooling (analyzers, gopls, ssa) and `terraform` a large application codebase; together they
 * are the 3,422-file population every measurement in the lane notes cites. The root is
 * configurable through `BB_CORPUS_ROOT` and sanitized so no host path is written into a checked-in
 * file.
 */
import { existsSync, statSync } from "node:fs"
import * as path from "node:path"

/** Corpus root, overridable; the fallback is deliberately a non-absolute placeholder. */
export const GO_CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"

/**
 * Repos that EXIST in the corpus. Pass `--repo` to measure others; do not restore the removed
 * `go-stdlib`/`cobra` names here — a default that names a missing repo is exactly the vacuous-pass
 * bug this module was written for.
 */
export const GO_DEFAULT_REPOS = "go-tools,terraform"

/**
 * Resolve one requested repo to its absolute directory, or THROW.
 *
 * Throws rather than returning undefined so the caller cannot accidentally `continue`: a missing
 * requested repo must abort the run with a message naming the directory and the remedy.
 */
export function requireGoRepoDir(repo: string): string {
  const dir = path.join(GO_CORPUS_ROOT, repo)
  if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  throw new Error(
    `go-corpus: requested repo is ABSENT — ${dir}\n` +
      `A requested repo that does not exist cannot produce a result: the run would examine 0 files\n` +
      `and report 0 findings, which is indistinguishable from a clean pass. Set BB_CORPUS_ROOT to\n` +
      `the corpus root, or name existing repos (default: ${GO_DEFAULT_REPOS}).`,
  )
}

/** Split a `--repo a,b,c` argument into names, dropping blanks. */
export function parseGoRepos(spec: string | undefined): string[] {
  return (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean)
}
