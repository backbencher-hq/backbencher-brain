// src/lsp/cross_language_hover.ts — M26.W3: cross-language hover facts
// (issue #511).
//
// The IntelliJ-killer claim is also the easiest place to overclaim. This
// component is the SINGLE owner of cross-language hover facts:
//
//   source:      stored brain_relationship rows ONLY (is_cross_language = 1),
//                per-pair, with the stored bridge mechanism. Nothing here
//                infers, guesses, or aspires: a pair with no stored rows
//                yields NOTHING — absence is declared in docs (docs/m26/
//                CROSS-LANGUAGE.md, generated), never faked in the UI.
//   rendering:   `crossLanguageSection()` produces hover text ONLY when a
//                stored fact exists; the hover renders the section only when
//                the section is non-empty. A pair with no rows renders no
//                cross-language text at all.
//   tier rule:   the SINGLE owner's rule — src/lsp/evidence_tier.ts
//                (M55.T5: stored metadata.evidenceClass wins, else the
//                declared derivation: structural set at >= 0.7 → structural,
//                imports → import_based, references/uses → usage_contextual,
//                references_qualified → reference_qualified, else inferred).
//                Confidence is rendered with the tier. This file no longer
//                carries a second copy of the rule.
//   direction:   callers (edges INTO the symbol from another language) and
//                callees (edges OUT to another language) are separate
//                declared facts; both carry the opposite file's language.
//
// Declared guarantees (gated by script/m26/verify-cross-language-hover.ts):
//   G1 source:     every rendered fact traces to a stored row (is_cross_language = 1)
//   G2 absence:    no stored rows for a pair → empty section, no UI text
//   G3 per-pair:   facts are grouped per (source language, target language) pair
//   G4 mutation:   a fabricated cross-language edge in the UI fails the suite
//
// Run: imported by src/lsp/hover.ts (W3 wiring)

import { classifyTier, type EvidenceTier } from "./evidence_tier"

export interface CrossLanguageEdgeRow {
  relationship_type: string
  confidence: number | null
  bridge_mechanism: string | null
  /** language of the opposite side of the edge */
  other_language: string | null
  /** direction of the edge relative to the hovered symbol */
  direction: "caller" | "callee"
  /** stored evidence class (metadata.evidenceClass), when the indexer wrote one */
  evidence_class: string | null
}

/** The tier vocabulary a cross-language fact can carry. Kept as a named
 *  alias because the W2/W3 surface types read `EdgeTier`; the vocabulary
 *  itself is owned by src/lsp/evidence_tier.ts (M55.T5). */
export type EdgeTier = EvidenceTier

/** Tier for a cross-language edge.
 *
 *  M55.T5: this is a DELEGATION, not a second rule. Before T5 this function
 *  carried its own copy of the W4 rule while src/lsp/hover.ts carried the
 *  legacy variant, so the SAME stored `imports` row rendered `import_based`
 *  in the cross-language section and `indexed` in the hover's evidence list.
 *  One classifier now answers for every server surface
 *  (src/lsp/evidence_tier.ts — classifyTier). */
export function tierForCrossLanguageEdge(edge: {
  relationship_type: string
  confidence: number | null
  evidence_class: string | null
}): EdgeTier {
  return classifyTier({
    relationshipType: edge.relationship_type,
    confidence: edge.confidence,
    evidenceClass: edge.evidence_class,
  })
}

export interface CrossLanguageFact {
  pair: string            // "typescript → kotlin" (hover language first)
  direction: "caller" | "callee"
  bridge: string          // stored bridge mechanism, never invented
  tier: EdgeTier
  confidence: number
  relationshipType: string
}

/** Build per-pair facts from stored rows only. Rows without an opposite
 *  language cannot name a pair and are honestly skipped (declared limitation
 *  surfaced by the pair-coverage generator, never filled by a guess). */
export function factsFromRows(rows: CrossLanguageEdgeRow[], hoverLanguage: string | null): CrossLanguageFact[] {
  if (hoverLanguage === null) return []
  const facts: CrossLanguageFact[] = []
  for (const row of rows) {
    if (!row.other_language) continue
    facts.push({
      pair: `${hoverLanguage} → ${row.other_language}`,
      direction: row.direction,
      bridge: row.bridge_mechanism ?? "unnamed bridge (stored row carries no mechanism)",
      tier: tierForCrossLanguageEdge(row),
      confidence: row.confidence ?? 0,
      relationshipType: row.relationship_type,
    })
  }
  return facts
}

