// src/lsp/launch_languages.ts — the SINGLE owner of the bb_lsp launch set.
// Author: Muhammad Ishaq Khan
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
 *  Extension order: M24 launch five, M29 wave 1 (javascript, python),
 *  M29 wave 2 (owner-approved 2026-09-14: groovy, zig, go, rust, c, cpp,
 *  vue, svelte — validation/m29/results/wave-2-approval.json). */
export const LAUNCH_LANGUAGES = [
  "java",
  "groovy",
  "kotlin",
  "scala",
  "typescript",
  "javascript",
  "python",
  "zig",
  "go",
  "rust",
  "c",
  "cpp",
  "vue",
  "svelte",
  // M29 wave 3 (owner-approved 2026-11-08): the remaining analyzers. Each
  // language joins the launch set only through the wave protocol; the wave
  // execution gate reports which of them can actually serve hover/definition/
  // references today and which are blocked on an analyzer gap.
  "tsx",
  "html",
  "css",
  "scss",
  "sass",
  "json",
  "yaml",
  "toml",
  "markdown",
  "xml",
  "graphql",
  "protobuf",
  "sql",
  "perl",
  "ruby",
  "php",
  "lua",
  "elixir",
  "erlang",
  "haskell",
  "clojure",
  "julia",
  "r",
  "bash",
  "powershell",
  "make",
  "swift",
  "dart",
  "csharp",
  "fsharp",
  "nim",
  "vb",
  "vba",
  "matlab",
  "clean",
  "solidity",
  "hcl",
  "terraform",
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
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".zig": "zig",
    ".go": "go",
    ".rs": "rust",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".vue": "vue",
    ".svelte": "svelte",
    // M29 wave 3 — extension-level identity for the onboarded languages.
    // Deliberately ABSENT: ".m" (objc and matlab share it, so it resolves to
    // neither until content sniffing lands — a declared absence, not a guess).
    ".tsx": "tsx",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
    ".markdown": "markdown",
    ".mdx": "markdown",
    ".xml": "xml",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".sql": "sql",
    ".pl": "perl",
    ".pm": "perl",
    ".rb": "ruby",
    ".php": "php",
    ".lua": "lua",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".hs": "haskell",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".cljc": "clojure",
    ".jl": "julia",
    ".r": "r",
    ".sh": "bash",
    ".bash": "bash",
    ".ps1": "powershell",
    ".psm1": "powershell",
    ".mk": "make",
    ".swift": "swift",
    ".dart": "dart",
    ".cs": "csharp",
    ".fs": "fsharp",
    ".fsi": "fsharp",
    ".fsx": "fsharp",
    ".nim": "nim",
    ".vb": "vb",
    ".bas": "vba",
    ".vba": "vba",
    ".icl": "clean",
    ".dcl": "clean",
    ".sol": "solidity",
    ".hcl": "hcl",
    ".tf": "terraform",
    ".tfvars": "terraform",
  }
  return map[ext] ?? null
}
