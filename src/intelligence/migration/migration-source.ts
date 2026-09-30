// src/intelligence/migration/migration-source.ts
//
// The migration planner's own view of the index.
//
// WHY THIS EXISTS. The planner used to call
// `CrossLanguageIntelligence.analyzePolyglotProjectFromDB`, which selects EVERY
// symbol, EVERY relationship and EVERY taint flow for the project, reconstructs
// all of them, and then hands the planner four columns per relationship. Measured
// on cobra (1216 symbols / 5228 relationships): one `bb_migrate` call cost
// 2342 ms for a single symbol, flat in the request size because the cost was the
// load, not the request — and the generated tool page nonetheless claimed
// "dependency traversal is bounded".
//
// The four columns were also the wrong four. `brain_relationship` carries
// fourteen. Dropped by the generic bridge and needed by a migration plan:
//
//   line_number       4738/5228 (90.6%) on cobra, 6691/7072 (94.6%) on flask
//   confidence        5228/5228 (100%), 6 distinct values on cobra
//   is_cross_language 118 on cobra, 175 on flask
//   bridge_mechanism  "name-resolution" on both
//   is_cross_file     1541 on cobra, 2016 on flask
//   source_external / target_external — the unresolved-endpoint names
//
// A cross-language migration tool that cannot see whether an edge crosses a
// language boundary, cannot see how it is bridged, and cannot see which line the
// edge sits on, is not reporting its subject.
//
// SCOPE. Deliberately separate from `analyzePolyglotProjectFromDB` rather than a
// widening of it: that function is shared with the topology, security, data-flow
// and performance analyses, and changing what it returns for all of them to serve
// one caller is how one lane's requirement becomes four lanes' regression. This
// loader reads only the requested symbols and the relationships that touch them.
//
// WHAT IS DELIBERATELY NOT HERE. Per-symbol import evidence. The index does not
// record the imports a file performs, and a candidate extraction from
// `target_external` was measured and rejected (43.5% precision / 12.6% recall on
// Python, zero signal on Go and Rust) — see reviews/migrate/REVIEW.md, "REJECTED".
// The planner states the absence instead of filling it.

import { BrainDatabase } from "../../brain/database"

export interface MigrationSymbol {
  id: string
  name: string
  /** The indexer's raw `symbol_type` ("function", "class", "method", …). */
  type: string
  language: string
  file: string
}

export interface MigrationRelationship {
  id: string
  sourceSymbolId: string | null
  targetSymbolId: string | null
  /** Set when the endpoint is not an indexed symbol — the name the indexer saw. */
  sourceExternal: string | null
  targetExternal: string | null
  type: string
  /** The indexer's own 0–1 confidence. This is a measurement; it is not strength. */
  confidence: number | null
  line: number | null
  isCrossLanguage: boolean
  bridgeMechanism: string | null
  isCrossFile: boolean
}

export interface MigrationContext {
  /** Every indexed symbol matching a requested name (case-insensitive). */
  requestedSymbols: MigrationSymbol[]
  /** Relationships touching any requested symbol, in both directions. */
  relationships: MigrationRelationship[]
  /** Endpoint display names for ids referenced by those relationships. */
  nameById: Map<string, string>
  fileById: Map<string, string>
  /** Rows the index holds for this project, for scale reporting. */
  projectScale: { symbols: number; relationships: number }
}

/** Chunked `IN (…)` binding. SQLite's default limit is 999 variables. */
function chunk<T>(items: T[], size = 400): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const placeholders = (n: number) => new Array(n).fill("?").join(",")

/**
 * Load exactly what the requested symbols need: the symbols themselves, the
 * relationships that touch them, and the display names of those relationships'
 * other endpoints.
 */
