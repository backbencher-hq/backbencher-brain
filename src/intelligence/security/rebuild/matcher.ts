// ─────────────────────────────────────────────────────────────────────────────
// M72 — lexical matcher for the spec-driven security engine.
//
// WHAT THIS FILE IS — the layer that turns raw symbol text into bounded,
// offset-carrying token matches. It masks every comment and string literal using
// the LANGUAGE's own `LanguageSecuritySpec.lexical` syntax (no language is named
// here: a spec that declares `#` line comments gets `#` line comments), then runs
// the spec's `SourceRule.pattern` / `SinkRule.pattern` regexes over the masked
// text and records for each match:
//   - UTF-8 BYTE offsets relative to the symbol snippet (TokenMatch.byteStart /
//     byteEnd) plus code-unit offsets used internally by the flow engine,
//   - the one-based line within the symbol,
//   - bounded evidence text from the ORIGINAL source (never the masked text).
// A sink match additionally carries the call's argument list and the trailing
// call-chain text, so the flow engine can decide whether the dangerous argument
// is dynamic without re-implementing call parsing.
//
// WHY MASKING IS LENGTH-PRESERVING — offsets must survive masking: every masked
// code unit is replaced with a space, and `\n`/`\r` are preserved, so a match
// found in the masked text has exactly the same offsets in the original source.
// String DELIMITERS are kept visible (only their contents are blanked) so a
// caller can still tell a literal from an identifier; comments are blanked
// entirely. An unterminated block comment or string is treated as ordinary
// punctuation instead of masking the rest of the symbol (a stray `'` in prose or
// a Rust lifetime `'a` must not silently blind the engine).
//
// WHICH TOOL IT SERVES — bb_security via src/intelligence/security/rebuild/
//   engine.ts (the pool-worker/parallel-indexer path).
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md (the 88%
//   "no SQL keyword in the body" measurement and the `.exec()` / comment /
//   string false positives), script/m72/engine/run.ts.
// EDIT TOGETHER WHEN THIS CHANGES — spec-types.ts (contract), flow.ts (the
//   consumer of these matches), engine.ts, the per-language spec files.
// CONTRACTS IT MUST NOT BREAK — a match inside a comment or string literal is
//   never produced; offsets are UTF-8 byte offsets relative to the given symbol
//   text; the same input always produces the same matches in the same order; no
//   language name appears in this file.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  LanguageSecuritySpec,
  LexicalSyntax,
  SecurityVulnerability,
  Severity,
  SinkRule,
  SourceKind,
  SourceRule,
  TokenMatch,
} from "./spec-types"

/** Default bound on evidence text kept per match (`TokenMatch.text`). */
export const DEFAULT_TEXT_LIMIT = 200
/** Default cap on matches kept per rule, per symbol. */
export const DEFAULT_MATCHES_PER_RULE = 64

/** A half-open code-unit span in the symbol source. */
export interface TextSpan {
  start: number
  end: number
}

/** The symbol text plus the comment/string regions that were blanked. */
export interface MaskedSource {
  /** The original symbol text given to the matcher. */
  source: string
  /** Same length as `source`; comments/string contents replaced with spaces. */
  masked: string
  /** String-literal spans in the ORIGINAL source (delimiters included; contents masked). */
  strings: TextSpan[]
  /** Comment spans in the ORIGINAL source. */
  comments: TextSpan[]
}

/** A source match: a `TokenMatch` plus the rule's semantics and code-unit span. */
export interface SecuritySourceMatch extends TokenMatch {
  /** Code-unit start (flow-engine coordinate; byteStart is the persisted one). */
  charStart: number
  /** Code-unit end, exclusive (flow-engine coordinate). */
  charEnd: number
  sourceType: SourceKind
  description: string
  /** Variable captured by the rule (`captureVariable`), when the rule asked for one. */
  variable?: string
}

/** One argument expression of a matched sink call. */
export interface SinkCallArgument {
  /** Zero-based argument position. */
  index: number
  /** Code-unit start of the trimmed argument in the original source. */
  charStart: number
  /** Code-unit end, exclusive. */
  charEnd: number
  /** Trimmed original-source text, bounded by the context text limit. */
  text: string
  /** Trimmed masked text (comments/string contents blanked) — lexical checks only. */
  masked: string
}

