// src/lsp/hover_cache.ts — the ONE parse cache the LSP read surfaces share,
// and the ONE owner of the targeted identifier lookup that replaced the
// full-file occurrence extraction.
//
// ===========================================================================
// WHAT THIS FILE IS FOR (the measured defect it closes)
// ===========================================================================
//
// Contract §3 sets hover at warm p95 <= 50 ms. Measured on this machine at
// HEAD before this file existed (nearest-rank, load average recorded beside
// every number, corpus = this repository's own real sources indexed by the real
// indexer — see validation/m24/results/L6.json):
//
//   band        hover p50    hover p95
//   ---------   ---------    ---------
//   16-32 KiB      39.9 ms     55.6 ms
//   32-64 KiB      65.5 ms    110.9 ms
//   64-128 KiB     96.1 ms    144.5 ms
//   128-256 KiB   269.2 ms    436.6 ms
//   256-512 KiB   411.2 ms    588.7 ms
//   512-1024 KiB 1686.0 ms   1940.8 ms
//   1312 KiB     2444.1 ms   2997.6 ms
//
// Every band was over budget, including the smallest one this repository has.
// The cost was not "the parse" alone. Splitting one band (225 KiB, p50):
//
//   ASTEngine.parseTree (parser.parse)      70.8 ms
//   collectMaskedRanges + mask build         1.3 ms
//   extractIdentifierOccurrences           134.1 ms
//   collectBodyRanges                       45.2 ms
//   -----------------------------------------------
//   parseForSafety total                   299.3 ms
//
// So 63% of the cost was the THREE FULL-TREE WALKS that `parseForSafety`
// performs, and hover used ONE NUMBER out of all of them: the identifier
// occurrence under the cursor. hover.ts called `parseForSafety` and then ran
// `safety.occurrences.find(o => o.startLine === line && ...)`. That is a
// linear scan over every identifier in the file to find the one at a point the
// caller already knows.
//
// ===========================================================================
// THE TWO MACHINES HERE, and why each is here
// ===========================================================================

/**
 * MACHINE 1 — `occurrenceAtPoint`: the targeted lookup.
 *
 * `tree.rootNode.descendantForPosition(point)` finds the smallest named node
 * spanning the point (measured p50 0.013-0.044 ms across every band, versus
 * 134 ms for the whole-file walk). Walking UP from there to the first node that
 * satisfies exactly the predicate `extractIdentifierOccurrences` applies is what
 * makes this a REPLACEMENT rather than an approximation.
 *
 * EQUIVALENCE, MEASURED, NOT ASSERTED: over 10,027 probe positions on 8 real
 * files in this repository (every 3rd line, every 37th column — dense enough to
 * land on whitespace, comments, string interiors, operators and declaration
 * names alike), the targeted lookup and the full-extraction `.find()` agreed on
 * 10,027 of 10,027, with 0 disagreements in either direction. That probe is
 * re-run by script/m24/verify-hover-latency.ts on every execution; the number
 * above is the RED measurement, the gate is the standing check.
 *
 * WHY THE PREDICATE IS COPIED RATHER THAN CALLED. The predicate is four
 * clauses: not a comment, isNamed, `isIdentifierNodeType`, zero named children.
 * The first three are exported from src/ast/safety-primitives.ts and are
 * CALLED here, so there is one owner of "what counts as an identifier". The
 * fourth (`namedChildCount !== 0`) is read off the node directly, because
 * `extractIdentifierOccurrences` reads it off the node too — there is no shared
 * predicate function to call. That is stated rather than hidden: if
 * src/ast/safety-primitives.ts changes that clause, this module must change with
 * it, and the gate's differential leg is what notices.
 */

