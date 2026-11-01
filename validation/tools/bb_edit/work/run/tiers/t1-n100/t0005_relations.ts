// src/lsp/relations.ts — M55.T3 (issue #772, §14 Truth Rule 1: one surface,
// one answer).
//
// The SINGLE owner of the relation vocabulary. Before this module, four
// surfaces answered "how many usages does this symbol have" with four
// different numbers on the same index (found live by the M55.T3 step-zero
// wire probe):
//
//   hover `usageCount`            6  (every row touching the symbol, both
//                                     directions, undeduplicated)
//   hover `connected:`            3  (incoming call rows only)
//   hover `usages` list           6  (both directions — including the owning
//                                     class declaration and callees)
//   bb/graph callers              3
//   textDocument/references       7  (both directions + the declaration)
//
// The vocabulary is one word: a USAGE SITE is a stored relationship row whose
// TARGET is this symbol (someone references it) and whose kind is not a
// declaration containment. Two consequences fall out of that one sentence:
//
//   1. A declaration is never a usage. `Greeter contains greet` is how greet
//      is DECLARED, not how it is used — the hover's list must not offer the
//      owning class as a "usage" (it did), and neither may the hub's caller
//      list (it did; found by the T3 gate on the merged branch).
//   2. A callee is never a usage OF the symbol. `greetAll calls greet` is a
//      usage OF greet and a connection FROM greetAll; for greetAll that same
//      row is its callee, and it must not appear in greetAll's usages list
//      (it did, while greetAll's caller set was empty).
//
// A zero-caller symbol therefore renders `0 usages` and NO list — declared
// absence, never its callees or its class (§14 Truth Rule 1; T3 acceptance 3).
//
// `countUsageSites` is a second, INDEPENDENT implementation of the same
// rule (SQL, no row materialization). The M55.T3 gate asserts the two agree
// on a real index — a differential, not a duplicated constant.
//
// THE SECOND WORD, added by the M55.T3 integration: what a COUNT counts.
//
// The rule above defines a stored ROW as the unit of vocabulary. It does not
// say what a number on a surface counts, and two answers were live at once:
//
//   `textDocument/references` keyed its dedupe on `path:line:rowId` — one
//   location per stored ROW. hover's collector and this count keyed on the
//   served POSITION. On the M55.T3 fixture they read 4 and 3 for the same
//   symbol, which §14 rule 1 forbids.
//
// Measurement settled which was wrong, on five real populated indexes: the
// rowId key's only effect was to serve byte-identical duplicate locations
// (8,285 such positions on project 818db37d, 2,417 on 064be526, 684 on
// 99c211a1; 99.5% of them two rows of DIFFERENT relationship kinds for one
// caller at one stored line). The store cannot even produce two rows at one
// stored line through its primary writer — the row id keys on the call-site
// line (src/ast/parallel-indexer.ts:4147, INSERT OR IGNORE), which a real
// `bb index` run confirmed: two calls to one callee on ONE line produce ONE
// row; on two DIFFERENT lines, two rows.
//
// So:
//
//   A COUNT COUNTS SERVED POSITIONS — the places the index can put an editor
//   caret — not stored rows and not symbols.
//
// and the rows that share a position are DECLARED, never dropped and never
// double-served (§13.1 one row per place, §13.2 nothing merged into silence).
// `ReferencesResult.coalescedRows` carries that count; the hub's payload
// carries its own excluded-row classes in `declaredExclusions`. Both are the
// only places either surface legitimately differs from another, and both say
// so on the wire.

/** Relationship kinds that declare a symbol rather than refer to it. Both
 *  spellings the index carries (`contains` is written by every analyzer;
 *  `exports` by the container/module rows). */
export const DECLARATION_RELATIONSHIPS: ReadonlySet<string> = new Set(["contains", "exports"])

/** True when the stored kind is a DECLARATION containment edge (the row says
 *  "this symbol declares that one"), never a usage. Case-insensitive: the
 *  index carries `contains` and, from older writers, `Contains`. */
export function isDeclarationRelationship(relationshipType: string): boolean {
  return DECLARATION_RELATIONSHIPS.has(relationshipType.trim().toLowerCase())
}

export type RelationDirection = "incoming" | "outgoing" | "self" | "unrelated"

/** Which end of a stored row this symbol sits on. `incoming` = the symbol is
 *  the target (someone references it); `outgoing` = the symbol is the source
 *  (it references something else). A row touching neither end cannot happen
 *  for a correctly filtered query; it is reported as `unrelated` rather than
 *  guessed into a direction. */
export function relationDirection(
  row: { source_symbol_id: string | null; target_symbol_id: string | null },
  symbolId: string,
): RelationDirection {
  const isSource = row.source_symbol_id === symbolId
  const isTarget = row.target_symbol_id === symbolId
  if (isSource && isTarget) return "self"
  if (isTarget) return "incoming"
  if (isSource) return "outgoing"
  return "unrelated"
}