/** The hover text section. EMPTY when there are no stored facts — the hover
 *  renders the section only when this returns a non-empty string. */
export function crossLanguageSection(facts: CrossLanguageFact[]): string {
  if (facts.length === 0) return ""
  const lines = ["**cross-language** (from stored index rows only):"]
  for (const f of facts) {
    const dir = f.direction === "caller" ? "called from" : "calls into"
    lines.push(`- ${dir} ${f.pair.split(" → ")[1]} via ${f.bridge} — ${f.tier} (confidence ${f.confidence})`)
  }
  return lines.join("\n")
}

/** Minimal db surface (structural, stubbable). */
export interface CrossLanguageDb {
  // `get` was missing until M63.CL5 needed two scalar queries (the true copy count
  // and the depth>=2 descendant count). The driver has always provided it — see
  // src/storage/db.node.ts, which returns { get, all, run } — so the interface was
  // narrower than the thing it describes. Widening it here rather than casting to
  // `any` at the two call sites, which would have left it still lying.
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown }
}

// ---------------------------------------------------------------------------
// M63.CL1 — the AGENT door's projection of the same facts.
//
// `storedCrossLanguageRows` + `factsFromRows` above are the HOVER's projection:
// one exact symbol id (the editor knows the file and the position), collapsed to
// a language pair and a bridge, because a human reading one card already knows
// which file they are in. That projection is correct for its surface and was
// copied wholesale into the MCP tool (M28.T1), where it loses the only field
// that makes the tool answerable. Measured on the real jvm-interop corpus
// (validation/m63/results/CL1.json):
//
//   asked about `stream-to-bytes`; the stored edge goes to `toByteArray` in
//   `src/jvm/clojure/asm/ClassWriter.java`; the fact said
//   `{pair, direction, bridge, tier, confidence, relationshipType}` and named
//   none of them. `bb_graph`, in the same registry, returns from/to as
//   {id, name, symbolType, file, line} plus a rowId. The standard exists in
//   this codebase; this projection did not meet it.
//
// Three defects the hover projection cannot express, all measured, all fixed
// here — this module stays the SINGLE owner and the tool keeps calling into it:
//
//   A. NO IDENTITY. Each fact now carries both ends: the copy of the requested
//      name it came from, and the counterparty (name, file, language, line),
//      plus the stored row id — the same traceability `bb_graph` provides.
//   B. NAME AMBIGUITY. The hover has an exact id; an agent has a NAME. The
//      index holds one symbol per (file, name, line), so a name is many
//      symbols: `invoke` is 227 symbols in the jvm-interop corpus. The old
//      door picked one with a bare `.get()` and reported its rows as THE
//      answer — and when the copy it happened to pick held none, it declared
//      `declaredAbsent: true` while the index held 21 such rows for the name.
//      A false absence is the worst thing this tool can say. `byName` unions
//      every copy, names the ambiguity, and can never declare absence while
//      any copy holds a stored row.
//   C. NO BOUND. The hover renders a card; an agent reads JSON. 106 stored
//      rows for one symbol became 106 identical facts and 20,904 bytes. Now
//      bounded by a declared `limit`, deduplicated by row id, and carrying
//      first-class `truncated` / `totalCountIfKnown` exactly as bb_impact does.
//
// The laws are unchanged and are now measurable rather than assumed:
//   - source:      stored `brain_relationship` rows with is_cross_language = 1
//   - absence:     declared only when NO copy of the name holds a stored row
//   - project:     every row is filtered by `r.project_id = ?` (see LEAK below)
//   - per-pair:    facts are grouped per (source language, target language)
//   - tier:        src/lsp/evidence_tier.ts, unchanged
//
// LEAK (cross-project, measured): the hover door filters on the JOIN
// (`ss.project_id = r.project_id`) and takes the symbol id as its only key, so
// it never constrains `r.project_id`. That is sound for it — a hover symbol id
// is project-scoped and names one row's world — but it is NOT sound for a
// name, which is why `byName` takes the project id as a required argument and
// filters the row itself. Symbol ids minted by
// src/ast/cross-language-intelligence-persister.ts (`cross_lang_*`,
// `dataflow_source_*`) are not project-prefixed, so the row filter is load
// bearing, not decorative.

/** One end of a cross-language fact. `line` is the symbol's declaration line;
 *  `null` is honest unknown, never 0. */