/** A selector candidate span (`SinkRule.argument: "any"` uses the trailing span). */
export interface SinkSpan {
  charStart: number
  charEnd: number
  /** Trimmed original-source text, bounded by the context text limit. */
  text: string
  /** Trimmed masked text — lexical checks only. */
  masked: string
}

/** A sink match: a `TokenMatch` plus the call shape the flow engine needs. */
export interface SecuritySinkMatch extends TokenMatch {
  charStart: number
  charEnd: number
  vulnerability: SecurityVulnerability
  sinkType: string
  /** Rule-declared severity; the flow engine may only lower it, never raise it. */
  severity: Severity
  description: string
  /** Which argument the rule says must be dynamic. */
  argumentSelector: SinkRule["argument"]
  /** Defaults to true when the spec omits it. */
  requiresDynamicArgument: boolean
  /** Callee match start (kept for evidence text). */
  callStart: number
  /** End of the balanced call / chained call (exclusive; equals callStart when no call). */
  callEnd: number
  /** Trimmed original-source call text, bounded by the context text limit. */
  callText: string
  /** Masked call text (callee through matching close paren). */
  callMasked: string
  /** Top-level argument expressions; empty when the match has no call argument list. */
  arguments: SinkCallArgument[]
  /** For `argument: "any"`: text after the callee through the end of the call chain. */
  trailing: SinkSpan | null
}

/** Per-call options for `matchSymbol`. */
export interface MatchSymbolOptions {
  /** Evidence text bound (default `DEFAULT_TEXT_LIMIT`). */
  textLimit?: number
  /** Matches kept per rule (default `DEFAULT_MATCHES_PER_RULE`). */
  maxMatchesPerRule?: number
}

/**
 * Context for `matchSymbol`. The identity fields are recorded on nothing in the
 * result yet — they exist so an engine/caller can pass the symbol it is matching
 * without a second API, and so the lower-level matcher stays usable in tests.
 */
export interface MatchSymbolContext extends MatchSymbolOptions {
  symbolId?: string
  file?: string
  /** One-based declaration line of the symbol, when the caller knows it. */
  symbolLine?: number
}

/** Everything the matcher found in one symbol. */
export interface MatchSymbolResult extends MaskedSource {
  /** `spec.language` (the canonical spec id that produced the matches). */
  language: string
  sources: SecuritySourceMatch[]
  sinks: SecuritySinkMatch[]
}

// ── lexical normalisation ────────────────────────────────────────────────────

interface StringSyntax {
  delimiter: string
  escape: string
  multiline: boolean
}

interface NormalisedLexical {
  lineComments: string[]
  blockComments: Array<[string, string]>
  strings: StringSyntax[]
}

/**
 * Sort token lists longest-first so a multi-character opener (`"""`, `//`)
 * always wins over its one-character prefix. A spec with an empty lexical block
 * masks nothing (and is then responsible for its own false positives).
 */
function normaliseLexical(lexical: LexicalSyntax | undefined): NormalisedLexical {
  const lineComments = [...(lexical?.lineComments ?? [])]
    .filter((token): token is string => typeof token === "string" && token.length > 0)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  const blockComments = [...(lexical?.blockComments ?? [])]
    .filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === "string" && pair[0].length > 0 && typeof pair[1] === "string" && pair[1].length > 0)
    .sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const strings = [...(lexical?.strings ?? [])]
    .filter((s) => typeof s?.delimiter === "string" && s.delimiter.length > 0)
    .map<StringSyntax>((s) => ({
      delimiter: s.delimiter,
      escape: typeof s.escape === "string" ? s.escape : "\\",
      multiline: s.multiline === true,
    }))
    .sort((a, b) => b.delimiter.length - a.delimiter.length || (a.delimiter < b.delimiter ? -1 : a.delimiter > b.delimiter ? 1 : 0))
  return { lineComments, blockComments, strings }
}

function isNewline(code: number): boolean {
  return code === 10 || code === 13
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12
}

/**
 * Mask every comment and string literal region declared by `lexical`.
 * Length-preserving; newlines are always kept so line numbers survive.
 */
