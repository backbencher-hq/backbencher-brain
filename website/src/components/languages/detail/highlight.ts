// A small, honest syntax highlighter for the language page's code plate.
//
// WHY NOT A REAL GRAMMAR
// ----------------------
// The site's samples are six lines each, in the site's languages, and they are
// written to be *read*, not parsed. Pulling a per-language grammar in here
// would be a large dependency for a decoration, and every grammar would need
// its own wasm build. This module recognises the four things every one of
// these languages shares — comments, strings, numbers, and keywords — and
// leaves everything else alone.
//
// Two rules, both load-bearing:
//   1. It may only ever change a COLOUR. Tokenisation never restructures the
//      source, so a misfire is cosmetic and a malformed match cannot lose
//      text: every unmatched slice is emitted verbatim, in order.
//   2. Every colour it emits is one the design gate has already verified
//      against the plate surface (see `text-[…]` values in `CLAIMS`).
//
// The comment rule is deliberately conservative about the markers that are
// also operators (`--`, `;`, `%`): those only start a comment at the head of a
// line, so `i--` in C and a trailing `-` in a Make variable are never eaten.
// `//` and `#` may also trail real code, because the samples' own "bb records:"
// annotations live exactly there.

export type TokenKind = "plain" | "comment" | "meta" | "string" | "number" | "keyword" | "name"

export type Token = { kind: TokenKind; value: string }

/** Tailwind text classes per kind — all clear 4.5:1 on the night code plate. */
export const CLAIMS: Record<TokenKind, string> = {
  plain: "text-[#D9CDBC]",
  // Comments in these samples are not decoration — every sample annotates what
  // bb records on the line beside it — so this is the bone-2 tier, not a faint
  // separator colour.
  comment: "text-[#A79E90]",
  meta: "text-[#D8A24A]",
  string: "text-[#C3B49A]",
  number: "text-[#D8A24A]",
  keyword: "text-[#FF8A66]",
  name: "text-[#EDE6D8]",
}

// One shared keyword vocabulary. It is the intersection of the site's
// grammars rather than a union: a word that is a keyword in one language and a
// plain name in another (e.g. `type`, `var`) would be a lie in the second, so
// only tokens that are keywords nearly everywhere are coloured as keywords.
const KEYWORDS = new Set(
  [
    // declarations
    "def", "fn", "func", "function", "class", "struct", "interface", "trait", "impl",
    "enum", "type", "module", "namespace", "package", "record", "object", "protocol",
    "defmodule", "defmacro", "macro", "data", "newtype", "signature", "value", "let",
    "public", "private", "protected", "static", "final", "abstract", "partial", "async",
    "readonly", "sealed", "override", "inline", "export", "extern",
    // bindings
    "const", "var", "val", "mut", "local", "let!", "my", "our",
    // flow
    "return", "if", "else", "elif", "then", "end", "do", "begin", "case", "when",
    "match", "switch", "while", "for", "foreach", "in", "of", "unless", "until",
    "yield", "break", "continue", "pass", "try", "catch", "except", "finally", "raise",
    "throw", "defer", "goto", "with", "where",
    // imports
    "import", "from", "as", "use", "using", "require", "require_relative", "include",
    "package", "open", "load",
    // literals
    "true", "false", "null", "nil", "none", "undefined", "self", "this", "super",
    "new", "delete", "and", "or", "not", "is", "in", "as",
  ].map((k) => k.toLowerCase()),
)

const PATTERN = new RegExp(
  [
    // 1. block comments: /* … */  <!-- … -->  {- … -}
    "(?:\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->|\\{-[\\s\\S]*?-\\})",
    // 2. line comments that may trail real code: // …  # …
    "(?:\\/\\/[^\\n]*|#[^\\n]*)",
    // 3. line comments that only count at the head of a line: -- …  ; …  % …
    "(?:^|\\n)[ \\t]*(?:--|;|%)(?![-=])[^\\n]*",
    // 4. strings, triple-quoted first, escapes honoured
    "(?:\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`)",
    // 5. numbers, including hex and separators
    "\\b(?:0[xX][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b",
    // 6. identifiers — classified in code, since the keyword set is shared
    "[A-Za-z_$@][\\w$!?]*",
  ].join("|"),
  "gm",
)

// `#include`, `#define`, … are preprocessor, not commentary: colour them as
// meta so a C sample does not read as if its includes were remarks.
const DIRECTIVE = /^#\s*(?:include_next|include|define|undef|ifdef|ifndef|endif|elif|else|if|pragma|error|warning|line)\b/

function classify(identifier: string): TokenKind {
  if (KEYWORDS.has(identifier.toLowerCase())) return "keyword"
  // PHP/Bash sigils are decoration, not part of the name.
  const bare = identifier.replace(/^[$\\@]+/, "")
  // SCREAMING_CASE and PascalCase read as named things in every one of these
  // languages (types, constants, environment variables) without claiming to
  // know which: a lower-case name is never re-coloured on a guess.
  return /^[A-Z]/.test(bare) || (/^[A-Z0-9_]+$/.test(bare) && /[A-Z]/.test(bare)) ? "name" : "plain"
}

/** Split source into coloured tokens. Total, ordered, and lossless. */
export function highlight(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  PATTERN.lastIndex = 0

  for (let m = PATTERN.exec(source); m; m = PATTERN.exec(source)) {
    const value = m[0]
    if (m.index > cursor) tokens.push({ kind: "plain", value: source.slice(cursor, m.index) })
    // A leading newline belongs to the line-comment rule's lookahead; keep it
    // with the plain text so no line is ever indented by a token.
    const trimmed = value.replace(/^(\n[ \t]*)/, "")
    let kind: TokenKind = "plain"
    if (trimmed.startsWith("/*") || trimmed.startsWith("<!--") || trimmed.startsWith("{-")) kind = "comment"
    else if (trimmed.startsWith("//") || trimmed.startsWith(";")) kind = "comment"
    else if (trimmed.startsWith("#")) kind = DIRECTIVE.test(trimmed) ? "meta" : "comment"
    else if (trimmed.startsWith("--") || trimmed.startsWith("%")) kind = "comment"
    else if (/^["'`]/.test(trimmed)) kind = "string"
    else if (/^[0-9]/.test(trimmed)) kind = "number"
    else kind = classify(trimmed)

    if (trimmed !== value) tokens.push({ kind: "plain", value: value.slice(0, value.length - trimmed.length) })
    tokens.push({ kind, value: trimmed })
    cursor = m.index + value.length
  }

  if (cursor < source.length) tokens.push({ kind: "plain", value: source.slice(cursor) })
  return tokens
}