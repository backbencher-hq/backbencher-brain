// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_cross_language: validates the call,
//   reads the stored cross-language rows through the owning engine module
//   (src/lsp/cross_language_hover.ts), applies the one fact budget and shapes the
//   answer.
// WHICH TOOL IT SERVES — bb_cross_language (mutability read, requiresIndex true,
//   modes: cross-language).
// WHY IT IS SHAPED THIS WAY — a name is many symbols (the index holds one symbol
//   per file/name/line), so the answer is the union over every copy, the copies are
//   named, and absence can only be declared when no copy and no direct member holds
//   a stored row. Rows on members are reported as the MEMBER's, never absorbed into
//   the owner. One budget covers own facts first, so a member's edges can never
//   crowd out the symbol's own; truncation, the pre-truncation totals and the copy
//   cap are all named fields, because a caller must be able to tell a bounded answer
//   from a complete one.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_cross_language.md;
//   validation/tools/bb_cross_language/verify-cross-language.ts (seeded-state
//   battery + 8-mutant suite, run with BB_NO_AUTO_REFRESH=1); LATENCY.json in the
//   same tree; script/m63/verify-cl1-cross-language.ts (corpus lane); and the
//   editor's hover gate script/m26/verify-cross-language-hover.ts, which shares the
//   owning module.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/cross_language_hover.ts,
//   src/mcp/tools/bb_cross_language/descriptor.ts, the curated tool page, and the
//   gate scripts above.
// CONTRACTS IT MUST NOT BREAK — declared absence, declared bounds and truncation,
//   stored rows only (never an inferred fact), one budget with own facts first, and
//   the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { storedCrossLanguageFactsByName, CROSS_LANGUAGE_DEFAULT_LIMIT, CROSS_LANGUAGE_MAX_LIMIT } from "../../../lsp/cross_language_hover"

/** The refusal for an argument the declared schema does not allow. Kept in one
 *  place so the handler and the MCP argument validator cannot describe the same
 *  rule differently. */
function refusal(message: string) {
  return textResult(`bb_cross_language: ${message}`, true)
}

