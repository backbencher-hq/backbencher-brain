// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the single owner of cross-language facts for both read
//   surfaces: the editor's cross-language hover section and the bb_cross_language
//   MCP tool. It builds facts from stored rows only and derives nothing.
// WHICH TOOL IT SERVES — bb_cross_language (mutability read, requiresIndex true,
//   modes: cross-language). The LSP hover is the other consumer of the same
//   functions.
// WHY IT IS SHAPED THIS WAY — the two surfaces need different projections of one
//   truth. A hover card has one symbol id and a human who already knows the file;
//   an agent has a NAME (the index holds one symbol per file/name/line, so a name
//   is many symbols), no surrounding card, and a context budget. The hover
//   projection therefore collapses to (pair, direction, bridge, tier, confidence)
//   and stays unbounded (a card is small); the agent projection names both ends of
//   every row, carries the stored row id, unions over every copy of the name,
//   reports member rows separately, and is bounded by a declared limit. Both are
//   built from the same row scans below, so they cannot disagree about a row.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_cross_language.md;
//   validation/tools/bb_cross_language/verify-cross-language.ts (seeded states,
//   row-set equality of the by-name statements, 8 planted defects); the hover gate
//   script/m26/verify-cross-language-hover.ts; the corpus lane
//   script/m63/verify-cl1-cross-language.ts; LATENCY.json in the same tool tree.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_cross_language/{handler,descriptor}.ts,
//   script/tool-docs/curation/bb_cross_language.ts, the generated tool page, the
//   hover projection in src/lsp/hover.ts, and the gate scripts above.
// CONTRACTS IT MUST NOT BREAK — stored rows only (is_cross_language = 1, the row's
//   own project_id), declared absence, one tier rule (src/lsp/evidence_tier.ts),
//   member rows reported as the member's and never absorbed into the owner, and
//   the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyTier, type EvidenceTier } from "./evidence_tier"

// ─────────────────────────────────────────────────────────────────────────────
// The hover projection
// ─────────────────────────────────────────────────────────────────────────────

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

/** The tier vocabulary a cross-language fact can carry. The vocabulary itself is
 *  owned by src/lsp/evidence_tier.ts; this alias keeps the surface types reading
 *  as one name. */
export type EdgeTier = EvidenceTier

/** Tier for a cross-language edge — a DELEGATION to the one classifier, never a
 *  second rule. Two copies of this derivation is how the same stored `imports` row
 *  once rendered two different tiers on two surfaces. */
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

/** The one honest wording for a row that carries no bridge mechanism. Exported
 *  because the hover mutation suite plants its defect by replacing the literal at
 *  the assignment site. */
export const UNNAMED_BRIDGE = "unnamed bridge (stored row carries no mechanism)"

/** Build per-pair facts from stored rows only. A row whose opposite side has no
 *  detected language cannot name a pair and is skipped here; the agent projection
 *  counts such rows in `unpairableRowCount` instead of dropping them silently. */