/** The vocabulary, in one predicate over stored rows. */
export function isUsageSiteRow(
  row: { source_symbol_id: string | null; target_symbol_id: string | null; relationship_type: string },
  symbolId: string,
): boolean {
  return relationDirection(row, symbolId) === "incoming" && !isDeclarationRelationship(row.relationship_type)
}

/** A collected site (rich_hover's RichSite, or any site-shaped record): the
 *  classification is the SAME rule as `isUsageSiteRow`, expressed over the
 *  already-resolved site (`reversed` = the hovered symbol is the row's
 *  target). One rule, two shapes. */
export interface ClassifiableSite {
  /** true when the hovered symbol is the row's TARGET (incoming edge) */
  reversed: boolean
  /** relationship_type as the analyzer wrote it */
  relationshipType: string
}

export function isUsageSite(site: ClassifiableSite): boolean {
  return site.reversed === true && !isDeclarationRelationship(site.relationshipType)
}

/** The same rule over a site that carries SEVERAL stored kinds (rich_hover's
 *  `relationshipTypes`). A location reached by both a declaration row and a
 *  usage row IS a usage site — the usage row is the fact that makes it one — and
 *  the declaration is rendered by the containment section beside it rather than
 *  being merged into silence (§13.2). One rule, two shapes: the single-kind form
 *  delegates here so the two can never disagree.
 *
 *  Before this, a collected site kept only its FIRST stored kind, so a location
 *  reached by `uses` and then `contains` was classified by whichever row the
 *  collector happened to read first — row ORDER deciding the vocabulary, which
 *  is the mirror of the two-surfaces-one-answer defect §14 rule 1 names. */
export function isUsageSiteAnyKind(site: ClassifiableSite & { relationshipTypes?: readonly string[] }): boolean {
  const kinds = site.relationshipTypes
  if (site.reversed !== true) return false
  if (kinds === undefined || kinds.length === 0) return isUsageSite(site)
  return kinds.some((k) => !isDeclarationRelationship(k))
}

/** THE collection: the usage sites of a symbol, in the input's stored order.
 *  Every count and every list on every surface is this array (or its
 *  length) — there is no second filter in the codebase. */
export function usageSites<T extends ClassifiableSite & { relationshipTypes?: readonly string[] }>(sites: readonly T[]): T[] {
  return sites.filter(isUsageSiteAnyKind)
}

/** The copy every surface uses to declare WHAT it counted, so a surface that
 *  legitimately answers a different question can say so instead of looking
 *  like a disagreement (§14 Truth Rule 1, second half). */
export const USAGE_SITE_FILTER_LABEL = "usage sites only; declaration and callees excluded"

/** What a usage COUNT counts — the second half of the vocabulary, and the half
 *  the M55.T3 integration had to add. Stated here so every surface quotes the
 *  same sentence rather than each paraphrasing "usages" in its own words, which
 *  is how four numbers for one symbol happened in the first place. */
export const USAGE_COUNT_UNIT_LABEL =
  "counted once per place: usage sites that resolve to the same file and line count as one, and the shared rows are reported separately"

