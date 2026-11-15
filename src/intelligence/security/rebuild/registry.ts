// ─────────────────────────────────────────────────────────────────────────────
// M72 — per-language security tier registry (all 53 matrix languages).
//
// WHAT THIS FILE IS — the single source of truth for whether bb_security can
// claim a language is scanned, only produces leads, or cannot analyse it at all.
// The tool answer, the language × tool matrix, the docs and the public site all
// read this registry; no hand-written capability list may drift from it.
//
// TIER MEANINGS
//   scan        — real rules + reachability + per-language fixtures + oracle
//                 passing. Vulnerability vocabulary is allowed.
//   leads       — lexical token rules only (the Phase 0/1 engine). Output is a
//                 lead to validate; it is not a finding and carries no claim.
//   unsupported — no executable source/sink model (data / markup / schema /
//                 config / query text). The answer must say "not scanned by
//                 bb_security", never return a clean zero.
//
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md,
//   docs/m72-security-rebuild/LANGUAGES.md, validation/languages/results,
//   script/m72/verify-security-matrix.ts.
// EDIT TOGETHER WHEN THIS CHANGES — spec-types.ts, the engine's spec loader,
//   src/mcp/tools/bb_security/handler.ts, script/verify-language-tool-matrix.ts.
// CONTRACTS IT MUST NOT BREAK — every language the matrix derives has an entry;
//   promotion to `scan` requires the Phase 2 gate evidence; `unsupported` can
//   never be presented as a clean result.
// ─────────────────────────────────────────────────────────────────────────────

import type { SecurityTier } from "./spec-types"

export interface LanguageSecurityEntry {
  tier: SecurityTier
  /** Rendered in the tool answer / docs / matrix evidence. */
  reason: string
  /** Alternate language ids that resolve to this entry. */
  aliases?: string[]
}

/**
 * All 53 languages derived from the engine's supported-language table
 * (validation/languages/results/tool-matrix.json). Phase 0 baseline: every
 * executable code language is `leads`; every data/markup/schema/config language
 * is `unsupported` with an explicit reason. Promotion is a Phase 2 gate.
 */
export const LANGUAGE_SECURITY_ENTRIES: Record<string, LanguageSecurityEntry> = {
  // ── executable code languages: lexical leads until the Phase 2 gate ──────
  bash: { tier: "leads", reason: "shell command/source rules; no shell data-flow proof" },
  c: { tier: "leads", reason: "C source/sink rules; no pointer/alias data flow" },
  clean: { tier: "leads", reason: "Clean source/sink rules; no evaluated data flow yet" },
  clojure: { tier: "leads", reason: "Clojure source/sink rules; no macro-aware flow" },
  cpp: { tier: "leads", reason: "C++ source/sink rules; no template/alias flow" },
  csharp: { tier: "leads", reason: ".NET source/sink rules; no interprocedural flow" },
  dart: { tier: "leads", reason: "Dart source/sink rules; Process APIs covered by spec" },
  elixir: { tier: "leads", reason: "Elixir source/sink rules; no BEAM data-flow proof" },
  erlang: { tier: "leads", reason: "Erlang source/sink rules; os:cmd/file rules" },
  fsharp: { tier: "leads", reason: ".NET F# source/sink rules; no interprocedural flow" },
  go: { tier: "leads", reason: "Go source/sink rules; no SSA/alias data flow" },
  groovy: { tier: "leads", reason: "Groovy source/sink rules; no dynamic-dispatch flow" },
  haskell: { tier: "leads", reason: "Haskell source/sink rules; no laziness-aware flow" },
  java: { tier: "leads", reason: "Java source/sink rules; no interprocedural flow" },
  javascript: { tier: "leads", reason: "JS source/sink rules; no data-flow proof" },
  julia: { tier: "leads", reason: "Julia source/sink rules; run/ccall rules" },
  kotlin: { tier: "leads", reason: "Kotlin source/sink rules; no interprocedural flow" },
  lua: { tier: "leads", reason: "Lua source/sink rules; os.execute/io.popen rules" },
  matlab: { tier: "leads", reason: "MATLAB source/sink rules; system/eval rules" },
  nim: { tier: "leads", reason: "Nim source/sink rules; execProcess rules" },
  "objective-c": { tier: "leads", reason: "Obj-C source/sink rules; no message-flow proof" },
  perl: { tier: "leads", reason: "Perl source/sink rules; ARGV/system rules" },
  php: { tier: "leads", reason: "PHP source/sink rules; superglobal/shell rules" },
  powershell: { tier: "leads", reason: "PowerShell source/sink rules; Invoke-Expression rules" },
  python: { tier: "leads", reason: "Python source/sink rules; no interprocedural flow" },
  r: { tier: "leads", reason: "R source/sink rules; commandArgs/system rules" },
  ruby: { tier: "leads", reason: "Ruby source/sink rules; exec/backtick rules" },
  rust: { tier: "leads", reason: "Rust source/sink rules; Command/std::fs rules" },
  scala: { tier: "leads", reason: "Scala source/sink rules; no interprocedural flow" },
  solidity: { tier: "leads", reason: "Solidity source/sink rules; call/delegatecall rules" },
  swift: { tier: "leads", reason: "Swift source/sink rules; Process/URLSession rules" },
  tsx: { tier: "leads", reason: "TSX resolves to the TypeScript spec", aliases: ["typescript"] },
  typescript: { tier: "leads", reason: "TypeScript source/sink rules; AST source/sink then reachability" },
  vb: { tier: "leads", reason: "VB source/sink rules; Process/File rules" },
  vba: { tier: "leads", reason: "VBA source/sink rules; Shell/CreateObject rules" },
  zig: { tier: "leads", reason: "Zig source/sink rules; std.process.Child rules" },

  // ── data / markup / schema / config / query: no executable source model ──
  css: { tier: "unsupported", reason: "stylesheet text; no executable source/sink surface" },
  graphql: { tier: "unsupported", reason: "schema/query text; not an execution context for taint" },
  hcl: { tier: "unsupported", reason: "configuration language; no tainted execution model" },
  html: { tier: "unsupported", reason: "markup; no executable source/sink surface" },
  json: { tier: "unsupported", reason: "data format; no executable source/sink surface" },
  make: { tier: "leads", reason: "make recipes are real shell; the parser extracts a function symbol per recipe and the make spec scans its body (variable -> shell/eval)" },
  markdown: { tier: "unsupported", reason: "prose; no executable source/sink surface" },
  protobuf: { tier: "unsupported", reason: "schema language; no executable source/sink surface" },
  sass: { tier: "unsupported", reason: "stylesheet text; no executable source/sink surface" },
  scss: { tier: "unsupported", reason: "stylesheet text; no executable source/sink surface" },
  sql: { tier: "unsupported", reason: "SQL text is the sink language, not an execution context with tainted inputs" },
  svelte: { tier: "leads", reason: "component format; pool-worker extracts <script> blocks as JS-family symbols and the svelte spec scans them (template markup excluded)" },
  terraform: { tier: "unsupported", reason: "configuration language; no tainted execution model" },
  toml: { tier: "unsupported", reason: "data format; no executable source/sink surface" },
  vue: { tier: "leads", reason: "component format; pool-worker extracts <script> blocks as JS-family symbols and the vue spec scans them (v-html/template markup excluded)" },
  xml: { tier: "unsupported", reason: "markup/data; no executable source/sink surface" },
  yaml: { tier: "unsupported", reason: "data format; no executable source/sink surface" },
}

