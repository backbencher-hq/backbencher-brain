// src/lsp/evidence_tier.ts — M55.T5 (issue #774, §14 Truth Rule 1: one
// surface, one answer).
//
// The SINGLE owner of the evidence-tier vocabulary and the tier derivation
// rule on the server side. Before this module the same stored row was
// classified in three places with three different answers (found live by the
// M55.T5 step-zero wire probe):
//
//   src/lsp/hover.ts               `imports` -> "indexed"   (legacy bucket)
//   src/lsp/cross_language_hover.ts `imports` -> "import_based" (W4 rule)
//   script/m26/graph-core.ts       `imports` -> "import_based" (W4 legend)
//
// so one symbol's hover card could read `evidence: indexed, structural` while
// the hub rendered the SAME rows as `structural · 0.9` and the legend declared
// a five-tier vocabulary that does not contain "indexed". A vocabulary that
// changes per surface is not a vocabulary.
//
// Two decisions, both declared:
//
//   VOCABULARY (one vocabulary, the legend's). The emitted set is EXACTLY the
//   legend's five tiers plus the declared `unknown` — no more. A stored
//   evidenceClass is a tier CLAIM only when it is one of those five; the
//   legacy labels the index still carries (`indexed`, `semantic_candidate`)
//   are then not claims at all, so the row's own kind decides (which is more
//   informative, and is what M29.R5's STRICT fixture expectation already
//   declares). The pre-T5 hover emitted `indexed` for a stored legacy label,
//   which is a tier the legend does not contain — a badge vocabulary that
//   cannot be rendered is not a vocabulary. `unknown` is the declared answer
//   when a symbol carries no rows at all: a surface that cannot determine a
//   tier says so; it never guesses one.
//
//   RULE (one derivation, one place). The W4/M29.R5 rule — the SAME rule the
//   webview legend is built from:
//     1. a STORED legend-tier evidenceClass wins (the analyzer's own
//        classification; never re-derived, never re-upgraded);
//     2. the structural set at confidence >= 0.7 is `structural` — below the
//        floor the edge is a guess and MUST read `inferred` (the 0.7 floor
//        mirrors the inheritance threshold in src/intelligence/patterns.ts);
//     3. `import(s)` -> import_based, `reference(s)`/`use(s)`/`usage` ->
//        usage_contextual, `references_qualified` -> reference_qualified
//        (the W4 legend vocabulary — this is what removed the legacy
//        "indexed" answer the hover used to give for those kinds);
//     4. any other kind reads `inferred` — the legend's own wording for a
//        heuristic classification (see TIER_MEANINGS: "a guess … treat as a
//        hint, never as fact").
//
//   ORDER (one ranking, one primary). The declared order is the legend's
//   order (script/m26/graph-core.ts EDGE_TIERS, strongest first). A symbol's
//   tier LIST is deduplicated and sorted by that order, and its PRIMARY tier
//   (`provenance.evidenceClass`) is the first member of that list — so the
//   primary can never disagree with the list. The pre-T5 code sorted
//   alphabetically and took `tiers[0]`, which made `indexed` (alphabetically
//   first) the reported primary of a symbol whose only real evidence was
//   `structural` — the defect issue #774 names.
//
// The webview core is import-pure by contract (script/m26/verify-webview-core
// P1: zero imports), so it cannot import this module; it mirrors the rule and
// the vocabulary, and script/m55/verify-tiers.ts drift-gates the mirror at
// SOURCE level (it extracts EDGE_TIERS from the core's source and compares it
// to EVIDENCE_TIERS here — the same pattern the W4 verifier uses for the
// hover gloss). The mirror is declared, asserted, and detected on drift; it
// is never a second opinion.

/** The declared vocabulary, in the legend's order (strongest first). Mirrors
 *  script/m26/graph-core.ts EDGE_TIERS — drift-gated by script/m55/
 *  verify-tiers.ts T5-P4 (source-level, not by duplication in the gate). */
export const EVIDENCE_TIERS = [
  "structural",
  "import_based",
  "usage_contextual",
  "reference_qualified",
  "inferred",
] as const

export type LegendTier = (typeof EVIDENCE_TIERS)[number]

/** Declared UNCLAIMED store labels (M55.T5): labels the index can still
 *  carry that are NOT tier claims — an analyzer that stored one declined to
 *  classify the row, so the row's kind decides (see the header). Declared
 *  here so the decision is visible and so script/m55/verify-tiers.ts can
 *  assert it is deliberate rather than an oversight. */
