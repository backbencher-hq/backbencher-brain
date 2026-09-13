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
//      owning class as a "usage" (it did).
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

/** THE collection: the usage sites of a symbol, in the input's stored order.
 *  Every count and every list on every surface is this array (or its
 *  length) — there is no second filter in the codebase. */
export function usageSites<T extends ClassifiableSite>(sites: readonly T[]): T[] {
  return sites.filter(isUsageSite)
}

/** The copy every surface uses to declare WHAT it counted, so a surface that
 *  legitimately answers a different question can say so instead of looking
 *  like a disagreement (§14 Truth Rule 1, second half). */
export const USAGE_SITE_FILTER_LABEL = "usage sites only; declaration and callees excluded"

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
 *   - one distinct location counts once (the collector dedups by
 *     path:line:character; the SQL dedups by path + the stored line/byte
 *     pair the location is built from).
 *
 * Scale shape (M29.R3): one indexed reverse probe with a join, no OR-scan.
 */
export function countUsageSites(db: UsageCountDb, symbolId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT DISTINCT f.path || ':' || o.line_start || ':' || o.byte_start AS site
         FROM brain_relationship r
         JOIN brain_symbol o ON o.id = r.source_symbol_id
         JOIN brain_file f ON f.id = o.file_id
         WHERE r.target_symbol_id = ?
           AND r.source_symbol_id <> r.target_symbol_id
           AND LOWER(r.relationship_type) NOT IN ('contains', 'exports')
           AND o.line_start IS NOT NULL AND o.line_end IS NOT NULL
           AND o.byte_start IS NOT NULL AND o.byte_end IS NOT NULL
       )`,
    )
    .get(symbolId) as { c: number } | undefined
  return row?.c ?? 0
}