export interface CrossLanguageEnd {
  symbol: string | null
  file: string | null
  language: string | null
  line: number | null
}

/** One stored row, both ends named. */
export interface CrossLanguageAgentFact {
  /** the copy of the requested name this row belongs to */
  self: CrossLanguageEnd
  direction: "caller" | "callee"
  /** the other end of the edge — the identity the hover projection dropped */
  other: CrossLanguageEnd
  /** "selfLang → otherLang"; null when either language is unknown or equal
   *  (a row flagged cross-language whose ends share a language cannot name a
   *  pair — it is counted, never dressed up) */
  pair: string | null
  bridge: string
  tier: EdgeTier
  confidence: number
  relationshipType: string
  /** the stored row id — traceability, the same field bb_graph returns */
  rowId: string
  /** `exact` when the stored row names this symbol; `owner-cascade` when the
   *  row names one of its members and is reported as the MEMBER's edge, never
   *  the owner's. The same vocabulary bb_graph uses, so a reader comparing the
   *  two tools is not decoding two schemes. */
  match: CrossLanguageMatch
  /** present only for `owner-cascade`: the member the row actually named, and
   *  its stored id. This is what makes the attribution reversible AND checkable
   *  by a reader — a cascade reported only as a name is a claim; a cascade
   *  reported as a name plus the id of a symbol whose `owner_symbol_id` is one
   *  of the copies is a fact a consumer can verify without trusting the tool. It
   *  rides the cascaded facts only: an exact fact is trivially attributable
   *  (its `self` IS the copy), so an id there would be 80 bytes of payload per
   *  fact restating what `self` already says. */
  matchedMember?: CrossLanguageEnd
  matchedMemberId?: string
}

/** How a stored row was attributed to the asked name. */
export type CrossLanguageMatch = "exact" | "owner-cascade"

/** One indexed symbol that carries the requested name. */
export interface CrossLanguageNameCopy {
  id: string
  symbol: string
  file: string | null
  language: string | null
  line: number | null
  /** stored cross-language rows touching THIS copy */
  crossRowCount: number
}

export interface CrossLanguageNameResult {
  copies: CrossLanguageNameCopy[]
  copyCount: number
  /** M63.CL5: true when the copy list was capped, so `copies` is a prefix of the
   *  copies that exist rather than all of them. The edges are unaffected — every
   *  copy holding a cross-language row is added by the row scan whatever the cap —
   *  but the caller is told rather than left to assume. */
  copiesTruncated: boolean
  /** The cap that was applied, so the number is a fact about the answer and not a
   *  constant the caller has to know. */
  copiesCap: number
  /** M63.CL5: cross-language rows on members-of-members and deeper. Reported, never
   *  cascaded into the owner's facts — CL2's ruling — so that the answer can say
   *  the cascade does not reach them instead of declaring an absence that reads as
   *  "this symbol is unconnected". */
  deeperDescendantRowCount: number
  /** distinct non-empty languages across the copies, sorted */
  languages: string[]
  ambiguous: boolean
  /** rows on the copies themselves */
  facts: CrossLanguageAgentFact[]
  /** rows on the MEMBERS of the copies, each marked `owner-cascade` and naming
   *  the member. Reported, never counted as the owner's own. */
  memberFacts: CrossLanguageAgentFact[]
  /** stored cross-language rows matched across every copy (own + member) */
  storedRowCount: number
  /** rows that matched but cannot name a pair (unknown/equal languages) */
  unpairableRowCount: number
  /** rows dropped because the same row id was matched from both directions */
  collapsedRowCount: number
  /** distinct members that contributed a member fact */
  memberCount: number
}

/** The declared default and ceiling for the agent door. The hover is a card
 *  and needs no bound; an agent's context does, and an unbounded answer is a
 *  defect, not a thoroughness. */
export const CROSS_LANGUAGE_DEFAULT_LIMIT = 200
export const CROSS_LANGUAGE_MAX_LIMIT = 1000

interface AgentFactRow {
  row_id: string
  relationship_type: string
  confidence: number | null
  bridge_mechanism: string | null
  metadata: string | null
  direction: "caller" | "callee"
  self_id: string
  self_name: string
  self_file: string | null
  self_language: string | null
  self_line: number | null
  other_id: string | null
  other_name: string | null
  other_file: string | null
  other_language: string | null
  other_line: number | null
}