export function maskSource(lexical: LexicalSyntax | undefined, sourceText: string): MaskedSource {
  const source = typeof sourceText === "string" ? sourceText : ""
  const chars = source.split("")
  const { lineComments, blockComments, strings: stringSyntax } = normaliseLexical(lexical)
  const strings: TextSpan[] = []
  const comments: TextSpan[] = []
  const length = chars.length

  if (lineComments.length === 0 && blockComments.length === 0 && stringSyntax.length === 0) {
    return { source, masked: source, strings, comments }
  }

  const blank = (from: number, to: number): void => {
    const end = Math.min(to, length)
    for (let i = from; i < end; i++) {
      if (!isNewline(chars[i]!.charCodeAt(0))) chars[i] = " "
    }
  }

  let i = 0
  while (i < length) {
    const rest = source
    // 1. Line comments: blank from the opener to (but not including) the newline.
    let advanced = false
    for (const token of lineComments) {
      if (!rest.startsWith(token, i)) continue
      let end = i
      while (end < length && !isNewline(source.charCodeAt(end))) end++
      blank(i, end)
      comments.push({ start: i, end })
      i = end
      advanced = true
      break
    }
    if (advanced) continue

    // 2. Block comments: only mask when a closer exists — an unterminated
    //    opener is treated as punctuation so a stray `/*` cannot blind the
    //    rest of the symbol.
    for (const [open, close] of blockComments) {
      if (!rest.startsWith(open, i)) continue
      const closeAt = source.indexOf(close, i + open.length)
      if (closeAt < 0) {
        i += 1
        advanced = true
        break
      }
      const end = closeAt + close.length
      blank(i, end)
      comments.push({ start: i, end })
      i = end
      advanced = true
      break
    }
    if (advanced) continue

    // 3. Strings: keep the delimiters, blank the contents. An unterminated
    //    literal is punctuation, for the same reason as above.
    for (const syntax of stringSyntax) {
      if (!rest.startsWith(syntax.delimiter, i)) continue
      const contentStart = i + syntax.delimiter.length
      let j = contentStart
      let closeAt = -1
      while (j < length) {
        if (syntax.escape.length > 0 && source.startsWith(syntax.escape, j)) {
          j += syntax.escape.length + 1
          continue
        }
        if (source.startsWith(syntax.delimiter, j)) {
          closeAt = j
          break
        }
        if (!syntax.multiline && isNewline(source.charCodeAt(j))) break
        j += 1
      }
      if (closeAt < 0) {
        i += 1
        advanced = true
        break
      }
      blank(contentStart, closeAt)
      strings.push({ start: i, end: closeAt + syntax.delimiter.length })
      i = closeAt + syntax.delimiter.length
      advanced = true
      break
    }
    if (advanced) continue

    i += 1
  }

  return { source, masked: chars.join(""), strings, comments }
}

// ── offsets and lines ────────────────────────────────────────────────────────

interface TextIndex {
  /** UTF-8 byte offset for every code-unit index, plus the end offset. */
  byteOffsets: Uint32Array
  /** Number of `\n` before every code-unit index. */
  newlinesBefore: Uint32Array
}

function buildTextIndex(source: string): TextIndex {
  const length = source.length
  const byteOffsets = new Uint32Array(length + 1)
  const newlinesBefore = new Uint32Array(length + 1)
  let bytes = 0
  let newlines = 0
  for (let i = 0; i < length; i++) {
    byteOffsets[i] = bytes
    newlinesBefore[i] = newlines
    const code = source.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < length) {
      const next = source.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        // Surrogate pair: the low half starts at the same code point.
        byteOffsets[i + 1] = bytes
        newlinesBefore[i + 1] = newlines
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
    if (code === 10) newlines += 1
  }
  byteOffsets[length] = bytes
  newlinesBefore[length] = newlines
  return { byteOffsets, newlinesBefore }
}