export const UNCLAIMED_STORE_LABELS = ["indexed", "semantic_candidate"] as const

export type EvidenceTier = LegendTier | "unknown"

/** The declared rank: legend order, then the declared unknown. One table —
 *  ordering and primary both read it. */
const TIER_RANK: Record<EvidenceTier, number> = {
  structural: 0,
  import_based: 1,
  usage_contextual: 2,
  reference_qualified: 3,
  inferred: 4,
  unknown: 5,
}

/** Relationship kinds that are parser-deterministic structure. The union of
 *  the W4 legend set and the containment/exports/instantiates facts the
 *  analyzers stamp structural (M29.R5). */
const STRUCTURAL_KINDS: ReadonlySet<string> = new Set([
  "call",
  "calls",
  "extends",
  "inherits",
  "implements",
  "overrides",
  "override",
  "contains",
  "exports",
  "instantiates",
])

/** The declared 0.7 floor (see header). */
export const STRUCTURAL_FLOOR = 0.7

const IMPORT_KINDS: ReadonlySet<string> = new Set(["import", "imports"])
const USAGE_CONTEXT_KINDS: ReadonlySet<string> = new Set(["reference", "references", "use", "uses", "usage"])
const REFERENCE_QUALIFIED_KINDS: ReadonlySet<string> = new Set(["references_qualified", "reference_qualified"])

/** A stored evidence class is a CLAIM only when it is a legend tier. Any
 *  other stored value (the unclaimed labels, free text, an empty string) is
 *  not tier evidence and falls through to derivation — never a free-text
 *  tier, and never a tier the legend cannot render. */
export function isDeclaredTier(value: string): value is LegendTier {
  return (EVIDENCE_TIERS as readonly string[]).includes(value)
}

/** THE derivation rule. One row in, one tier out. Every server surface calls
 *  this (or `classifyStoredRow`) — there is no second derivation. */
export function classifyTier(row: {
  relationshipType: string
  confidence: number | null
  /** stored metadata.evidenceClass, already parsed — null when none */
  evidenceClass: string | null
}): EvidenceTier {
  const stored = row.evidenceClass
  if (stored !== null && isDeclaredTier(stored)) return stored

  const t = row.relationshipType.trim().toLowerCase()
  if (STRUCTURAL_KINDS.has(t)) return (row.confidence ?? 0) >= STRUCTURAL_FLOOR ? "structural" : "inferred"
  if (IMPORT_KINDS.has(t)) return "import_based"
  if (USAGE_CONTEXT_KINDS.has(t)) return "usage_contextual"
  if (REFERENCE_QUALIFIED_KINDS.has(t)) return "reference_qualified"
  return "inferred"
}

/** The stored shape every surface reads (`brain_relationship` columns). The
 *  metadata parse lives HERE so no caller re-implements it — unreadable
 *  metadata is not evidence and falls through to derivation. */
export interface StoredTierRow {
  relationship_type: string
  confidence: number | null
  metadata?: string | null
}

export function evidenceClassOf(metadata: string | null | undefined): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const cls = (parsed as { evidenceClass?: unknown }).evidenceClass
    return typeof cls === "string" ? cls : null
  } catch {
    return null
  }
}

export function classifyStoredRow(row: StoredTierRow): EvidenceTier {
  return classifyTier({
    relationshipType: row.relationship_type,
    confidence: row.confidence,
    evidenceClass: evidenceClassOf(row.metadata),
  })
}

/** Deduplicate + order a tier collection by the declared rank. The order is
 *  stable and declared — never alphabetical, never insertion-order. */
export function orderTiers(tiers: Iterable<EvidenceTier>): EvidenceTier[] {
  const set = new Set<EvidenceTier>()
  for (const t of tiers) set.add(t)
  return [...set].sort((a, b) => TIER_RANK[a] - TIER_RANK[b])
}

/** The declared primary: the strongest tier the symbol actually carries, by
 *  the declared rank. Always a member of the list it describes (empty list ->
 *  the declared `unknown`), so a primary can never contradict its list. */
export function primaryTier(tiers: readonly EvidenceTier[]): EvidenceTier {
  if (tiers.length === 0) return "unknown"
  return orderTiers(tiers)[0]!
}

/** A symbol's tier set: derived once from its stored rows. This is the whole
 *  of the symbol-tier decision — hover's `evidenceTiers`, the hub row chips
 *  and the legend all describe this same set. */
export function symbolTierSet(rows: readonly StoredTierRow[]): EvidenceTier[] {
  return orderTiers(rows.map(classifyStoredRow))
}
