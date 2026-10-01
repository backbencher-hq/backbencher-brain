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
  /**
   * What each requested path actually matched. A path that matches nothing is
   * REPORTED, not silently dropped: an empty plan set from a typo is the worst
   * possible way for a cohort request to fail.
   */
  pathResolution: {
    paths: string[]
    /** Number of indexed symbols the paths contributed. */
    matched: number
    /** Requested paths that matched no indexed file. */
    unmatched: string[]
    /** Distinct files the paths covered. */
    files: string[]
  }
  /** Relationships touching any requested symbol, in both directions. */
  relationships: MigrationRelationship[]
  /** Endpoint display names for ids referenced by those relationships. */
  nameById: Map<string, string>
  fileById: Map<string, string>
  /** Rows the index holds for this project, for scale reporting. */
  projectScale: { symbols: number; relationships: number }
  /**
   * How much of the graph this call actually READ. The bound is a property of the
   * design, not of the machine, so it has to be observable: a wall-clock claim
   * about "it did not load everything" is a load-dependent assertion that passes
   * on a quiet machine and fails on a busy one. `relationshipsLoaded` next to the
   * project's own total is checkable anywhere.
   */
  work: { symbolsLoaded: number; relationshipsLoaded: number }
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
/**
 * Resolve project-relative file or DIRECTORY paths to the symbols they contain.
 *
 * A path matches a file when it is that file, or when it is a directory prefix
 * of it. Comparison is on the project-relative path with `/` separators, because
 * that is what the index stores and what the caller wrote.
 *
 * Deterministic order: by file path, then by the symbol's line. The cohort
 * order is the SELECTION order, so when the request cap drops names the ones
 * that survive are the first in file order rather than whatever the database
 * happened to return — and the rule is reported in `truncation.selection`.
 */
export async function loadMigrationSymbolsByPath(
  projectId: string,
  paths: string[],
): Promise<{ symbols: MigrationSymbol[]; unmatched: string[]; files: string[] }> {
  const empty = { symbols: [] as MigrationSymbol[], unmatched: [] as string[], files: [] as string[] }
  const cleaned = [...new Set(paths.map((p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "")))].filter(Boolean)
  if (cleaned.length === 0) return empty
  const raw = await BrainDatabase.getRawInstance(projectId as any)

  const symbols: MigrationSymbol[] = []
  const matchedFiles = new Set<string>()
  const unmatched: string[] = []
  for (const path of cleaned) {
    // The project root, named three ways. `.` used to match nothing at all,
    // because it became the prefix `.` and the LIKE pattern `./%` matches no
    // project-relative path — so the one request that means "everything" was
    // the one that silently returned nothing.
    const isProjectRoot = path === "." || path === "./" || path === "/"
    // A LIKE pattern with the prefix escaped, so `%` and `_` in a path are
    // literal and cannot match everything.
    const prefix = path.replace(/[%_]/g, (c) => `\\${c}`)
    const rows = raw
      .prepare(
        `SELECT s.id AS id, s.name AS name, s.symbol_type AS type, s.line_start AS line,
                COALESCE(f.language, 'unknown') AS language,
                COALESCE(f.relative_path, 'unknown') AS file
         FROM brain_symbol s
         JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ?
           ${isProjectRoot ? "" : "AND (f.relative_path = ? OR f.relative_path LIKE ? ESCAPE '\\')"}
         ORDER BY f.relative_path, s.line_start, s.name`,
      )
      .all(...(isProjectRoot ? [projectId] : [projectId, path, `${prefix}/%`])) as any[]
    if (rows.length === 0) {
      unmatched.push(path)
      continue
    }
    for (const r of rows) {
      matchedFiles.add(r.file)
      symbols.push({ id: r.id, name: r.name, type: r.type, language: r.language, file: r.file })
    }
  }
  // Overlapping paths (src/api and src/api/v1) can yield the same symbol twice.
  const unique = [...new Map(symbols.map((s) => [s.id, s])).values()]
  return { symbols: unique, unmatched, files: [...matchedFiles].sort() }
}

/** One symbol per id, de-duplicated by id. Ids are unique in a project, so there is
 * no resolution rule here and none is applied. */
function dedupeById(symbols: MigrationSymbol[]): MigrationSymbol[] {
  const seen = new Map<string, MigrationSymbol>()
  for (const symbol of symbols) seen.set(symbol.id, symbol)
  return [...seen.values()]
}

/**
 * Look symbols up by their INDEXED ID.
 *
 * An id is a name that cannot collide, which is the whole reason this exists: two
 * components can share a name in two different files, and the tool's own
 * ambiguity refusal tells the caller to re-run against a symbol id — an option
 * that did not exist until round 6 made that advice true.
 *
 * An id that matches nothing is RETURNED, never dropped: a typo'd id that
 * silently planned nothing would be indistinguishable from an empty module.
 */