/** One-based line of a code-unit offset within the symbol text. */
export function lineAt(source: string, charOffset: number): number {
  let line = 1
  const end = Math.max(0, Math.min(charOffset, source.length))
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

// ── evidence text ────────────────────────────────────────────────────────────

function boundedText(source: string, start: number, end: number, limit: number): string {
  const from = Math.max(0, Math.min(start, source.length))
  const to = Math.max(from, Math.min(end, source.length))
  const raw = source.slice(from, to).trim()
  if (raw.length <= limit) return raw
  return raw.slice(0, Math.max(0, limit)) + "…"
}

function trimSpan(source: string, start: number, end: number): { start: number; end: number } {
  let from = Math.max(0, start)
  let to = Math.min(end, source.length)
  while (from < to && isWhitespaceCode(source.charCodeAt(from))) from++
  while (to > from && isWhitespaceCode(source.charCodeAt(to - 1))) to--
  return { start: from, end: to }
}

// ── regex execution ──────────────────────────────────────────────────────────

interface RawMatch {
  charStart: number
  charEnd: number
  match: RegExpExecArray
}

/**
 * Run one spec regex over the masked text. The spec's own flags are preserved
 * and `g` is forced; a zero-length match can never loop forever. Patterns that
 * are not RegExp values are ignored (a malformed spec produces no matches rather
 * than throwing inside the indexer).
 */
function runRule(pattern: RegExp, text: string, limit: number): RawMatch[] {
  const out: RawMatch[] = []
  if (!(pattern instanceof RegExp) || limit <= 0) return out
  let regex: RegExp
  try {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
    regex = new RegExp(pattern.source, flags)
  } catch {
    return out
  }
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    out.push({ charStart: match.index, charEnd: match.index + match[0].length, match })
    if (out.length >= limit) break
  }
  return out
}

/** Trim + bound a code-unit span; `null` when the trimmed span is empty. */
function spanFrom(source: string, masked: string, start: number, end: number, limit: number): SinkSpan | null {
  const trimmed = trimSpan(source, start, end)
  if (trimmed.end <= trimmed.start) return null
  return {
    charStart: trimmed.start,
    charEnd: trimmed.end,
    text: boundedText(source, trimmed.start, trimmed.end, limit),
    masked: masked.slice(trimmed.start, trimmed.end),
  }
}

// ── source matches ───────────────────────────────────────────────────────────

const CAPTURE_GROUP_INDICES = [1, 2, 3, 4, 5]

