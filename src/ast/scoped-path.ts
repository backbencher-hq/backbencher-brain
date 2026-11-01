// src/ast/scoped-path.ts — one answer to "which file does this scoped request name?"
//
// WHY THIS EXISTS. `bb index <dir> --file <path>` accepted the argument VERBATIM and handed it to
// `indexProjectParallel({ files: [...] })`. A path that is relative to the project directory is the
// natural invocation (`cd project && bb index --file src/a.ts`), and the indexer stored it verbatim in
// `brain_file.path` — while every other run stores ABSOLUTE paths. The next run, from any other
// working directory, asks `purgeDeletedFiles()` whether that file still exists and gets `existsSync`
// against the PROCESS CWD: the live file is judged deleted and its symbols/relationships/embeddings are
// deleted with it. Reproduced 2026-11-01: full index of an 11-file project → `--file src/util/math.ts`
// from the project dir → run from the repo root → "purged 1 deleted file(s)", 11 files → 10, exit 0.
//
// The MCP `bb_index` tool already refuses paths outside the project for the same reason (its comment
// records an out-of-tree write that polluted `relative_path`). The CLI had no such check and the API
// accepted anything, so the rule belongs in ONE place every caller can share.
//
// The contract is deliberately small and uses plain string/path operations (no lexer, no regex):
//   resolveScopedProjectFile(projectPath, input):
//     - ""                                            → empty-path
//     - relative                                      → resolved against the PROJECT directory (never cwd)
//     - absolute                                      → used as-is
//     - nonexistent                                   → not-found
//     - a directory                                   → not-a-file
//     - resolves outside the project (symlinks too)   → outside-project
//   The caller decides what to do (CLI: print + exit 1; indexer: skip + count), but every caller gets
//   the same verdict and the same absolute path.
import { existsSync, realpathSync, statSync } from "fs"
import path from "path"

export type ScopedPathFailure = "empty-path" | "not-found" | "not-a-file" | "outside-project"

export type ScopedPathResult =
  | { ok: true; absolute: string }
  | { ok: false; reason: ScopedPathFailure; resolved: string; projectRoot: string }

/** Canonicalize a project root; lexical resolve when it does not exist yet (validation paths). */
export function canonicalProjectRoot(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function isInsideProject(absolute: string, projectRoot: string): boolean {
  if (absolute === projectRoot) return true
  return absolute.startsWith(projectRoot + path.sep)
}

/**
 * Resolve one scoped file request against the project directory.
 *
 * The returned `absolute` is a REAL path (symlinks resolved), so two different spellings of the same
 * file cannot produce two index rows, and a symlink that escapes the project is refused rather than
 * silently indexed outside it.
 */
export function resolveScopedProjectFile(projectPath: string, input: unknown): ScopedPathResult {
  const projectRoot = canonicalProjectRoot(projectPath)
  const raw = typeof input === "string" ? input.trim() : ""
  if (raw.length === 0) return { ok: false, reason: "empty-path", resolved: projectRoot, projectRoot }
  // Resolve against the PROJECT directory, never the process cwd: `--file src/a.ts` means the file
  // inside the project the command is indexing, which is also what the help says after this change.
  const lexical = path.resolve(projectRoot, raw)
  if (!isInsideProject(lexical, projectRoot)) {
    return { ok: false, reason: "outside-project", resolved: lexical, projectRoot }
  }
  let canonical = lexical
  try {
    canonical = realpathSync.native(lexical)
  } catch {
    return { ok: false, reason: "not-found", resolved: lexical, projectRoot }
  }
  if (!isInsideProject(canonical, projectRoot)) {
    // A symlink inside the project whose target is outside it names an out-of-tree file; indexing it
    // would write a path the scoped read tools cannot name.
    return { ok: false, reason: "outside-project", resolved: canonical, projectRoot }
  }
  try {
    if (!statSync(canonical).isFile()) return { ok: false, reason: "not-a-file", resolved: canonical, projectRoot }
  } catch {
    return { ok: false, reason: "not-found", resolved: canonical, projectRoot }
  }
  if (!existsSync(canonical)) return { ok: false, reason: "not-found", resolved: canonical, projectRoot }
  return { ok: true, absolute: canonical }
}

/** Human sentence for a refusal, used by the CLI and by gate output. No path is guessed. */
export function describeScopedPathRefusal(result: Extract<ScopedPathResult, { ok: false }>): string {
  const where = `(resolved against ${result.projectRoot})`
  if (result.reason === "empty-path") return `--file path is empty ${where}`
  if (result.reason === "not-found") return `--file not found: ${result.resolved} ${where}`
  if (result.reason === "not-a-file") return `--file is not a file: ${result.resolved} ${where}`
  return `--file is outside the project: ${result.resolved}; the project root is ${result.projectRoot}`
}