async function loadMigrationSymbolsById(
  projectId: string,
  ids: string[],
): Promise<{ symbols: MigrationSymbol[]; unmatched: string[] }> {
  if (ids.length === 0) return { symbols: [], unmatched: [] }
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const symbols: MigrationSymbol[] = []
  const found = new Set<string>()
  for (const group of chunk(ids)) {
    const rows = raw
      .prepare(
        `SELECT s.id AS id, s.name AS name, s.symbol_type AS type,
                COALESCE(f.language, 'unknown') AS language,
                COALESCE(f.relative_path, 'unknown') AS file
         FROM brain_symbol s
         LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.id IN (${placeholders(group.length)})
         ORDER BY s.id`,
      )
      .all(projectId, ...group) as any[]
    for (const row of rows) {
      found.add(row.id)
      symbols.push({ id: row.id, name: row.name, type: row.type, language: row.language, file: row.file })
    }
  }
  return { symbols, unmatched: ids.filter((id) => !found.has(id)) }
}

/**
 * PHASE 1 — resolve the request to a symbol list, WITHOUT loading any
 * relationship.
 *
 * Split out because a cohort can be a whole directory while the request is
 * capped at 100 symbols. Resolving and then loading in one pass would read
 * every relationship of every symbol in the cohort — thousands — to plan 100 of
 * them, which is the unbounded-load defect the bounded loader was written to
 * remove. Resolve, cap, THEN load.
 */
export async function resolveMigrationSymbols(
  projectId: string,
  requestedNames: string[],
  requestedPaths: string[] = [],
  requestedIds: string[] = [],
): Promise<{
  symbols: MigrationSymbol[]
  symbolsFromPaths: MigrationSymbol[]
  /** Resolved from an explicit `symbolIds` entry, not from a name or a path. */
  symbolsById: MigrationSymbol[]
  /** Requested ids that no indexed symbol carries, reported rather than dropped. */
  idsUnmatched: string[]
  pathResolution: MigrationContext["pathResolution"]
}> {
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const names = [...new Set(requestedNames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))]
  const ids = [...new Set(requestedIds.map((id) => String(id).trim()).filter(Boolean))]
  const fromPaths = await loadMigrationSymbolsByPath(projectId, requestedPaths)
  const pathResolution = {
    paths: requestedPaths.map((p) => String(p ?? "").trim()).filter(Boolean),
    matched: fromPaths.symbols.length,
    unmatched: fromPaths.unmatched,
    files: fromPaths.files,
  }
  const byId = await loadMigrationSymbolsById(projectId, ids)
  const symbolsById = byId.symbols
  const idsUnmatched = byId.unmatched
  if (names.length === 0) {
    const all = dedupeById([...fromPaths.symbols, ...symbolsById])
    return { symbols: all, symbolsFromPaths: fromPaths.symbols, symbolsById, idsUnmatched, pathResolution }
  }
  const symbols: MigrationSymbol[] = []
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
    symbols.push(...rows)
  }
  const all = dedupeById([...fromPaths.symbols, ...symbolsById, ...symbols])
  return {
    symbols: all.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)),
    // Tracked SEPARATELY from the union: a symbol named explicitly AND covered
    // by a path is contributed by the path, and a name-only request must report
    // zero path symbols. Reading provenance off the union cannot tell those
    // apart, which is why `symbolsFromPaths` exists.
    symbolsFromPaths: fromPaths.symbols,
    symbolsById,
    idsUnmatched,
    pathResolution,
  }
}

/**
 * PHASE 2 — the relationship pass, bounded by the ALREADY-CAPED symbol set.
 */
export async function loadMigrationContext(
  projectId: string,
  requestedNames: string[],
  requestedPaths: string[] = [],
): Promise<MigrationContext> {
  const { symbols: dedupedSymbols, pathResolution } = await resolveMigrationSymbols(projectId, requestedNames, requestedPaths)
  return loadMigrationContextForSymbols(projectId, dedupedSymbols, pathResolution)
}

/**
 * PHASE 2 — the relationship pass, given symbols that are ALREADY resolved.
 *
 * Identity is the symbol id, not the name. A cohort of a directory is resolved to
 * symbols; re-resolving those symbols by name afterwards lost the ones sharing a
 * name with another file's symbol (measured: 100 names, 209 symbols on a one-file
 * cobra cohort) and silently planned only the name-collisions' first match. The
 * relationship pass must read exactly the symbols the caller asked for.
 */
export async function loadMigrationContextForSymbols(
  projectId: string,
  dedupedSymbols: MigrationSymbol[],
  pathResolution?: MigrationContext["pathResolution"],
): Promise<MigrationContext> {
  const raw = await BrainDatabase.getRawInstance(projectId as any)

  const nameById = new Map<string, string>()
  const fileById = new Map<string, string>()
  for (const symbol of dedupedSymbols) {
    nameById.set(symbol.id, symbol.name)
    fileById.set(symbol.id, symbol.file)
  }

  const requestedIds = [...new Set(dedupedSymbols.map((s) => s.id))]

  // `nameById` / `fileById` above are seeded with the requested symbols. The
  // far-endpoint pass below only fills in ids it has NOT already seen, so an
  // empty seed here makes every evidence row for the planned symbol resolve to
  // "unknown" — and makes a test-file call site indistinguishable from an edge
  // with no file at all.

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
    requestedSymbols: dedupedSymbols,
    relationships,
    nameById,
    fileById,
    pathResolution: pathResolution ?? { paths: [], matched: 0, unmatched: [], files: [] },
    projectScale: { symbols: Number(scale?.symbols ?? 0), relationships: Number(scale?.relationships ?? 0) },
    work: { symbolsLoaded: dedupedSymbols.length, relationshipsLoaded: relationships.length },
  }
}