/**
 * MACHINE 2 — the bounded, content-addressed parse cache.
 *
 * The second cost is `parser.parse` itself: 9-71 ms p50 across the bands, which
 * no lookup can remove, because a hover needs a tree.
 *
 * WHAT IS CACHED AND WHY IT IS HONEST. The cache is keyed on the SHA-256 of the
 * CONTENT BYTES, not on mtime, not on size, not on path. Consequences, each of
 * which is the reason the weaker key was rejected:
 *
 *   - A changed file cannot serve a stale answer. Change one byte and the hash
 *     changes, the lookup misses, and the file is re-parsed. An mtime+size key
 *     cannot make that promise: a same-size rewrite inside one filesystem
 *     timestamp tick keeps both.
 *   - Two paths with identical content share one parse. Harmless (a tree does
 *     not know its path) and occasionally a win.
 *   - The hash is CHEAP next to the parse it replaces: measured p50 0.15 ms at
 *     17 KiB, 1.84 ms at 225 KiB, against parse p50s of 9.3 ms and 70.8 ms.
 *
 * WHAT THE CACHE IS NOT. It is not a claim that the file is fresh — that is the
 * freshness module's job and hover already carries its marker. It is not a
 * cross-request answer cache: it stores a TREE, and the query still runs per
 * request. §4 is honoured by the marker below, not by the cache's existence.
 *
 * THE BOUND, AND WHY IT IS A BOUND AND NOT A HOPE. Retaining trees costs WASM
 * memory that JS cannot reclaim; the only release is `tree.delete()`. So the
 * cache is LRU-bounded by COUNT and by BYTES, and eviction deletes the tree it
 * drops. Measured RSS delta while one 225 KiB tree was retained across 12
 * interleaved parses: 0.6 MiB. The byte ceiling is declared below and reported
 * in the cache stats, so a reader can see what the bound is rather than trusting
 * it.
 *
 * TREE REUSE SAFETY, MEASURED: a retained tree's answers were compared against a
 * fresh parse of the same bytes at 5,190 probe positions after 200 interleaved
 * parses of other files through the same shared parser — 5,190/5,190 identical,
 * and 5,190/5,190 identical to a fresh parse. `ASTEngine.getParser` hands out a
 * CACHED parser per language, so this is the shared-parser case, not a
 * private-parser case. script/m24/verify-hover-latency.ts re-measures it.
 *
 * LUA IS EXCLUDED, WITH THE REASON. `ASTEngine.parseRaw` gives Lua a PRIVATE
 * parser and grammar per parse, because "one file's external-scanner state" must
 * not reach the next file (engine.ts:1440-1443). Retaining a Lua tree across
 * requests would hand the next request a tree produced by a scanner that has
 * already run. So Lua parses are NOT cached. Declared here rather than left to
 * be discovered as a wrong answer.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ASTEngine } from "../ast/engine"
import { isCommentNodeType, isIdentifierNodeType } from "../ast/safety-primitives"
import { hashFileContent } from "../brain/freshness"
// The MARKUP owner: a doc comment is rendered with its comment markers stripped, and doc_comment.ts owns
// that transformation. Calling it here (instead of copying a strip rule) is what makes this machine's
// output the OWNER's output rather than a second opinion about it.
import { stripCommentMarkup } from "./doc_comment"

/**
 * The one identifier occurrence the LSP surfaces need from a tree.
 *
 * Deliberately NARROWER than safety-primitives' `IdentifierOccurrence`: it
 * carries only the fields hover.ts and document_highlight.ts read. The full
 * occurrence type carries `isMemberName` and `parentField`, which neither
 * surface consults; computing them is part of why the full extraction costs
 * 134 ms, and inventing a value for them here would be a fabricated fact
 * (contract §11.7). A surface that needs them must call the full extraction.
 */
export interface PointOccurrence {
  /** The exact source text of this occurrence (unchanged bytes). */
  text: string
  /** 1-indexed line (the index's line convention). */
  startLine: number
  /** 1-indexed BYTE column within the line (the index's column convention). */
  startColumn: number
  /** 1-indexed BYTE column one past the last byte (tree-sitter's exclusive end, +1). */
  endColumn: number
}

/** Where a cached tree came from. Rides the wire so a reader can tell. */
export type ParseSource = "fresh" | "cache-hit" | "cache-bypass"

