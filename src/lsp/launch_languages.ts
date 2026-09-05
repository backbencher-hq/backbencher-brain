// src/lsp/launch_languages.ts — the SINGLE owner of the bb_lsp launch set.
//
// History: the set was "the five #419-CONFORMANT languages" (M24) and lived
// duplicated in hover.ts and server.ts (a drift hazard found by M29.R2's wave
// execution). M29.R2's wave-1 execution — owner-approved languages recorded
// in validation/m29/results/wave-1-approval.json — extends the set with
// javascript and python (contract §9: language N+1 joins as a routine gated
// wave, and M29.R2's mandate is exactly this onboarding).
//
// Authority rule: this set changes ONLY through an owner-approved wave record
// (validation/mXX/results/wave-N-approval.json). The verifier
// (script/m29/verify-wave-protocol.ts) drift-gates this file against the
// approval record: a language here without approval, or approved but missing,
// fails the gate.

import path from "node:path"

/** The launch set: languages bb_lsp serves with real index-backed features.
 *  Extension order: M24 launch five, then M29 wave 1 (javascript, python). */
export const LAUNCH_LANGUAGES = [
  "java",
  "groovy",
  "kotlin",
  "scala",
  "typescript",
  "javascript",
  "python",
] as const

export type LaunchLanguage = (typeof LAUNCH_LANGUAGES)[number]

/** True when the language is in the launch set; anything else is declared
 *  absent — a documented limitation, never a crash. */
export function isLaunchLanguage(language: string | null): boolean {
  return language !== null && (LAUNCH_LANGUAGES as readonly string[]).includes(language)
}

/** Language for a file path (extension-based; L1 scope is extension-level).
 *  path.extname semantics: dotfiles (".gitignore") have no extension. */
export function languageForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    ".java": "java",
    ".groovy": "groovy",
    ".gradle": "groovy",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".sc": "scala",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
  }
  return map[ext] ?? null
}