/** A member row: the own-row columns, plus which member the row actually named.
 *  The `pair` is computed from the MEMBER's file language and the other end's,
 *  because the member is the endpoint the row names — the owner's language is
 *  usually the same file, and using the owner's would be an assumption. */
interface MemberFactRow extends AgentFactRow {
  member_id: string
  member_name: string
  member_file: string | null
  member_language: string | null
  member_line: number | null
}

/** The two directions in one statement, ordered so the answer is
 *  deterministic (row order is not a contract — it changes with inserts,
 *  ANALYZE and VACUUM, which is how the old `.get()` became a coin flip). */
const AGENT_FACTS_SQL = `
SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'caller' AS direction,
       ts.id AS self_id, ts.name AS self_name, tf.relative_path AS self_file,
       tf.language AS self_language, ts.line_start AS self_line,
       ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file,
       sf.language AS other_language, ss.line_start AS other_line
FROM brain_relationship r
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file   tf ON tf.id = ts.file_id
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file   sf ON sf.id = ss.file_id
WHERE r.project_id = ? AND r.is_cross_language = 1 AND ts.name = ?
UNION ALL
SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'callee' AS direction,
       ss.id AS self_id, ss.name AS self_name, sf.relative_path AS self_file,
       sf.language AS self_language, ss.line_start AS self_line,
       ts.id AS other_id, ts.name AS other_name, tf.relative_path AS other_file,
       tf.language AS other_language, ts.line_start AS other_line
FROM brain_relationship r
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file   sf ON sf.id = ss.file_id
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file   tf ON tf.id = ts.file_id
WHERE r.project_id = ? AND r.is_cross_language = 1 AND ss.name = ?
ORDER BY self_file, self_line, direction, other_file, other_line, row_id`

/** Every indexed symbol that CARRIES the name — including the ones with no
 *  cross-language rows at all. A name held by six symbols where one is
 *  connected is a different fact from a name held by one, and an agent that
 *  cannot see the difference will read "one of my six `f` symbols is
 *  cross-language" as "`f` is cross-language". The gate caught this: the copy
 *  count disagreed with the index for every ambiguous name (CL1 A2). */
/**
 * How many copies the answer carries, whatever the caller asked for.
 *
 * M63.CL5. `limit` governs FACTS. It said nothing about the copy list, which is as
 * long as the index says the name is ambiguous — measured at 844KB for a name with
 * 5,000 copies and a single cross-language row, at BOTH `limit: 1` and `limit: 200`,
 * with `truncated: false` asserting that nothing had been dropped. The response was
 * not bounded, and the one field a caller would read to find that out said the
 * opposite.
 *
 * Exported, and a named constant rather than an inline literal, for two reasons
 * that have each already cost a round: a mutation suite needs a stable anchor, and
 * the corpus-free wiring check needs to assert the bound is still declared.
 */
export const CROSS_LANGUAGE_COPY_CAP = 200

const ALL_COPIES_SQL = `
SELECT s.id AS id, s.name AS name, f.relative_path AS file, f.language AS language, s.line_start AS line
FROM brain_symbol s
JOIN brain_file f ON f.id = s.file_id
WHERE s.project_id = ? AND s.name = ?
ORDER BY f.relative_path, s.line_start, s.id
LIMIT ?`

/** The TRUE number of copies, counted independently of the cap.
 *
 *  This exists because `copyCount` used to be `copyList.length`, so capping the list
 *  would have silently turned the total into the cap — and a 227-copy name capped
 *  at 1 would have reported itself `ambiguous: false`. An honest number needs its
 *  own query, not a length of a truncated array. */
const COPY_COUNT_SQL = `
SELECT COUNT(*) AS total
FROM brain_symbol
WHERE project_id = ? AND name = ?`

/** The languages the copies carry, DISTINCT and independent of the cap.
 *
 *  Previously derived from the returned array, so a cap would have dropped every
 *  language whose only copy fell past it — and `languages` is what tells a caller
 *  whether the copies agree. */
const COPY_LANGUAGES_SQL = `
SELECT DISTINCT f.language AS language
FROM brain_symbol s
JOIN brain_file f ON f.id = s.file_id
WHERE s.project_id = ? AND s.name = ? AND f.language IS NOT NULL AND TRIM(f.language) <> ''
ORDER BY f.language`