export function factsFromRows(rows: CrossLanguageEdgeRow[], hoverLanguage: string | null): CrossLanguageFact[] {
  if (hoverLanguage === null) return []
  const facts: CrossLanguageFact[] = []
  for (const row of rows) {
    if (!row.other_language) continue
    facts.push({
      pair: `${hoverLanguage} → ${row.other_language}`,
      direction: row.direction,
      bridge: row.bridge_mechanism ?? UNNAMED_BRIDGE,
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

/** Minimal db surface (structural, stubbable). `get` and `all` are both provided
 *  by the real driver (src/storage/db.node.ts). */
export interface CrossLanguageDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown }
}

/** Fetch the stored cross-language rows for one symbol, both directions, with the
 *  opposite side's file language. One statement per direction.
 *
 *  Project scope is part of the contract, not of the caller: the hover has no
 *  project in scope (it resolves by file path), so the row is tied to the project
 *  of the symbol being asked about, derived from that symbol's id. A parameter a
 *  caller can forget is a weaker guarantee than a filter that cannot be omitted. */
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

/** Per-pair coverage over the whole project: the generated reality table for docs.
 *  Pairs with no stored rows are declared absent, never listed as supported. */
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

// ─────────────────────────────────────────────────────────────────────────────
// The agent projection
// ─────────────────────────────────────────────────────────────────────────────

/** One end of a cross-language fact. `line` is the symbol's declaration line;
 *  `null` is honest unknown, never 0. */
export interface CrossLanguageEnd {
  symbol: string | null
  file: string | null
  language: string | null
  line: number | null
}

/** How a stored row was attributed to the asked name. */
export type CrossLanguageMatch = "exact" | "owner-cascade"

/** One stored row, both ends named.
 *
 *  `self` is the endpoint the STORED ROW NAMES: the copy of the asked name for an
 *  exact row, the member for an owner-cascade row. That is what makes `pair`
 *  checkable against the fact's own ends — `pair` is a pure function of
 *  `self.language` and `other.language`, and is null (row counted unpairable) when
 *  either is unknown or the two are equal.
 *
 *  `owner` is present only on owner-cascade facts and names the copy of the asked
 *  name whose member holds the row — the attribution, kept as an end so a reader
 *  can verify it without trusting the tool. */
export interface CrossLanguageAgentFact {
  self: CrossLanguageEnd
  owner?: CrossLanguageEnd
  direction: "caller" | "callee"
  other: CrossLanguageEnd
  /** "selfLang → otherLang"; null when either language is unknown or equal (a row
   *  flagged cross-language whose ends share a language cannot name a pair — it is
   *  counted, never dressed up) */
  pair: string | null
  bridge: string
  tier: EdgeTier
  confidence: number
  relationshipType: string
  /** the stored row id — traceability, the same field bb_graph returns */
  rowId: string
  /** `exact` when the stored row names a copy of the asked name; `owner-cascade`
   *  when it names one of their members. The same vocabulary bb_graph uses. */
  match: CrossLanguageMatch
  /** owner-cascade only: the member the row named. Equal to `self` by construction,
   *  kept so a consumer reading either name sees the same member end. */
  matchedMember?: CrossLanguageEnd
  /** owner-cascade only: the stored id of that member, so the attribution is
   *  checkable without trusting the tool. */
  matchedMemberId?: string
}

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
  /** the TRUE number of copies: its own count query, never the length of a capped
   *  array, so capping cannot silence `ambiguous` */
  copyCount: number
  /** true when the returned copy list is a prefix of the copies that exist */
  copiesTruncated: boolean
  /** the cap that was applied, so the number is a fact about the answer */
  copiesCap: number
  /** rows on members-of-members and deeper, COUNTED and not cascaded into the
   *  owner's facts. Both row directions are counted. */
  deeperDescendantRowCount: number
  /** distinct non-empty languages across the copies, sorted */
  languages: string[]
  ambiguous: boolean
  /** rows on the copies themselves */
  facts: CrossLanguageAgentFact[]
  /** rows on the MEMBERS of the copies, each marked `owner-cascade` */
  memberFacts: CrossLanguageAgentFact[]
  /** stored cross-language rows matched across every copy (own + member), before
   *  collapsing a row matched from both directions */
  storedRowCount: number
  /** rows that matched but cannot name a pair (unknown/equal languages) */
  unpairableRowCount: number
  /** rows dropped because the same row id was matched from both directions */
  collapsedRowCount: number
  /** distinct members that contributed a member fact */
  memberCount: number
}

/** The declared default and ceiling for the agent door. A hover card needs no
 *  bound; an agent's context does. */
export const CROSS_LANGUAGE_DEFAULT_LIMIT = 200
export const CROSS_LANGUAGE_MAX_LIMIT = 1000

/** How many copies the answer carries, whatever the caller asked for. Exported
 *  and named rather than inlined so the bound is a declared fact and a mutation
 *  suite has a stable anchor. */
export const CROSS_LANGUAGE_COPY_CAP = 200

/** One row as the SELECTs below return it. `self_*` is the endpoint the row names;
 *  `owner_*` is NULL for exact rows and the copy for owner-cascade rows. */
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
  owner_id: string | null
  owner_name: string | null
  owner_file: string | null
  owner_language: string | null
  owner_line: number | null
  other_id: string | null
  other_name: string | null
  other_file: string | null
  other_language: string | null
  other_line: number | null
}