/** What `parseForCursor` resolved, including the honesty fields §4 requires. */
export interface CursorParse {
  /** The tree. The caller MUST NOT delete it — the cache owns it. */
  tree: any
  /** The language the engine detected, verbatim. */
  language: string
  /** Whether this parse was served from the cache or performed now. */
  source: ParseSource
  /**
   * The SHA-256 of the exact bytes the returned tree was built from. A reader
   * that wants to know whether the answer describes THESE bytes reads this.
   */
  contentHash: string
  /** Bytes of content parsed. */
  bytes: number
  /** The machine's cache state at the moment of this call (for the wire/UI). */
  cache: CacheStats
}

/** The cache's declared bounds and its current occupancy, machine-readable. */
export interface CacheStats {
  /** trees currently retained */
  entries: number
  /** source bytes currently retained */
  retainedBytes: number
  /** the declared byte ceiling */
  byteCeiling: number
  /** the declared entry ceiling */
  entryCeiling: number
  /** parse calls served from the cache */
  hits: number
  /** parse calls performed because of a miss */
  misses: number
  /** calls that bypassed the cache entirely (lua) */
  bypasses: number
  /** trees deleted on eviction, by the byte bound */
  evictionsBytes: number
  /** trees deleted on eviction, by the entry bound */
  evictionsEntries: number
  /** languages the cache refuses to retain, with the reason */
  excludedLanguages: Record<string, string>
}

/**
 * The declared bounds. Chosen from measurement, stated so a reader can judge:
 * one 1312 KiB file is ~1.4 MiB of source, so this ceiling retains roughly the
 * three largest files a user has open, or ~70 of the small ones.
 *
 * These are DECLARED numbers with a measured basis (the RSS figure above), not
 * an optimization target. A reader who disagrees with the ceiling can change the
 * constant; what they cannot do is change it without this comment moving, because
 * the value is reported in every `cache` block the surfaces emit.
 */
export const CACHE_BYTE_CEILING = 4 * 1024 * 1024
export const CACHE_ENTRY_CEILING = 8

/**
 * Languages the cache does NOT retain, each with the reason (a bare list would
 * be a rule nobody can audit — the m31 lesson about duplicated vocabularies).
 *
 * lua: ASTEngine.parseRaw builds a private parser + grammar per parse so one
 * file's external-scanner state cannot reach the next. A retained Lua tree
 * carries that scanner's state into the next request. Declared exclusion, not a
 * discovered bug.
 */
const EXCLUDED_LANGUAGES: Record<string, string> = {
  lua: "ASTEngine.parseRaw gives lua a private parser and grammar per parse so external-scanner state cannot leak between files (engine.ts parseRaw); a retained lua tree would carry that state into the next request",
}

interface CacheEntry {
  hash: string
  language: string
  bytes: number
  tree: any
  /** monotonic tick for LRU ordering; bumped on every hit */
  lastUsed: number
}

const entries = new Map<string, CacheEntry>()
let retainedBytes = 0
let tick = 0
let hits = 0
let misses = 0
let bypasses = 0
let evictionsBytes = 0
let evictionsEntries = 0

/** The machine-readable cache state every caller can publish verbatim. */
export function cacheStats(): CacheStats {
  return {
    entries: entries.size,
    retainedBytes,
    byteCeiling: CACHE_BYTE_CEILING,
    entryCeiling: CACHE_ENTRY_CEILING,
    hits,
    misses,
    bypasses,
    evictionsBytes,
    evictionsEntries,
    excludedLanguages: { ...EXCLUDED_LANGUAGES },
  }
}

/** Drop every retained tree and release its memory. Used by tests and by a server shutdown. */
export function clearParseCache(): void {
  for (const e of entries.values()) {
    try {
      if (e.tree && typeof e.tree.delete === "function") e.tree.delete()
    } catch {}
  }
  entries.clear()
  retainedBytes = 0
}

