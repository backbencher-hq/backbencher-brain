#!/usr/bin/env bun
// THE LANE'S ENDPOINT-SHAPE RULE — one copy, imported by every instrument that judges an endpoint.
//
// ## Why this file exists
//
// Two instruments ask "can this endpoint be a TypeScript name at all?" — the R7 endpoint probe
// (`ts-r7-endpoint-probe.ts`) and the self-corpus probe (`ts-self-corpus-probe.ts`). A rule with two
// copies has two answers, and this lane has already paid for that class twice. So the rule lives
// HERE, and the instruments import it.

/**
 * A TypeScript name: an identifier, a dotted path, a `#private` — anything a declaration can carry.
 * Whitespace, brackets, angle brackets, a question mark, a colon-space or a bare `(` is not a name.
 * The character test is deliberately ASCII: every corpus endpoint measured under this rule was ASCII,
 * and admitting Unicode identifiers would need a real lexer, not a wider character class.
 */
export function nameShapeOk(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
      c === "_" || c === "$" || c === "#" || c === "."
    if (!ok) return false
  }
  return true
}

/** Syntactically fine, semantically a stand-in: `unknown`, `anonymous`, `TODO`, `default`, `fn`. */
export const PLACEHOLDER_LITERALS = new Set([
  "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "todo", "tbd", "n/a", "na",
  "none", "anonymous", "<anonymous>", "anonymousfunction", "placeholder", "xxx", "<lambda>",
  "lambda", "func", "fn", "emptyname", "noname", "unnamed", "notset", "unset", "default",
])