/** The row statements are written so the PLANNER walks from the symbol-name index,
 *  not from the relationship table.
 *
 *  Measured on the 6,452-file reference index: written with the relationship table
 *  first and the name filter on the joined symbol, each statement SEARCHes
 *  brain_relationship USING INDEX brain_rel_project_idx (project_id=?) and scans
 *  every relationship row of the project — 820,040 rows here — for 3.8–17.6 s per
 *  statement, even when no row matches. The two indexes built for this purpose
 *  (brain_rel_target_cross_idx / brain_rel_source_cross_idx on
 *  (symbol_id, is_cross_language)) are never used.
 *
 *  `CROSS JOIN` is the SQL-standard way to say "this order, please": SQLite does
 *  not reorder across it, so the walk starts at the copies of the name
 *  (brain_sym_proj_name_type_idx) and reaches the rows through those indexes. Every
 *  predicate is preserved, including the ROW's own project_id — this is a join-order
 *  change, not a scope change. Measured on the same index: 14,641 ms → 26 ms for one
 *  name, 6,909 ms → 406 ms for another, with identical row sets; on a corpus with
 *  rows the same equality is asserted by validation/tools/bb_cross_language. */
const SELF_COLUMNS = `r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata`
const COPY_COLUMNS = `ts.id AS self_id, ts.name AS self_name, tf.relative_path AS self_file,
       tf.language AS self_language, ts.line_start AS self_line,
       NULL AS owner_id, NULL AS owner_name, NULL AS owner_file, NULL AS owner_language, NULL AS owner_line`
const OTHER_COLUMNS_AS_TARGET = `ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file,
       sf.language AS other_language, ss.line_start AS other_line`

/** The two directions in one statement, ordered so the answer is deterministic
 *  (row order is not a contract — it changes with inserts, ANALYZE and VACUUM). */
const AGENT_FACTS_SQL = `
SELECT ${SELF_COLUMNS}, 'caller' AS direction, ${COPY_COLUMNS}, ${OTHER_COLUMNS_AS_TARGET}
FROM brain_symbol ts
CROSS JOIN brain_relationship r ON r.target_symbol_id = ts.id AND r.is_cross_language = 1
CROSS JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file tf ON tf.id = ts.file_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE ts.name = ? AND r.project_id = ?
UNION ALL
SELECT ${SELF_COLUMNS}, 'callee' AS direction, ${COPY_COLUMNS}, ${OTHER_COLUMNS_AS_TARGET}
FROM brain_symbol ts
CROSS JOIN brain_relationship r ON r.source_symbol_id = ts.id AND r.is_cross_language = 1
CROSS JOIN brain_symbol ss ON ss.id = r.target_symbol_id
JOIN brain_file tf ON tf.id = ts.file_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE ts.name = ? AND r.project_id = ?
ORDER BY self_file, self_line, direction, other_file, other_line, row_id`

/** Every indexed symbol that CARRIES the name — including the ones with no
 *  cross-language rows at all. A name held by six symbols where one is connected is
 *  a different fact from a name held by one. */
const ALL_COPIES_SQL = `
SELECT s.id AS id, s.name AS name, f.relative_path AS file, f.language AS language, s.line_start AS line
FROM brain_symbol s
JOIN brain_file f ON f.id = s.file_id
WHERE s.project_id = ? AND s.name = ?
ORDER BY f.relative_path, s.line_start, s.id
LIMIT ?`

/** The TRUE number of copies, counted independently of the cap. An honest total
 *  needs its own query, not the length of a truncated array. */
const COPY_COUNT_SQL = `
SELECT COUNT(*) AS total
FROM brain_symbol
WHERE project_id = ? AND name = ?`

/** The languages the copies carry, DISTINCT and independent of the cap — `languages`
 *  is what tells a caller whether the copies agree. */
const COPY_LANGUAGES_SQL = `
SELECT DISTINCT f.language AS language
FROM brain_symbol s
JOIN brain_file f ON f.id = s.file_id
WHERE s.project_id = ? AND s.name = ? AND f.language IS NOT NULL AND TRIM(f.language) <> ''
ORDER BY f.language`