export const handler: ToolHandler = async (args, { projectId }) => {
  const symbolArgument = args.symbol
  if (typeof symbolArgument !== "string" || symbolArgument.trim() === "") {
    return refusal("requires a non-empty symbol name")
  }
  const symbol = symbolArgument.trim()

  // The declared contract is a whole number in 1..1000. The MCP door enforces it
  // before the handler runs; a library caller reaches the handler directly, so the
  // same rule is enforced here rather than silently coercing ("5" → 5) or flooring
  // (2.5 → 2), which would be a second, looser contract behind the documented one.
  const limitArgument = args.limit
  const limit = limitArgument === undefined || limitArgument === null
    ? CROSS_LANGUAGE_DEFAULT_LIMIT
    : limitArgument
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > CROSS_LANGUAGE_MAX_LIMIT) {
    return refusal(`limit must be a whole number between 1 and ${CROSS_LANGUAGE_MAX_LIMIT}`)
  }

  const raw = await BrainDatabase.getRawInstance(projectId as any)
  // Existence is its own question, asked over every copy: a name the index does not
  // hold is a loud error (never an empty set), a name it holds is answered for all
  // of its copies.
  const exists = raw
    .prepare("SELECT COUNT(*) AS n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ?")
    .get(projectId, symbol) as { n: number }
  if (!exists || exists.n === 0) {
    return textResult(`bb_cross_language: symbol '${symbol}' not found — declared error, not an empty set`, true)
  }

  const result = storedCrossLanguageFactsByName(raw, projectId as string, symbol)

  // ONE budget over the union, own rows first: the facts that name the symbol itself
  // must never be crowded out by its members' edges, and a caller holding one limit
  // must be able to reason about the size of the answer.
  const totalFacts = result.facts.length + result.memberFacts.length
  const ownShown = result.facts.slice(0, limit)
  const remaining = Math.max(0, limit - ownShown.length)
  const memberShown = result.memberFacts.slice(0, remaining)
  const shownCount = ownShown.length + memberShown.length

  // Counts, each named for what it counts:
  //   factCount          facts in this answer (own + member)
  //   pairCount          DISTINCT language pairs in this answer
  //   signatureCount     distinct (pair, direction, bridge, tier) signatures in this answer
  //   ownFactCount       own facts shown
  //   memberFactCount    member facts shown
  //   memberCount        distinct members that contributed a member fact, BEFORE the limit
  //   totalCountIfKnown  facts that exist, BEFORE the limit
  const shownFacts = [...ownShown, ...memberShown]
  const pairCount = new Set(shownFacts.map((f) => f.pair)).size
  const signatureCount = new Set(shownFacts.map((f) => `${f.pair}|${f.direction}|${f.bridge}|${f.tier}`)).size

  // `language` is only meaningful when the copies agree. On an ambiguous name it is
  // null and `languages` carries the truth, rather than one copy's language chosen by
  // whichever row the database returned first.
  const language = result.languages.length === 1 ? result.languages[0]! : null

  // Absence is a property of the STORE, not of the emitted facts: it is declared only
  // when neither the copies nor their direct members hold a stored cross-language row.
  // A row that exists but cannot name a language pair is therefore NOT absence — it is
  // counted in unpairableRowCount and named in the note below. The previous rule keyed
  // absence off the number of emitted facts, so a store holding exactly one unnameable
  // row answered "no stored cross-language rows anywhere in this project" while
  // storedRowCount said 1 in the same answer.
  const declaredAbsent = result.storedRowCount === 0

  return textResult(JSON.stringify({
    symbol,
    language,
    languages: result.languages,
    copies: result.copies,
    copyCount: result.copyCount,
    copiesTruncated: result.copiesTruncated,
    copiesCap: result.copiesCap,
    copiesNote: result.copiesTruncated
      ? `copies is the first ${result.copies.length} of ${result.copyCount} indexed symbols named '${symbol}' (cap ${result.copiesCap}); the EDGES are unaffected, because every copy holding a cross-language row is reported in facts regardless of where it sits in that list`
      : null,
    ambiguous: result.ambiguous,
    ambiguityNote: result.ambiguous
      ? `${result.copyCount} indexed symbols are named '${symbol}' across ${new Set(result.copies.map((c) => c.file)).size} file(s); the facts below are the union over all of them, and every fact names the copy it came from`
      : null,
    // Rows on the copies themselves.
    facts: ownShown,
    ownFactCount: ownShown.length,
    ownFactsTruncated: result.facts.length > ownShown.length,
    // Rows on the MEMBERS of the copies. A member fact's `self` is the member the
    // stored row names, `owner` is the copy of the asked name it was attributed
    // through, and `pair` is exactly `self.language → other.language`. These are the
    // MEMBER's edges, never the owner's, which is why they are a separate section.
    memberFacts: memberShown,
    memberFactCount: memberShown.length,
    memberFactsTruncated: result.memberFacts.length > memberShown.length,
    memberCount: result.memberCount,
    memberNote: result.memberCount > 0
      ? `${result.memberCount} member symbol(s) of '${symbol}' hold cross-language rows of their own. They are reported under memberFacts, marked match "owner-cascade" with matchedMember naming the member and owner naming the copy it was attributed through — they are the MEMBER's edges, not '${symbol}'s. bb_graph's cascaded count for the same symbol is larger, because its cascade is a lexical id-prefix range rather than the store's owner_symbol_id; both are declared rather than reconciled.`
      : null,
    factCount: shownCount,
    pairCount,
    signatureCount,
    storedRowCount: result.storedRowCount,
    unpairableRowCount: result.unpairableRowCount,
    collapsedRowCount: result.collapsedRowCount,
    limit,
    truncated: totalFacts > shownCount,
    truncationReason: totalFacts > shownCount
      ? `declared limit of ${limit} facts; ${totalFacts} facts exist for this name (${result.facts.length} on the symbol itself, ${result.memberFacts.length} on its members)`
      : null,
    totalCountIfKnown: totalFacts,
    declaredAbsent,
    deeperDescendantRowCount: result.deeperDescendantRowCount,
    deeperDescendantNote: result.deeperDescendantRowCount > 0
      ? `${result.deeperDescendantRowCount} stored cross-language row(s) sit on descendants of '${symbol}' at depth 2 or deeper (either direction). They are NOT cascaded into the facts above — they are the descendants' edges, not '${symbol}'s — and bb_graph reports none of them either, so both doors are silent about them. Ask about the member directly to see them.`
      : null,
    // No stored row on the copies or their direct members: absence for this project.
    absenceNote: declaredAbsent
      ? (result.deeperDescendantRowCount > 0
          ? `no stored cross-language rows anywhere in THIS PROJECT's index for '${symbol}' or for any of its DIRECT members — but ${result.deeperDescendantRowCount} row(s) sit on descendants at depth 2 or deeper (deeperDescendantRowCount), which are the descendants' edges and are deliberately not cascaded. Absence at this level declared, never guessed; this is not the same as the symbol being unconnected.`
          : `no stored cross-language rows anywhere in THIS PROJECT's index for '${symbol}', for any of its members, or on any deeper descendant — absence declared, never guessed`)
      : null,
    // A stored row exists but none of them can name a language pair. This is not
    // absence and it is not a fact: it is the counted reason the answer is empty.
    pairlessRowNote: !declaredAbsent && shownCount === 0
      ? `${result.storedRowCount} stored cross-language row(s) matched this name but ${result.unpairableRowCount} of them cannot name a language pair (an endpoint file with no detected language, or two endpoint languages that are equal), so there is no fact to report. The rows exist; see unpairableRowCount.`
      : null,
    // The symbol is silent and its members are not. A caller reading only
    // declaredAbsent would otherwise assume the symbol itself is the connected one.
    silentItselfButNotItsMembers: ownShown.length === 0 && memberShown.length > 0,
  }, null, 2))
}