/** Drop the tree for one content hash, if retained. */
export function invalidateContentHash(hash: string): boolean {
  const e = entries.get(hash)
  if (e === undefined) return false
  try {
    if (e.tree && typeof e.tree.delete === "function") e.tree.delete()
  } catch {}
  entries.delete(hash)
  retainedBytes -= e.bytes
  if (retainedBytes < 0) retainedBytes = 0
  return true
}

/** Delete the least-recently-used trees until BOTH bounds hold. */
function evict(): void {
  while (entries.size > CACHE_ENTRY_CEILING || retainedBytes > CACHE_BYTE_CEILING) {
    let oldestKey: string | null = null
    let oldest = Number.POSITIVE_INFINITY
    for (const [k, v] of entries) {
      if (v.lastUsed < oldest) {
        oldest = v.lastUsed
        oldestKey = k
      }
    }
    if (oldestKey === null) break
    const dropped = entries.get(oldestKey)!
    try {
      if (dropped.tree && typeof dropped.tree.delete === "function") dropped.tree.delete()
    } catch {}
    entries.delete(oldestKey)
    retainedBytes -= dropped.bytes
    if (retainedBytes < 0) retainedBytes = 0
    // WHICH bound fired is recorded, so a reader can see which ceiling is
    // actually doing the evicting instead of guessing.
    if (entries.size > CACHE_ENTRY_CEILING) evictionsEntries++
    else evictionsBytes++
  }
}

/**
 * Parse `content` and return a tree for a cursor lookup, reusing a retained tree
 * when the bytes are byte-identical to a parse already performed.
 *
 * The returned tree is CACHE-OWNED: the caller must not delete it, and must not
 * hold it across requests (it can be evicted, which deletes it). Every use inside
 * this module and its callers is synchronous and immediate, which is what makes
 * that contract satisfiable; the alternative — handing out a tree that can be
 * freed under the caller — is a use-after-free in WASM memory.
 */
export async function parseForCursor(filePath: string, content: string): Promise<CursorParse> {
  const contentHash = hashFileContent(content)
  const bytes = Buffer.byteLength(content, "utf8")
  const detected = languageFor(filePath, content)
  if (detected !== null && EXCLUDED_LANGUAGES[detected] !== undefined) {
    bypasses++
    return guardedParse(filePath, content, contentHash, bytes, "cache-bypass")
  }
  const entry = entries.get(contentHash)
  if (entry !== undefined) {
    hits++
    tick++
    entry.lastUsed = tick
    return { tree: entry.tree, language: entry.language, source: "cache-hit", contentHash, bytes, cache: cacheStats() }
  }
  misses++
  return guardedParse(filePath, content, contentHash, bytes, "fresh")
}

/**
 * The ONE place a parse actually happens, and the ONE place it is guarded.
 *
 * M24.L6, found by its own gate. script/m42/verify-highlight.ts's R7 scan was
 * extended from one hardcoded function name to the declared set of parse entry
 * points (M42's file, reached through hover.ts's import), and the widened scan
 * immediately reported this module's `ASTEngine.parseTree` call as UNGUARDED —
 * correctly. `parseForSafety` threw for an unroutable file and every caller
 * caught it; that arrangement put the guard at each CALL SITE, which is the
 * M42 defect class (`a0ed9eade`: documentHighlight called the unguarded form and
 * the throw reached the editor as -32603) waiting for the next caller who
 * forgets.
 *
 * The guard belongs at the thrower. `parseRaw` throws `Unsupported file type`
 * for a file the router cannot claim, and a grammar that fails to load throws
 * too; both are facts about the FILE, not about the caller, so both are
 * declared HERE, once, as a `ParseUnavailable` carrying the reason. A caller that
 * wants a different outcome can catch a named error class rather than guessing
 * at string matching, and a caller that forgets cannot turn a routable-file
 * question into a wire error.
 *
 * The error is NOT swallowed: it is converted into a named, inspectable failure.
 * §11.7 asks for DECLARED ABSENCE, and a declared absence has to be visible to
 * the surface that renders it — `hover()` turns it into
 * `reason: "parse-failed"` and `documentHighlight` into tier
 * `unsupported_language`, which is exactly what they did when they caught the
 * raw throw. The behaviour is unchanged; the guard has moved to where it
 * cannot be forgotten.
 */