function firstCaptureText(match: RegExpExecArray): string | undefined {
  for (const index of CAPTURE_GROUP_INDICES) {
    const value = match[index]
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * The variable/receiver a source rule asked to record. A capture group wins;
 * otherwise the identifier immediately before the match's first `(` or `.` is
 * used (e.g. `req.body` records `req`), and a bare identifier match records
 * itself. Purely evidence — reachability never depends on this value.
 */
function deriveVariable(matchText: string): string | undefined {
  const beforeCall = /([A-Za-z_$][\w$]*)\s*\(/.exec(matchText)
  if (beforeCall?.[1]) return beforeCall[1]
  const beforeDot = /^([A-Za-z_$][\w$]*)\s*\./.exec(matchText.trim())
  if (beforeDot?.[1]) return beforeDot[1]
  const bare = /^[A-Za-z_$][\w$]*$/.exec(matchText.trim())
  if (bare?.[0]) return bare[0]
  return undefined
}

function makeSourceMatch(
  rule: SourceRule,
  raw: RawMatch,
  source: string,
  index: TextIndex,
  textLimit: number,
): SecuritySourceMatch {
  const matchText = source.slice(raw.charStart, raw.charEnd)
  let variable: string | undefined
  if (rule.captureVariable === true) {
    const captured = firstCaptureText(raw.match)
    variable = captured ?? deriveVariable(matchText)
  }
  const result: SecuritySourceMatch = {
    ruleId: rule.id,
    byteStart: index.byteOffsets[raw.charStart] ?? 0,
    byteEnd: index.byteOffsets[raw.charEnd] ?? 0,
    line: (index.newlinesBefore[raw.charStart] ?? 0) + 1,
    text: boundedText(source, raw.charStart, raw.charEnd, textLimit),
    charStart: raw.charStart,
    charEnd: raw.charEnd,
    sourceType: rule.sourceType,
    description: rule.description,
  }
  if (variable !== undefined) result.variable = variable
  return result
}

// ── sink call parsing ────────────────────────────────────────────────────────

/** Index of the `(` that opens the call, from the matched callee text. */
function findCallOpen(masked: string, charStart: number, charEnd: number): number {
  const inMatch = masked.indexOf("(", charStart)
  if (inMatch >= 0 && inMatch < charEnd) return inMatch
  let cursor = charEnd
  while (cursor < masked.length && isWhitespaceCode(masked.charCodeAt(cursor))) cursor++
  return masked.charCodeAt(cursor) === 40 ? cursor : -1
}

/** Index just past the `)` that balances `openAt`, or -1 when unbalanced. */
function findBalancedEnd(masked: string, openAt: number): number {
  let depth = 0
  for (let i = openAt; i < masked.length; i++) {
    const code = masked.charCodeAt(i)
    if (code === 40 || code === 91 || code === 123) depth += 1
    else if (code === 41 || code === 93 || code === 125) {
      depth -= 1
      if (depth === 0) return i + 1
      if (depth < 0) return -1
    }
  }
  return -1
}

/** Split a call's argument region on top-level commas. */
function splitArguments(masked: string, from: number, to: number): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let depth = 0
  let segmentStart = from
  for (let i = from; i < to; i++) {
    const code = masked.charCodeAt(i)
    if (code === 40 || code === 91 || code === 123) depth += 1
    else if (code === 41 || code === 93 || code === 125) depth = Math.max(0, depth - 1)
    else if (code === 44 && depth === 0) {
      spans.push({ start: segmentStart, end: i })
      segmentStart = i + 1
    }
  }
  spans.push({ start: segmentStart, end: to })
  return spans
}

/**
 * End of the current statement from an offset: the next `;`/newline at bracket
 * depth 0, capped at 400 code units. Used as the `argument: "any"` fallback for
 * sinks that are not calls (attribute writes such as `.innerHTML = userInput`).
 */
function findStatementTail(masked: string, from: number): number {
  const start = Math.max(0, Math.min(from, masked.length))
  const cap = Math.min(masked.length, start + 400)
  let depth = 0
  let i = start
  for (; i < cap; i++) {
    const code = masked.charCodeAt(i)
    if (code === 40 || code === 91 || code === 123) depth += 1
    else if (code === 41 || code === 93 || code === 125) depth = Math.max(0, depth - 1)
    else if (depth === 0 && (code === 59 || code === 10 || code === 13)) break
  }
  return i
}

/**
 * Extend from a balanced call's end through `.method(...)` / `->method(...)` /
 * `::method(...)` chain links, so `Command::new("sh").arg(input)` keeps the
 * dangerous argument inside the sink's span. Bounded (8 links) and never spans a
 * statement terminator.
 */
function findChainEnd(masked: string, callEnd: number): number {
  let cursor = callEnd
  let end = callEnd
  for (let link = 0; link < 8; link++) {
    let scan = cursor
    while (scan < masked.length && isWhitespaceCode(masked.charCodeAt(scan))) scan++
    const two = masked.slice(scan, scan + 2)
    const three = masked.slice(scan, scan + 3)
    const linkOpener = masked[scan] === "." || three === "->" || two === "::" ? (three === "->" || two === "::" ? 2 : 1) : 0
    if (linkOpener === 0) break
    let nameAt = scan + linkOpener
    while (nameAt < masked.length && /[A-Za-z0-9_$]/.test(masked[nameAt]!)) nameAt++
    if (nameAt === scan + linkOpener) break
    let openAt = nameAt
    while (openAt < masked.length && isWhitespaceCode(masked.charCodeAt(openAt))) openAt++
    if (masked.charCodeAt(openAt) !== 40) break
    const linkEnd = findBalancedEnd(masked, openAt)
    if (linkEnd < 0) break
    end = linkEnd
    cursor = linkEnd
  }
  return end
}

function makeSinkMatch(
  rule: SinkRule,
  raw: RawMatch,
  source: string,
  masked: string,
  index: TextIndex,
  textLimit: number,
): SecuritySinkMatch {
  const openAt = findCallOpen(masked, raw.charStart, raw.charEnd)
  let callEnd = raw.charEnd
  let argumentsList: SinkCallArgument[] = []
  let trailing: SinkSpan | null = null
  let callStart = raw.charStart
  if (openAt >= 0) {
    const balanced = findBalancedEnd(masked, openAt)
    if (balanced > 0) {
      callEnd = findChainEnd(masked, balanced)
      for (const segment of splitArguments(masked, openAt + 1, balanced - 1)) {
        const span = spanFrom(source, masked, segment.start, segment.end, textLimit)
        if (!span) continue
        argumentsList.push({
          index: argumentsList.length,
          charStart: span.charStart,
          charEnd: span.charEnd,
          text: span.text,
          masked: span.masked,
        })
      }
      trailing = spanFrom(source, masked, Math.max(raw.charEnd, openAt + 1), callEnd, textLimit)
      if (!trailing && rule.argument === "any") {
        trailing = spanFrom(source, masked, raw.charEnd, findStatementTail(masked, raw.charEnd), textLimit)
      }
    } else {
      callStart = raw.charStart
    }
  }
  // `argument: "any"` on a sink that is not a call (attribute writes such as
  // `.innerHTML = userInput`): inspect the rest of the statement.
  if (!trailing && rule.argument === "any") {
    trailing = spanFrom(source, masked, raw.charEnd, findStatementTail(masked, raw.charEnd), textLimit)
  }
  const callMasked = masked.slice(callStart, Math.max(callEnd, raw.charEnd))
  return {
    ruleId: rule.id,
    byteStart: index.byteOffsets[raw.charStart] ?? 0,
    byteEnd: index.byteOffsets[raw.charEnd] ?? 0,
    line: (index.newlinesBefore[raw.charStart] ?? 0) + 1,
    text: boundedText(source, raw.charStart, raw.charEnd, textLimit),
    charStart: raw.charStart,
    charEnd: raw.charEnd,
    vulnerability: rule.vulnerability,
    sinkType: rule.sinkType,
    severity: rule.severity,
    description: rule.description,
    argumentSelector: rule.argument,
    requiresDynamicArgument: rule.requiresDynamicArgument !== false,
    callStart,
    callEnd: Math.max(callEnd, raw.charEnd),
    callText: boundedText(source, callStart, Math.max(callEnd, raw.charEnd), textLimit),
    callMasked,
    arguments: argumentsList,
    trailing,
  }
}

// ── public entry point ───────────────────────────────────────────────────────

function compareMatches(a: TokenMatch, b: TokenMatch): number {
  if (a.byteStart !== b.byteStart) return a.byteStart - b.byteStart
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1
  return a.byteEnd - b.byteEnd
}

/**
 * Match one language spec against one symbol's text.
 *
 * Accepted call forms (both documented; the context form is preferred):
 *   matchSymbol(spec, sourceText, ctx)
 *   matchSymbol(spec, sourceText, symbolId, file?, symbolLine?)
 *
 * Pure and synchronous: no language is hardcoded, no I/O, and a spec with no
 * sources/sinks simply produces no matches. Sources and sinks are returned
 * sorted by (byteStart, ruleId) so downstream output is deterministic.
 */
export function matchSymbol(spec: LanguageSecuritySpec, sourceText: string, ctx?: MatchSymbolContext): MatchSymbolResult
export function matchSymbol(spec: LanguageSecuritySpec, sourceText: string, symbolId?: string, file?: string, symbolLine?: number): MatchSymbolResult
export function matchSymbol(
  spec: LanguageSecuritySpec,
  sourceText: string,
  contextOrSymbolId?: MatchSymbolContext | string,
  file?: string,
  symbolLine?: number,
): MatchSymbolResult {
  const context: MatchSymbolContext =
    typeof contextOrSymbolId === "string"
      ? { symbolId: contextOrSymbolId, file, symbolLine }
      : contextOrSymbolId ?? {}
  const textLimit = typeof context.textLimit === "number" && context.textLimit > 0 ? context.textLimit : DEFAULT_TEXT_LIMIT
  const perRule =
    typeof context.maxMatchesPerRule === "number" && context.maxMatchesPerRule > 0
      ? context.maxMatchesPerRule
      : DEFAULT_MATCHES_PER_RULE
  const maskedSource = maskSource(spec?.lexical, typeof sourceText === "string" ? sourceText : "")
  const source = maskedSource.source
  const masked = maskedSource.masked
  const index = buildTextIndex(source)

  const sources: SecuritySourceMatch[] = []
  for (const rule of spec?.sources ?? []) {
    if (!rule || typeof rule.pattern !== "function" && !(rule.pattern instanceof RegExp)) continue
    for (const raw of runRule(rule.pattern, masked, perRule)) {
      sources.push(makeSourceMatch(rule, raw, source, index, textLimit))
    }
  }
  sources.sort(compareMatches)

  const sinks: SecuritySinkMatch[] = []
  for (const rule of spec?.sinks ?? []) {
    if (!rule || !(rule.pattern instanceof RegExp)) continue
    for (const raw of runRule(rule.pattern, masked, perRule)) {
      sinks.push(makeSinkMatch(rule, raw, source, masked, index, textLimit))
    }
  }
  sinks.sort(compareMatches)

  return {
    language: typeof spec?.language === "string" ? spec.language : "",
    source,
    masked,
    strings: maskedSource.strings,
    comments: maskedSource.comments,
    sources,
    sinks,
  }
}