/** Minimal db surface for the independent count (structural: stubbable). */
export interface UsageCountDb {
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

/**
 * The same vocabulary as SQL — an independent implementation (no row
 * materialization, no location resolution) used as a differential check by
 * the M55.T3 gate and as the scale-safe counter.
 *
 * Mirrors `richSitesForSymbol`'s eligibility exactly:
 *   - the symbol is the row's TARGET, and not also its source (self-loops are
 *     analyzer artifacts, not usages — the collector skips them);
 *   - the kind is not a declaration containment;
 *   - the OTHER end is a real indexed symbol whose location resolves
 *     (path + line + byte columns present — the collector renders no site
 *     without a clickable, index-stored location, §12.1);
 *   - the row is POSITIONED, by the ONE address owner's rule restated in SQL
 *     (below): a positive-integer stored line is the call site, and anything
 *     else the owner would leave `unknown` is omitted here too;
 *   - one distinct SERVED POSITION counts once.
 *
 * THE KEY IS THE SERVED POSITION, and this is the correction that measurement
 * forced (M55.T3, integration/lsp-truth). The first version of this query
 * deduped on `o.line_start || ':' || o.byte_start` — the CALLER's DECLARATION.
 * That was true until M59/#822 made `brain_relationship.line_number` a real
 * call-site line and M62 §2 made every surface serve it: from then on the two
 * keys disagree, and this count became the number that is wrong. Measured on
 * five real, populated indexes, this query's key vs the key the collector
 * actually serves (`(target, served position)` groups):
 *
 *     project   relationships   this key   served key   shortfall
 *     064be526         52,597      18,155      26,168       8,013  (31%)
 *     853d59ab        145,511      57,432      82,588      25,156  (30%)
 *     99c211a1        160,007      61,368      93,837      32,469  (35%)
 *     818db37d        766,227      99,053     151,521      52,468  (35%)
 *     6f461b7b        653,827      83,584     126,881      43,297  (34%)
 *
 * So a third to a third-and-a-half of every real usage set was invisible to
 * this counter while the hover rendered every one of those rows — §13.4
 * ("counts equal what is rendered") broken on all five, and invisible to the
 * M55.T3 fixture because that fixture stores `line_number = NULL` on every row,
 * where the two keys coincide by construction. A differential that cannot fail
 * is not a differential.
 *
 * The restatement of the owner's rule, in SQL, term by term
 * (`classifyStoredLine` / `deriveCallSiteAddress`, src/intelligence/graph/
 * line-address.ts):
 *   stored line positive integer  -> the call site; served (file, line, 0),
 *                                     because the store carries no column for
 *                                     a call site (the address is line-only BY
 *                                     DECLARATION, so every one of them starts
 *                                     at character 0)
 *   stored line NULL or legacy 0  -> the caller's declaration substitute, when
 *                                     that declaration line is itself a
 *                                     positive integer; served (file, decl line,
 *                                     decl byte column)
 *   stored line present and NOT a positive integer (negative, fractional, NaN,
 *   Infinity, non-numeric)      -> the owner refuses to substitute; the row is
 *                                     OMITTED by the surfaces, so it is omitted
 *                                     here. Counting it would put a usage in
 *                                     the header that no list can show.
 *   ...and the caller has no positive-integer declaration line -> likewise
 *   omitted (`unknown`).
 *
 * DECLARED LIMIT OF THE RESTATEMENT (not a silent gap): this query cannot read
 * the source, so it cannot apply `resolveRowByteColumns`. A row whose stored
 * byte columns do not convert against the file on disk is counted here and
 * dropped by the collector — the difference `isResolvableUsageSiteRow` exists to
 * let a caller see. That case is measured and declared; it is not the case
 * fixed here, which was a 30–35% systematic shortfall.
 *
 * Scale shape (M29.R3): one indexed reverse probe with a join, no OR-scan.
 */
export function countUsageSites(db: UsageCountDb, symbolId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT DISTINCT
            f.path || ':' ||
            (CASE WHEN ${STORED_LINE_IS_EXACT_SQL} THEN r.line_number ELSE o.line_start END) || ':' ||
            (CASE WHEN ${STORED_LINE_IS_EXACT_SQL} THEN 0 ELSE o.byte_start END) AS site
         FROM brain_relationship r
         JOIN brain_symbol o ON o.id = r.source_symbol_id
         JOIN brain_file f ON f.id = o.file_id
         WHERE r.target_symbol_id = ?
           AND r.source_symbol_id <> r.target_symbol_id
           AND LOWER(r.relationship_type) NOT IN ('contains', 'exports')
           AND o.line_start IS NOT NULL AND o.line_end IS NOT NULL
           AND o.byte_start IS NOT NULL AND o.byte_end IS NOT NULL
           AND (${STORED_LINE_IS_EXACT_SQL} OR (${STORED_LINE_IS_ABSENT_SQL} AND ${DECLARATION_LINE_IS_EXACT_SQL}))
       )`,
    )
    .get(symbolId) as { c: number } | undefined
  return row?.c ?? 0
}

/** The stored call-site line IS an exact address: a real integer position.
 *  `typeof` is in the predicate on purpose — SQLite orders numbers before
 *  text, so a corrupted TEXT column would satisfy `> 0` on its own, and the
 *  owner classifies every non-integer as `unusable` (a store-contract
 *  violation it refuses to substitute for). */
const STORED_LINE_IS_EXACT_SQL = "typeof(r.line_number) = 'integer' AND r.line_number > 0"

/** The store's two DECLARED unknown states: never stored, and the legacy `0`
 *  literal. These are the only states for which a substitute is permitted. */
const STORED_LINE_IS_ABSENT_SQL =
  "(r.line_number IS NULL OR (typeof(r.line_number) = 'integer' AND r.line_number = 0))"

/** The substitute the owner is permitted to serve, and only when the caller's
 *  own declaration line is itself a position. */
const DECLARATION_LINE_IS_EXACT_SQL = "typeof(o.line_start) = 'integer' AND o.line_start > 0"

/**
 * The SAME eligibility rule, in the collector's shape — for the audit and for
 * any caller that must answer "would this row render?" without materializing
 * the site. It exists because lane 6 measured the collector DROPPING a row the
 * SQL count still counts (a stored byte column landing mid-code-point, where
 * navigation.edgeLocation throws instead of returning null), and a count that
 * disagrees with the list is exactly the defect §14 rule 1 names. A caller
 * comparing the two MUST apply the same predicate to both sides.
 */
export function isResolvableUsageSiteRow(
  row: { otherName?: string | null; otherPath?: string | null; byteStart?: number | null; byteEnd?: number | null; lineStart?: number | null; lineEnd?: number | null },
): boolean {
  return (
    typeof row.otherName === "string" && row.otherName.length > 0 &&
    typeof row.otherPath === "string" && row.otherPath.length > 0 &&
    row.byteStart !== null && row.byteStart !== undefined &&
    row.byteEnd !== null && row.byteEnd !== undefined &&
    row.lineStart !== null && row.lineStart !== undefined &&
    row.lineEnd !== null && row.lineEnd !== undefined
  )
}