export class ParseUnavailable extends Error {
  /** Why the file could not be parsed, verbatim from the engine. */
  readonly reason: string
  constructor(reason: string) {
    super(`the file could not be parsed: ${reason}`)
    this.name = "ParseUnavailable"
    this.reason = reason
  }
}

async function guardedParse(
  filePath: string,
  content: string,
  contentHash: string,
  bytes: number,
  source: Exclude<ParseSource, "cache-hit">,
): Promise<CursorParse> {
  let parsed: Awaited<ReturnType<typeof ASTEngine.parseTree>>
  try {
    parsed = await ASTEngine.parseTree(filePath, content)
  } catch (error) {
    // Re-thrown as a NAMED failure, not converted to a success. A cache hit must
    // never be manufactured for a file that cannot be parsed: `contentHash`
    // would then key a retained tree that does not exist.
    throw new ParseUnavailable(error instanceof Error ? error.message : String(error))
  }
  const { language, tree } = parsed
  if (source === "fresh") {
    entries.set(contentHash, { hash: contentHash, language, bytes, tree, lastUsed: ++tick })
    retainedBytes += bytes
    evict()
  }
  return { tree, language, source, contentHash, bytes, cache: cacheStats() }
}

/**
 * The engine's own language detection, read through the ONE entry point that
 * exposes it without parsing. `ASTEngine.parseTree` detects internally and
 * returns it, but by then the parse has already happened — too late to consult a
 * per-language cache policy. So the policy is consulted on a best-effort basis
 * here: an unknown language is CACHED (the safe default, since an unknown
 * language is far more likely to be one of the 20+ cached ones than lua), and
 * only an EXPLICITLY excluded language bypasses.
 *
 * Declared as a limitation rather than presented as detection parity: this is not
 * `detectLanguage`, and a file whose language differs from what this shape
 * infers would be cached when the engine would have excluded it. `parseTree`
 * still returns the engine's real `language`, and the surfaces key their
 * behaviour off THAT, never off this.
 */
function languageFor(filePath: string, content: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  if (ext === ".lua") return "lua"
  // Shebang is lua's other entry point; nothing else in the shipped set uses it.
  if (content.startsWith("#!")) return "lua"
  return null
}

// ---------------------------------------------------------------------------
// Machine 1: the targeted lookup
// ---------------------------------------------------------------------------

/**
 * The identifier occurrence AT a 1-based (line, byte column) point, or null
 * when the point is not on a reference site (whitespace, a comment interior, a
 * string interior, punctuation, or an operator).
 *
 * `point` is in the INDEX convention (1-based line, 1-based byte column) — the
 * same convention `occurrenceAtLspPosition`'s caller already holds. The
 * conversion to tree-sitter's 0-based point happens HERE, inside this module,
 * and nowhere else: §5.1 gives positions.ts sole ownership of index<->LSP
 * conversion, and tree-sitter's own point type is neither of those two formats,
 * so adapting it is this module's declared seam. The subtraction below is the
 * adaptation, and it is gated by the differential leg below rather than left to
 * inspection.
 */
export function occurrenceAtPoint(tree: any, line: number, byteColumn: number): PointOccurrence | null {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(byteColumn) || byteColumn < 1) return null
  let node = tree.rootNode.descendantForPosition({ row: line - 1, column: byteColumn - 1 })
  while (node !== null && node !== undefined) {
    const type = node.type
    // The predicate `extractIdentifierOccurrences` applies, clause for clause.
    // isCommentNodeType/isIdentifierNodeType are CALLED (single owner);
    // `isNamed` and `namedChildCount !== 0` are read off the node exactly as
    // that function reads them. See the header for why the fourth clause cannot
    // be a call.
    if (!isCommentNodeType(type) && node.isNamed && isIdentifierNodeType(type) && node.namedChildCount === 0) {
      const text = String(node.text ?? "")
      if (text.length > 0) {
        return {
          text,
          startLine: node.startPosition.row + 1,
          startColumn: node.startPosition.column + 1,
          endColumn: node.endPosition.column + 1,
        }
      }
    }
    node = node.parent
  }
  return null
}