/** Cross-language rows held by the MEMBERS of the copies — reported, never counted
 *  as the owner's own.
 *
 *  Membership is the store's `owner_symbol_id` (the real ownership edge), NOT the
 *  id-prefix range bb_graph's cascade uses, which is why this count is lower than
 *  bb_graph's cascaded count. The difference is declared in the answer rather than
 *  smoothed over. A member that is ALSO a copy of the asked name is excluded from
 *  the member scan by the row set (its rows are own rows); the by-name scan drops
 *  the overlap by row id.
 *
 *  The join order is the same planner fix as the own-facts statement above: drive
 *  from the owner's name, then the owner index, then the cross-language indexes.
 *  Measured 8,851 ms → 70 ms for one name on the reference index. */
const MEMBER_FACTS_SQL = `
SELECT ${SELF_COLUMNS}, 'caller' AS direction,
       m.id AS self_id, m.name AS self_name, mfile.relative_path AS self_file,
       mfile.language AS self_language, m.line_start AS self_line,
       owner.id AS owner_id, owner.name AS owner_name, ofile.relative_path AS owner_file,
       ofile.language AS owner_language, owner.line_start AS owner_line,
       ${OTHER_COLUMNS_AS_TARGET}
FROM brain_symbol owner
CROSS JOIN brain_symbol m ON m.owner_symbol_id = owner.id
CROSS JOIN brain_relationship r ON r.target_symbol_id = m.id AND r.is_cross_language = 1
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_file ofile ON ofile.id = owner.file_id
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE owner.name = ? AND r.project_id = ? AND m.name <> owner.name
UNION ALL
SELECT ${SELF_COLUMNS}, 'callee' AS direction,
       m.id AS self_id, m.name AS self_name, mfile.relative_path AS self_file,
       mfile.language AS self_language, m.line_start AS self_line,
       owner.id AS owner_id, owner.name AS owner_name, ofile.relative_path AS owner_file,
       ofile.language AS owner_language, owner.line_start AS owner_line,
       ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file,
       sf.language AS other_language, ss.line_start AS other_line
FROM brain_symbol owner
CROSS JOIN brain_symbol m ON m.owner_symbol_id = owner.id
CROSS JOIN brain_relationship r ON r.source_symbol_id = m.id AND r.is_cross_language = 1
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_file ofile ON ofile.id = owner.file_id
JOIN brain_symbol ss ON ss.id = r.target_symbol_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE owner.name = ? AND r.project_id = ? AND m.name <> owner.name
ORDER BY self_file, self_line, owner_file, owner_line, direction, other_file, other_line, row_id`

/** Cross-language rows on DESCENDANTS at depth two or more.
 *
 *  The member cascade follows `owner_symbol_id`, so it is one level deep. This is a
 *  COUNT and not a cascade: a descendant's edges are reported as the descendant's,
 *  never absorbed into the owner. Counting them lets the absence statement stop
 *  over-claiming without pretending the owner owns them.
 *
 *  BOTH directions of the row are counted. A descendant that is the SOURCE of a
 *  cross-language row is exactly as much a stored row about that descendant as one
 *  it targets; counting only the target side under-reported the number and made the
 *  absence note claim there were no deeper rows — measured on a fixture whose
 *  grandchild called into another language (count 0, truth 1). The member scan above
 *  has always covered both directions; this now matches it. */
const DEEPER_DESCENDANT_ROWS_SQL = `
WITH RECURSIVE down(id, depth) AS (
  SELECT m.id, 1
  FROM brain_symbol m JOIN brain_symbol o ON o.id = m.owner_symbol_id
  WHERE o.project_id = ? AND o.name = ?
  UNION ALL
  SELECT m.id, down.depth + 1
  FROM brain_symbol m JOIN down ON m.owner_symbol_id = down.id
)
SELECT COUNT(*) AS n FROM (
  SELECT r.id FROM brain_relationship r JOIN down ON down.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.is_cross_language = 1 AND down.depth >= 2
  UNION
  SELECT r.id FROM brain_relationship r JOIN down ON down.id = r.source_symbol_id
  WHERE r.project_id = ? AND r.is_cross_language = 1 AND down.depth >= 2
)`

/** Build one fact from a stored row, or `null` when the row cannot name a pair.
 *  Shared by the own and member scans so the two sections cannot drift: the tier
 *  rule, the bridge default, the pair rule and the identity fields are derived in
 *  exactly one place.
 *
 *  `self` is the endpoint the STORED ROW NAMES (the copy for exact rows, the member
 *  for owner-cascade rows), which is why `pair` is always recomputable from the
 *  fact's own `self` and `other` ends. `owner` is the attribution and rides the
 *  owner-cascade facts only. A row whose ends cannot name a pair is counted and not
 *  emitted — no language is ever substituted to manufacture a pair. */
