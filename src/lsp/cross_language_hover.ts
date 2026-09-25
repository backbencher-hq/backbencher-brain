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