/** The cross-language rows held by the MEMBERS of the copies — reported, and
 *  never counted as the owner's own.
 *
 *  MEASURED (jvm-interop, post-analyzer index): 1,566 of 1,642 stored
 *  cross-language rows — 95.4% — target a symbol that has an `owner_symbol_id`.
 *  A by-name answer for the OWNER therefore finds almost nothing while the
 *  index is full of edges about it, and the tool was declaring that absence:
 *
 *      owner                onItself   onMembers   the tool said
 *      Iterate                    0          109   declaredAbsent: true
 *      ConstantDynamic            0           92   declaredAbsent: true
 *      clojure.set                0           35   declaredAbsent: true
 *      Numbers                    0           25   declaredAbsent: true
 *      PersistentTreeMap          0           24   declaredAbsent: true
 *
 *  And it was not merely this tool's private gap — `bb_graph` answers the SAME
 *  question the other way. Its owner-cascade attributes member edges to the
 *  owner, and on 7 of 10 such owners it reported cross-language edges while this
 *  tool declared absence. Two tools, opposite answers, same symbol, same index.
 *
 *  WHY THIS REPORTS RATHER THAN CASCADES. `bb_graph` cascades member edges onto
 *  the owner and MARKS them (`match: "owner-cascade"`, `matchedMember`), and
 *  its own docs call the set "a superset of naive exact-target SQL" — its
 *  cascade is a lexical id-prefix range (graph-engine `cascadeBounds`), not the
 *  store's ownership edge. This tool will not import that heuristic: an edge on
 *  `Label.newLabel` is not an edge on `Label`, and presenting it as one is the
 *  quiet over-claim this tool exists to avoid. So the member rows are REPORTED
 *  as the member's, in their own section, and the envelope says how many there
 *  are. The reader gets the truth about the name without a claim about the
 *  owner.
 *
 *  Membership is the store's `owner_symbol_id` — the real ownership edge — and
 *  NOT the id-prefix range, which is why this count is lower than bb_graph's
 *  cascaded count. That difference is declared, not smoothed over.
 *
 *  A member that is ALSO a copy of the asked name is excluded: its rows are own
 *  rows, and counting them twice would inflate every number in the envelope. */
/**
 * Cross-language rows on DESCENDANTS at depth two or more.
 *
 * M63.CL5. The member cascade follows `owner_symbol_id`, so it is one level deep,
 * and it was reporting `declaredAbsent: true` for symbols whose grandchildren hold
 * cross-language rows — measured at 141 such rows across 19 owners on the JVM
 * corpus and 27 across 4 on elixir, with nesting reaching depth 4 and depth 6.
 *
 * This is a COUNT and not a cascade, deliberately. CL2 ruled that a member's edges
 * are reported as the member's, never absorbed into the owner's, so that `bb_graph`'s
 * larger cascaded count stays visible instead of being reconciled away. Emitting
 * these as facts would be exactly the laundering that ruling forbids; counting them
 * lets the absence stop over-claiming without pretending the owner owns them.
 *
 * Note also that `bb_graph` reports NOTHING for these symbols either (measured,
 * 8/8 owners), so this is a shared blind spot rather than the cross-tool
 * contradiction CL2 found one level up.
 */
const DEEPER_DESCENDANT_ROWS_SQL = `
WITH RECURSIVE down(id, depth) AS (
  SELECT m.id, 1
  FROM brain_symbol m JOIN brain_symbol o ON o.id = m.owner_symbol_id
  WHERE o.project_id = ? AND o.name = ?
  UNION ALL
  SELECT m.id, down.depth + 1
  FROM brain_symbol m JOIN down ON m.owner_symbol_id = down.id
)
SELECT COUNT(DISTINCT r.id) AS n
FROM brain_relationship r JOIN down ON down.id = r.target_symbol_id
WHERE r.project_id = ? AND r.is_cross_language = 1 AND down.depth >= 2`