function factFromRow(row: AgentFactRow, match: CrossLanguageMatch, counters: { unpairable: number }): CrossLanguageAgentFact | null {
  const pair = row.self_language && row.other_language && row.self_language.toLowerCase() !== row.other_language.toLowerCase()
    ? `${row.self_language} → ${row.other_language}`
    : null
  if (pair === null) { counters.unpairable++; return null }
  const self: CrossLanguageEnd = { symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line }
  const fact: CrossLanguageAgentFact = {
    self,
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
  if (match === "owner-cascade") {
    fact.owner = { symbol: row.owner_name, file: row.owner_file, language: row.owner_language, line: row.owner_line }
    fact.matchedMember = self
    fact.matchedMemberId = row.self_id
  }
  return fact
}

/** Every stored cross-language row about ANY symbol with this name — the copies
 *  themselves and, separately, their members — with both ends named, filtered by
 *  project. This is the agent door's single source: a row whose ends cannot name a
 *  pair is counted and not emitted, a row matched from both directions is collapsed
 *  once and counted, and a member row is never emitted as the owner's own. */
export function storedCrossLanguageFactsByName(
  db: CrossLanguageDb,
  projectId: string,
  name: string,
): CrossLanguageNameResult {
  const rows = db.prepare(AGENT_FACTS_SQL).all(name, projectId, name, projectId) as unknown as AgentFactRow[]
  const memberRows = db.prepare(MEMBER_FACTS_SQL).all(name, projectId, name, projectId) as unknown as AgentFactRow[]
  const allCopies = db.prepare(ALL_COPIES_SQL).all(projectId, name, CROSS_LANGUAGE_COPY_CAP) as unknown as Array<{
    id: string; name: string; file: string | null; language: string | null; line: number | null
  }>
  const deeperDescendantRows = (db.prepare(DEEPER_DESCENDANT_ROWS_SQL).get(projectId, name, projectId, projectId) as unknown as { n: number }).n
  // The true total and the language set each come from their own query: both used to
  // be derived from the array above, so a cap would have made both wrong.
  const copyTotal = (db.prepare(COPY_COUNT_SQL).get(projectId, name) as unknown as { total: number }).total
  const copyLanguages = (db.prepare(COPY_LANGUAGES_SQL).all(projectId, name) as unknown as Array<{ language: string }>)
    .map((r) => r.language)

  // Every copy first, so a copy with no rows is still declared; the row scan then
  // adds each copy's row count.
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
      // A row whose self symbol is not in this project (should be impossible under the
      // project filter, but a stored id is not a promise): the copy is added rather
      // than dropped, so the count can never under-report.
      copies.set(row.self_id, { id: row.self_id, symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line, crossRowCount: 1 })
    }
    // One stored row is one fact. A self-referential row matches from both directions;
    // it is counted as collapsed, not emitted twice.
    if (seenRows.has(row.row_id)) { collapsed++; continue }
    seenRows.add(row.row_id)
    const fact = factFromRow(row, "exact", counters)
    if (fact) facts.push(fact)
  }

  // Member rows. A row already emitted as an own row is skipped rather than
  // re-reported as a cascade: that is the member-is-also-a-copy case.
  for (const row of memberRows) {
    if (seenRows.has(row.row_id)) { collapsed++; continue }
    seenRows.add(row.row_id)
    members.add(row.self_id)
    const fact = factFromRow(row, "owner-cascade", counters)
    if (fact) memberFacts.push(fact)
  }

  const sorted = [...copies.values()].sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id))
  // THE SLICE IS THE BOUND; the SQL LIMIT is a fetch optimisation, and they are not
  // equal: the row scan above adds a copy for every row whose self symbol fell outside
  // the capped SELECT, so a SQL-only cap would not bound this array. Removing either
  // one alone leaves the other standing, which is why the bound is also asserted by
  // the mutation suite.
  const copyList = sorted.slice(0, CROSS_LANGUAGE_COPY_CAP)
  const languages = copyLanguages.slice().sort()

  return {
    copies: copyList,
    copyCount: copyTotal,
    languages,
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