/** Aliases that resolve one language id to another language's registry entry. */
export const SECURITY_LANGUAGE_ALIASES: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  "objective-c": "objective-c",
}

function normalize(language: string): string {
  const key = (language ?? "").trim().toLowerCase()
  return SECURITY_LANGUAGE_ALIASES[key] ?? key
}

/** The registry entry for a language, with a declared fallback (never a silent default). */
export function securityEntryFor(language: string): LanguageSecurityEntry {
  const key = normalize(language)
  return (
    LANGUAGE_SECURITY_ENTRIES[key] ?? {
      tier: "unsupported",
      reason: `language "${language}" has no registered security spec; not scanned by bb_security`,
    }
  )
}

export function securityTierFor(language: string): SecurityTier {
  return securityEntryFor(language).tier
}

export interface SecurityTierCounts {
  total: number
  scan: number
  leads: number
  unsupported: number
  scanLanguages: string[]
  leadLanguages: string[]
  unsupportedLanguages: string[]
}

/** Counts over the registry, deterministic and sorted. */
export function securityTierCounts(): SecurityTierCounts {
  const languages = Object.keys(LANGUAGE_SECURITY_ENTRIES).sort()
  const scan: string[] = []
  const leads: string[] = []
  const unsupported: string[] = []
  for (const language of languages) {
    const tier = LANGUAGE_SECURITY_ENTRIES[language]!.tier
    if (tier === "scan") scan.push(language)
    else if (tier === "leads") leads.push(language)
    else unsupported.push(language)
  }
  return {
    total: languages.length,
    scan: scan.length,
    leads: leads.length,
    unsupported: unsupported.length,
    scanLanguages: scan,
    leadLanguages: leads,
    unsupportedLanguages: unsupported,
  }
}

/** One line the tool answer can print verbatim; counts come from this registry. */
export function formatSecurityTierDeclaration(): string {
  const c = securityTierCounts()
  return (
    `tiers: ${c.scan} scan / ${c.leads} leads / ${c.unsupported} unsupported (of ${c.total} analyzers) — ` +
    `unsupported languages are NOT scanned by bb_security; leads require manual validation`
  )
}