const MEMBER_FACTS_SQL = `
SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'caller' AS direction,
       owner.id AS self_id, owner.name AS self_name, ofile.relative_path AS self_file,
       ofile.language AS self_language, owner.line_start AS self_line,
       ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file,
       sf.language AS other_language, ss.line_start AS other_line,
       m.id AS member_id, m.name AS member_name, mfile.relative_path AS member_file,
       mfile.language AS member_language, m.line_start AS member_line
FROM brain_relationship r
JOIN brain_symbol m ON m.id = r.target_symbol_id
JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
JOIN brain_file ofile ON ofile.id = owner.file_id
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ?
  AND m.name <> owner.name
UNION ALL
SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'callee' AS direction,
       owner.id AS self_id, owner.name AS self_name, ofile.relative_path AS self_file,
       ofile.language AS self_language, owner.line_start AS self_line,
       ts.id AS other_id, ts.name AS other_name, tf.relative_path AS other_file,
       tf.language AS other_language, ts.line_start AS other_line,
       m.id AS member_id, m.name AS member_name, mfile.relative_path AS member_file,
       mfile.language AS member_language, m.line_start AS member_line
FROM brain_relationship r
JOIN brain_symbol m ON m.id = r.source_symbol_id
JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
JOIN brain_file ofile ON ofile.id = owner.file_id
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file tf ON tf.id = ts.file_id
WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ?
  AND m.name <> owner.name
ORDER BY self_file, self_line, member_file, member_line, direction, other_file, other_line, row_id`

/** Build one fact from a stored row, or `null` when the row cannot name a pair.
 *  Shared by the own and member scans so the two sections cannot drift: the
 *  tier rule, the bridge default, the pair rule and the identity fields are
 *  derived in exactly one place. A member row that returned a differently
 *  shaped fact would be the same class of bug as two tier rules.
 *
 *  `pairFromLanguage` is the language of the endpoint the STORED ROW NAMES. For
 *  an own row that is the symbol itself; for a member row it is the member, not
 *  the owner — an owner and its members are usually in one file, so the two
 *  agree in practice, and deriving the pair from the owner anyway would be an
 *  assumption that happens to hold rather than a fact. */
function factFromRow(
  row: AgentFactRow,
  match: CrossLanguageMatch,
  counters: { unpairable: number },
  matchedMember?: CrossLanguageEnd,
  pairFromLanguage?: string | null,
  matchedMemberId?: string,
): CrossLanguageAgentFact | null {
  const selfLang = pairFromLanguage === undefined ? row.self_language : pairFromLanguage
  const otherLang = row.other_language
  const pair = selfLang && otherLang && selfLang.toLowerCase() !== otherLang.toLowerCase()
    ? `${selfLang} → ${otherLang}`
    : null
  if (pair === null) { counters.unpairable++; return null }
  const fact: CrossLanguageAgentFact = {
    self: { symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line },
    direction: row.direction,
    other: { symbol: row.other_name, file: row.other_file, language: row.other_language, line: row.other_line },
    pair,
    bridge: row.bridge_mechanism ?? UNNAMED_BRIDGE,
    tier: tierForCrossLanguageEdge({
      relationship_type: row.relationship_type,
      confidence: row.confidence,
      evidence_class: parseEvidenceClass(row.metadata),
    }),
    confidence: row.confidence ?? 0,
    relationshipType: row.relationship_type,
    rowId: row.row_id,
    match,
  }
  if (matchedMember) {
    fact.matchedMember = matchedMember
    if (matchedMemberId !== undefined) fact.matchedMemberId = matchedMemberId
  }
  return fact
}

/** Every stored cross-language row about ANY symbol with this name — the copies
 *  themselves and, separately, their members — with both ends named, filtered
 *  by project.
 *
 *  This is the agent door's single source. It never guesses: a row whose ends
 *  cannot name a pair is counted in `unpairableRowCount` and not emitted, a row
 *  matched from both directions is collapsed once and counted, and a member row
 *  is never emitted as the owner's own. */