/**
 * MACHINE 3 — `docCommentAt`: the doc comment immediately above a declaration, read from the SAME
 * cached tree instead of a whole-file comment walk.
 *
 * THE RULE IS THE OWNER'S, NOT A SECOND COPY OF IT: `docCommentFor` (src/lsp/doc_comment.ts) accepts a
 * comment whose `endLine === declarationLine - 1` — i.e. a comment ending on the line directly above the
 * declaration, with no blank line between. `extractCommentSites` walks the WHOLE tree to build the list that
 * rule then scans; that walk is one of the three `parseForSafety` performed per hover (45.2 ms p50 at
 * 225 KiB), and hover used one number out of it. This function asks the tree at the single point that can
 * satisfy the rule — the end of line `declarationLine - 1` — walks up from there, and returns the comment's
 * text only when it is a comment ending exactly on that line. Same rule, same text, one point.
 *
 * The equivalence claim is checked, not asserted: `script/m24/verify-hover-latency.ts` compares this
 * function against `docCommentFor(extractCommentSites(tree), line)` for EVERY line of real files and
 * fails on any disagreement.
 */
export function docCommentAt(tree: any, declarationLine: number | null | undefined): string {
  if (!tree || declarationLine === null || declarationLine === undefined) return ""
  const targetRow = declarationLine - 2 // 0-based row the comment must END on
  if (targetRow < 0) return ""
  // The owner's predicate is `endLine === declarationLine - 1` over the comment sites `extractCommentSites`
  // collects in LEFT-TO-RIGHT preorder. This search walks the same order but PRUNES any subtree that does not
  // overlap the target row, so the cost is the nodes on one line plus a range check per top-level node —
  // not the whole-file walk. The first match in that order is the same site `docCommentFor` would return.
  let found: string | null = null
  const visit = (n: any): void => {
    if (found !== null || n === null || n === undefined) return
    const startRow = Number(n.startPosition?.row ?? 0)
    const endRow = Number(n.endPosition?.row ?? 0)
    if (startRow > targetRow || endRow < targetRow) return
    if (isCommentNodeType(String(n.type))) {
      if (endRow === targetRow) found = stripCommentMarkup(String(n.text ?? ""))
      return
    }
    const kids = n.children ?? []
    for (let i = 0; i < kids.length; i++) visit(kids[i])
  }
  visit(tree.rootNode)
  return found ?? ""
}

/**
 * The whole-file occurrence extraction, for the surface that genuinely needs
 * every occurrence in the file (document highlight highlights all of them, so a
 * point lookup cannot serve it).
 *
 * It delegates to the tree the cache already produced, which is the reason the
 * cache helps this surface too: the parse is shared, only the walk is
 * per-request. The walk is NOT cached — caching a per-file array would grow
 * without bound in a shape the byte ceiling cannot see.
 */
export function allOccurrences(tree: any, content: string): Array<{ text: string; startLine: number; startColumn: number; endLine: number; endColumn: number }> {
  const out: Array<{ text: string; startLine: number; startColumn: number; endLine: number; endColumn: number }> = []
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    const type = n.type
    if (!isCommentNodeType(type) && n.isNamed && isIdentifierNodeType(type) && n.namedChildCount === 0) {
      const text = String(n.text ?? "")
      if (text.length > 0) {
        out.push({
          text,
          startLine: n.startPosition.row + 1,
          startColumn: n.startPosition.column + 1,
          endLine: n.endPosition.row + 1,
          endColumn: n.endPosition.column + 1,
        })
      }
    }
    const children = n.children ?? []
    for (let i = children.length - 1; i >= 0; i--) if (children[i]) stack.push(children[i])
  }
  void content
  return out
}