export async function loadMigrationContext(projectId: string, requestedNames: string[]): Promise<MigrationContext> {
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const names = [...new Set(requestedNames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))]

  if (names.length === 0) {
    return {
      requestedSymbols: [],
      relationships: [],
      nameById: new Map(),
      fileById: new Map(),
      projectScale: { symbols: 0, relationships: 0 },
    }
  }

  const requestedSymbols: MigrationSymbol[] = []
  for (const group of chunk(names)) {
    const rows = raw
      .prepare(
        `SELECT s.id AS id, s.name AS name, s.symbol_type AS type,
                COALESCE(f.language, 'unknown') AS language,
                COALESCE(f.relative_path, 'unknown') AS file
         FROM brain_symbol s
         LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND lower(s.name) IN (${placeholders(group.length)})
         ORDER BY s.name, s.file_id`,
      )
      .all(projectId, ...group) as any[]
    requestedSymbols.push(...rows)
  }

  const requestedIds = [...new Set(requestedSymbols.map((s) => s.id))]

  // The display names and files of the requested symbols themselves. The far-endpoint
  // pass below only fills in ids it has NOT already seen, so leaving these two maps
  // empty here made every evidence row for the planned symbol itself resolve to
  // "unknown" — and therefore made a test-file call site indistinguishable from an
  // edge with no file at all.
  const nameById = new Map<string, string>()
  const fileById = new Map<string, string>()
  for (const symbol of requestedSymbols) {
    nameById.set(symbol.id, symbol.name)
    fileById.set(symbol.id, symbol.file)
  }

  const relationships: MigrationRelationship[] = []
  const seen = new Set<string>()
  for (const group of chunk(requestedIds)) {
    const rows = raw
      .prepare(
        `SELECT id, source_symbol_id, target_symbol_id, source_external, target_external,
                relationship_type, confidence, line_number, is_cross_language,
                bridge_mechanism, is_cross_file
         FROM brain_relationship
         WHERE project_id = ?
           AND (source_symbol_id IN (${placeholders(group.length)})
                OR target_symbol_id IN (${placeholders(group.length)}))
         ORDER BY id`,
      )
      .all(projectId, ...group, ...group) as any[]
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      relationships.push({
        id: r.id,
        sourceSymbolId: r.source_symbol_id ?? null,
        targetSymbolId: r.target_symbol_id ?? null,
        sourceExternal: r.source_external ?? null,
        targetExternal: r.target_external ?? null,
        type: r.relationship_type,
        confidence: typeof r.confidence === "number" ? r.confidence : null,
        line: typeof r.line_number === "number" ? r.line_number : null,
        isCrossLanguage: r.is_cross_language === 1 || r.is_cross_language === true,
        bridgeMechanism: r.bridge_mechanism ?? null,
        isCrossFile: r.is_cross_file === 1 || r.is_cross_file === true,
      })
    }
  }

  // Resolve the far endpoints of those relationships. One bounded pass, not a
  // scan of the project's symbol table per edge.
  const endpointIds = new Set<string>()
  for (const r of relationships) {
    for (const id of [r.sourceSymbolId, r.targetSymbolId]) if (id && !nameById.has(id)) endpointIds.add(id)
  }
  for (const group of chunk([...endpointIds])) {
    if (!group.length) continue
    for (const r of raw
      .prepare(
        `SELECT s.id AS id, s.name AS name, COALESCE(f.relative_path, 'unknown') AS file
         FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.id IN (${placeholders(group.length)})`,
      )
      .all(projectId, ...group) as any[]) {
      nameById.set(r.id, r.name)
      fileById.set(r.id, r.file)
    }
  }

  const scale = raw
    .prepare(
      `SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols,
              (SELECT COUNT(*) FROM brain_relationship WHERE project_id = ?) AS relationships`,
    )
    .get(projectId, projectId) as any

  return {
    requestedSymbols,
    relationships,
    nameById,
    fileById,
    projectScale: { symbols: Number(scale?.symbols ?? 0), relationships: Number(scale?.relationships ?? 0) },
  }
}