export function storedCrossLanguageFactsByName(
  db: CrossLanguageDb,
  projectId: string,
  name: string,
): CrossLanguageNameResult {
  const rows = db.prepare(AGENT_FACTS_SQL).all(projectId, name, projectId, name) as unknown as AgentFactRow[]
  const memberRows = db.prepare(MEMBER_FACTS_SQL).all(projectId, name, projectId, name) as unknown as MemberFactRow[]
  const allCopies = db.prepare(ALL_COPIES_SQL).all(projectId, name, CROSS_LANGUAGE_COPY_CAP) as unknown as Array<{
    id: string; name: string; file: string | null; language: string | null; line: number | null
  }>
  // How many cross-language rows sit at depth >= 2 below the copies. A COUNT, so
  // the answer can declare that the cascade does not reach them.
  const deeperDescendantRows = (db.prepare(DEEPER_DESCENDANT_ROWS_SQL).get(projectId, name, projectId) as unknown as { n: number }).n

  // The true total and the language set, each from its own query, because both used
  // to be derived from the array above and a cap would have made both wrong.
  const copyTotal = (db.prepare(COPY_COUNT_SQL).get(projectId, name) as unknown as { total: number }).total
  const copyLanguages = (db.prepare(COPY_LANGUAGES_SQL).all(projectId, name) as unknown as Array<{ language: string }>)
    .map((r) => r.language)

  // Every copy first, so a copy with no rows is still declared; the row scan
  // then adds each copy's row count.
  const copies = new Map<string, CrossLanguageNameCopy>()
  for (const copy of allCopies) {
    copies.set(copy.id, { id: copy.id, symbol: copy.name, file: copy.file, language: copy.language, line: copy.line, crossRowCount: 0 })
  }
  const seenRows = new Set<string>()
  const facts: CrossLanguageAgentFact[] = []
  const memberFacts: CrossLanguageAgentFact[] = []
  const members = new Set<string>()
  const counters = { unpairable: 0 }
  let collapsed = 0

  for (const row of rows) {
    const copy = copies.get(row.self_id)
    if (copy) copy.crossRowCount++
    else {
      // A row whose source symbol is not in this project (should be impossible
      // under the project filter, but a stored id is not a promise): the copy is
      // added rather than dropped, so the count can never under-report.
      copies.set(row.self_id, { id: row.self_id, symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line, crossRowCount: 1 })
    }

    // One stored row is one fact. A self-referential row matches from both
    // directions; it is counted as collapsed, not emitted twice.
    if (seenRows.has(row.row_id)) { collapsed++; continue }
    seenRows.add(row.row_id)

    const fact = factFromRow(row, "exact", counters)
    if (fact) facts.push(fact)
  }

  // Member rows. A row already emitted as an own row is skipped rather than
  // re-reported as a cascade: that is the member-is-also-a-copy case, and
  // counting it twice would inflate every number in the envelope.
  for (const row of memberRows) {
    if (seenRows.has(row.row_id)) { collapsed++; continue }
    seenRows.add(row.row_id)
    members.add(row.member_id)
    const fact = factFromRow(row, "owner-cascade", counters, {
      symbol: row.member_name, file: row.member_file, language: row.member_language, line: row.member_line,
    }, row.member_language, row.member_id)
    if (fact) memberFacts.push(fact)
  }

  const sorted = [...copies.values()].sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id))
  // THE SLICE IS THE BOUND; the SQL's LIMIT is a FETCH OPTIMISATION. Both are here
  // deliberately, and they are not equal.
  //
  // The SQL LIMIT avoids fetching copies nobody will see. This slice is what makes
  // the answer BOUNDED, because the row scan above adds a copy for every row whose
  // source symbol fell outside the capped SELECT — which is every copy holding a
  // cross-language row. A SQL-only cap therefore would NOT have bounded this array:
  // it would have passed the byte measurement on a fixture with one cross row and
  // failed on any name whose copies mostly have edges.
  //
  // Removing either one alone leaves the other standing, which is worth stating
  // plainly: it means neither is redundant, and it means a mutation suite must
  // target THIS line to test the bound. The gate's M16 does, and the first version
  // of it asserted a byte threshold that the SQL LIMIT alone would have satisfied —
  // so the mutant passed a defect it did not reproduce, and the gate said so.
  const copyList = sorted.slice(0, CROSS_LANGUAGE_COPY_CAP)
  const languages = copyLanguages.slice().sort()

  return {
    copies: copyList,
    // The TRUE total, never the length of a truncated array.
    copyCount: copyTotal,
    // The languages the copies carry, from COPY_LANGUAGES_SQL rather than from the
    // capped array — and RETURNED, which the first draft of CL5 computed and then
    // dropped. The variable was assigned, so nothing warned: the field just
    // disappeared from the envelope, and only the typecheck noticed.
    languages,
    // M63.CL5: `ambiguous` was `copyList.length > 1`, so a cap below the real count
    // would have let a 227-copy name report itself unambiguous — the exact silent
    // choice the union-over-copies rule exists to prevent.
    ambiguous: copyTotal > 1,
    copiesTruncated: copyTotal > copyList.length,
    copiesCap: CROSS_LANGUAGE_COPY_CAP,
    deeperDescendantRowCount: deeperDescendantRows,
    facts,
    memberFacts,
    storedRowCount: rows.length + memberRows.length,
    unpairableRowCount: counters.unpairable,
    collapsedRowCount: collapsed,
    memberCount: members.size,
  }
}

