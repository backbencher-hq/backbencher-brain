// script/lib/corpus-root.ts — where the fixtures corpus lives on THIS machine.
//
// WHY THIS EXISTS. 54 gate scripts in `npm run verify` hardcoded
// `$HOME/fixtures/repositories` — the other laptop's home directory. On any
// machine but that one, every one of those gates either crashed with ENOENT or resolved
// to nothing and passed vacuously.
//
// Measured on script/m13/verify-ask-e2e-corpus.ts, changing only the corpus root:
//
//   before: A5: KNOWN-GAP (4/8 passed, 2 negatives)     exit 1
//   after:  A5: KNOWN-GAP (19/20 passed, 5 negatives)    exit 1
//
// Four checks to nineteen. The gate was not reporting on the product at all; it was
// reporting that a directory does not exist here.
//
// WHAT IT DOES NOT DO. It does not decide whether a corpus is REQUIRED. A gate whose
// subject cannot be reached should record a DECLARED BLOCK naming every path searched
// (the convention script/m15/verify-security-deep.ts established), not crash and not
// pass. `resolveCorpusRoot()` returning null is the signal to do that.
//
// ORDER MATTERS and is deliberate:
//   1. an explicit env var, because the owner may keep the corpus anywhere;
//   2. the legacy location, because if someone still HAS it there this should work
//      unchanged rather than break a machine that was fine yesterday;
//   3. $HOME/fixtures/repositories, the natural per-user location;
//   4. a sibling of the repo, which is where it actually lives in this checkout;
//   5. inside the repo itself.
//
// The legacy path is kept as a candidate on purpose. It is not a foreign path once it
// exists on the machine you are standing on — it is simply where the corpus was, and
// removing it would break the other laptop for no gain. What must not happen is
// relying on it WITHOUT checking, which is what these 54 gates did.

import { existsSync } from "node:fs"
import path from "node:path"

/** Every location searched, in order. Exported so a gate can say where it looked. */
export function corpusRootCandidates(repoRoot: string): string[] {
  return [
    process.env.BB_CORPUS_ROOT,
    process.env.BB_SECURITY_CORPUS_ROOT,
    // Where the corpus lived on the other machine. Still honoured if present here.
    "$HOME/fixtures/repositories",
    path.join(process.env.HOME ?? "", "fixtures", "repositories"),
    path.join(repoRoot, "fixtures", "repositories"),
    path.resolve(repoRoot, "../fixtures/repositories"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0)
}

/**
 * The corpus root on this machine, or null when it is not present.
 *
 * `repoRoot` is the repository root — pass `process.cwd()` from a gate that already
 * has a ROOT, or the absolute path to the repo.
 */
export function resolveCorpusRoot(repoRoot: string = process.cwd()): string | null {
  for (const c of corpusRootCandidates(repoRoot)) {
    try {
      if (existsSync(c)) return c
    } catch {
      // An unreadable candidate is simply not a match; keep looking.
    }
  }
  return null
}

/**
 * The one line a gate should print when the corpus is absent. Named so the message is
 * identical everywhere, which is what makes it recognisable in a log.
 */
export function corpusMissingMessage(repoRoot?: string): string {
  const searched = corpusRootCandidates(repoRoot ?? process.cwd())
  return (
    "no corpus found. Set BB_CORPUS_ROOT to a fixtures/repositories directory. " +
    `Searched: ${searched.join(", ")}`
  )
}