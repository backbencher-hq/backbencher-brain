/**
 * go-corpus-root — one sanitized corpus root for the m14 Go evidence scripts.
 *
 * TWO PROBLEMS, one cause. Each of these scripts carried
 *
 *     const CORPUS_ROOT = process.argv[3] || "/home/<user>/bb_tests/repositories/go-stdlib"
 *
 * which (a) writes a HOST-SPECIFIC absolute path into a tracked file — and this project
 * already decided that is not acceptable, in the commit "Public tree: drop internal-ops docs
 * and the local corpus path" — and (b) defaults to `go-stdlib`, a repository that has since
 * been REMOVED from that tree. A script pointed at a missing root either throws an opaque
 * ENOENT deep in a walk or, where the walk is guarded, reports zero files and zero findings,
 * which reads exactly like a clean pass.
 *
 * So the default here is the sanitized `<corpus-root>` placeholder the rest of the tree uses,
 * and `requireCorpusDir` turns an absent root into a NAMED failure with the remedy, so a
 * missing corpus can never be mistaken for a clean measurement.
 *
 * The recorded artifacts under `validation/m14/go/*.json` still hold the real absolute path in
 * their `corpus.root` field, and that is correct: they are the record of where a measurement
 * actually ran. Only the RUNNABLE scripts are sanitized here.
 */
import { existsSync, statSync } from "node:fs"

/** Sanitized corpus root. Override with `GO_CORPUS_ROOT` (or a positional argument). */
export const GO_CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"

/**
 * The repository these scripts were written against. It is NOT in the tree any more, so the
 * default cannot resolve — which is deliberate: the honest outcome is a named failure telling
 * the runner to supply a root, never a zero-file run that looks clean.
 */
export const GO_STDLIB_DEFAULT = `${GO_CORPUS_ROOT}/go-stdlib`

/** Throw unless `dir` is an existing directory, naming the directory and the remedy. */
export function requireCorpusDir(dir: string, what = "corpus root"): string {
  if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  throw new Error(
    `go-corpus-root: ${what} is ABSENT — ${dir}\n` +
      `A missing corpus cannot produce a measurement: the run would examine 0 files and report 0\n` +
      `findings, which is indistinguishable from a clean pass. Pass the root as the third argument,\n` +
      `or set GO_CORPUS_ROOT to a directory that exists.`,
  )
}