/** The one honest wording for a row that carries no bridge mechanism. Kept as
 *  a named constant because the W3 mutation suite plants its defect by
 *  replacing the string literal at the assignment site (script/m26). */
export const UNNAMED_BRIDGE = "unnamed bridge (stored row carries no mechanism)"

/**
 * Fetch the stored cross-language rows for one symbol, both directions, with the
 * opposite side's file language. Single query per direction.
 *
 * PROJECT SCOPE IS PART OF THE CONTRACT, not of the caller. M63.CL3: the JOIN
 * pinned the SOURCE symbol's project to the row's (`ss.project_id =
 * r.project_id`), which reads like a project filter and is not one — the row
 * itself was never constrained, and the function's only key was the symbol id.
 * A relationship row belonging to another project and pointing at this symbol
 * was returned as a fact about it (reproduced against the real handler in CL1:
 * `LEAKED: true`, `toolFactsMentionLeak: true`).
 *
 * The obvious fix is a `projectId` parameter. This does not take one, on
 * purpose: `hover()` has no project in scope — it resolves by file path — so
 * threading one would touch the LSP surface for a property the SQL can carry
 * itself, and a parameter a caller can forget is a weaker guarantee than a
 * filter that cannot be omitted. The row is tied to the project of the symbol
 * being asked about, derived from that symbol's id.
 */
export function storedCrossLanguageRows(db: CrossLanguageDb, symbolId: string): CrossLanguageEdgeRow[] {
  const rows: CrossLanguageEdgeRow[] = []
  // Callers: edges INTO the symbol; the other side is the source file's language.
  const callers = db
    .prepare(
      `SELECT r.relationship_type, r.confidence, r.bridge_mechanism, sf.language AS other_language, r.metadata
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
       JOIN brain_file sf ON sf.id = ss.file_id
       WHERE r.is_cross_language = 1 AND r.target_symbol_id = ?
         AND r.project_id = (SELECT s2.project_id FROM brain_symbol s2 WHERE s2.id = ?)`,
    )
    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>
  for (const r of callers) rows.push({ ...r, direction: "caller", evidence_class: parseEvidenceClass(r.metadata) })
  // Callees: edges OUT of the symbol; the other side is the target file's language.
  const callees = db
    .prepare(
      `SELECT r.relationship_type, r.confidence, r.bridge_mechanism, tf.language AS other_language, r.metadata
       FROM brain_relationship r
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
       JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.is_cross_language = 1 AND r.source_symbol_id = ?
         AND r.project_id = (SELECT s2.project_id FROM brain_symbol s2 WHERE s2.id = ?)`,
    )
    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>
  for (const r of callees) rows.push({ ...r, direction: "callee", evidence_class: parseEvidenceClass(r.metadata) })
  return rows
}

function parseEvidenceClass(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    return typeof parsed["evidenceClass"] === "string" ? (parsed["evidenceClass"] as string) : null
  } catch {
    return null
  }
}

/** Per-pair coverage over the whole project: the generated reality table for
 *  docs (D1) — pairs with no rows are declared absent, never listed as
 *  supported. Also the source of truth for the W3 acceptance criterion
 *  "docs declare the actual pair coverage". */
export function projectPairCoverage(
  db: CrossLanguageDb,
  projectId: string,
  launchLanguages: readonly string[],
): Array<{ source: string; target: string; edgeCount: number; sampleBridge: string | null }> {
  const rows = db
    .prepare(
      `SELECT sf.language AS source, tf.language AS target, COUNT(*) AS edgeCount, MAX(r.bridge_mechanism) AS sampleBridge
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
       JOIN brain_file sf ON sf.id = ss.file_id
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
       JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.is_cross_language = 1 AND r.project_id = ?
       GROUP BY sf.language, tf.language`,
    )
    .all(projectId) as Array<{ source: string | null; target: string | null; edgeCount: number; sampleBridge: string | null }>
  const out: Array<{ source: string; target: string; edgeCount: number; sampleBridge: string | null }> = []
  for (const r of rows) {
    if (!r.source || !r.target) continue
    out.push({ source: r.source, target: r.target, edgeCount: r.edgeCount, sampleBridge: r.sampleBridge })
  }
  void launchLanguages
  return out
}
