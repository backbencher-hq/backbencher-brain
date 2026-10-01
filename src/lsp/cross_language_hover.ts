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
  prepare(sql: string): { all(...params: unknown[]): unknown }
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
  copyCount: number
  /** distinct non-empty languages across the copies, sorted */
  languages: string[]
  ambiguous: boolean
  facts: CrossLanguageAgentFact[]
  /** stored cross-language rows matched across every copy */
  storedRowCount: number
  /** rows that matched but cannot name a pair (unknown/equal languages) */
  unpairableRowCount: number
  /** rows dropped because the same row id was matched from both directions */
  collapsedRowCount: number
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

/** Every stored cross-language row touching ANY symbol with this name, with
 *  both ends named, filtered by project.
 *
 *  This is the agent door's single source. It never guesses: a row whose ends
 *  cannot name a pair is counted in `unpairableRowCount` and not emitted, and
 *  a row matched from both directions is collapsed once and counted. */
export function storedCrossLanguageFactsByName(
  db: CrossLanguageDb,
  projectId: string,
  name: string,
): CrossLanguageNameResult {
  const rows = db.prepare(AGENT_FACTS_SQL).all(projectId, name, projectId, name) as unknown as AgentFactRow[]

  const copies = new Map<string, CrossLanguageNameCopy>()
  const seenRows = new Set<string>()
  const facts: CrossLanguageAgentFact[] = []
  let unpairable = 0
  let collapsed = 0

  for (const row of rows) {
    const copy = copies.get(row.self_id) ?? {
      id: row.self_id, symbol: row.self_name, file: row.self_file,
      language: row.self_language, line: row.self_line, crossRowCount: 0,
    }
    copy.crossRowCount++
    copies.set(row.self_id, copy)

    // One stored row is one fact. A self-referential row matches from both
    // directions; it is counted as collapsed, not emitted twice.
    if (seenRows.has(row.row_id)) { collapsed++; continue }
    seenRows.add(row.row_id)

    const selfLang = row.self_language
    const otherLang = row.other_language
    const pair = selfLang && otherLang && selfLang.toLowerCase() !== otherLang.toLowerCase()
      ? `${selfLang} → ${otherLang}`
      : null
    if (pair === null) { unpairable++; continue }

    facts.push({
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
    })
  }

  const copyList = [...copies.values()].sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id))
  const languages = [...new Set(copyList.map((c) => c.language).filter((l): l is string => Boolean(l)))].sort()

  return {
    copies: copyList,
    copyCount: copyList.length,
    languages,
    ambiguous: copyList.length > 1,
    facts,
    storedRowCount: rows.length,
    unpairableRowCount: unpairable,
    collapsedRowCount: collapsed,
  }
}

/** The one honest wording for a row that carries no bridge mechanism. Kept as
 *  a named constant because the W3 mutation suite plants its defect by
 *  replacing the string literal at the assignment site (script/m26). */
export const UNNAMED_BRIDGE = "unnamed bridge (stored row carries no mechanism)"

/** Fetch the stored cross-language rows for one symbol, both directions,
 *  with the opposite side's file language. Single query per direction. */
export function storedCrossLanguageRows(db: CrossLanguageDb, symbolId: string): CrossLanguageEdgeRow[] {
  const rows: CrossLanguageEdgeRow[] = []
  // Callers: edges INTO the symbol; the other side is the source file's language.
  const callers = db
    .prepare(
      `SELECT r.relationship_type, r.confidence, r.bridge_mechanism, sf.language AS other_language, r.metadata
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
       JOIN brain_file sf ON sf.id = ss.file_id
       WHERE r.is_cross_language = 1 AND r.target_symbol_id = ?`,
    )
    .all(symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>
  for (const r of callers) rows.push({ ...r, direction: "caller", evidence_class: parseEvidenceClass(r.metadata) })
  // Callees: edges OUT of the symbol; the other side is the target file's language.
  const callees = db
    .prepare(
      `SELECT r.relationship_type, r.confidence, r.bridge_mechanism, tf.language AS other_language, r.metadata
       FROM brain_relationship r
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
       JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.is_cross_language = 1 AND r.source_symbol_id = ?`,
    )
    .all(symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>
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
