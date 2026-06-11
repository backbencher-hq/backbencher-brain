// Brain Query Layer — Centralized SQL queries for all MCP tools
// Every brain_* tool queries through these functions
// Optimized with parameterized queries, pagination, and compound indexes

import type Database from "better-sqlite3"

// ============================================================================
// TYPES
// ============================================================================

export interface SymbolResult {
  id: string
  name: string
  kind: string
  file_path: string
  relative_path: string
  language: string
  line_start: number
  line_end: number
  byte_start: number | null
  byte_end: number | null
  visibility: string
  is_static: number
  is_async: number
  complexity: number
  gravity_score: number
  layer: string
  parameters: string | null
  return_type: string | null
  docstring: string | null
}

export interface RelationshipResult {
  source_name: string
  source_file: string
  target_name: string
  target_file: string | null
  relationship_type: string
  line_number: number | null
  is_cross_file: number
}

export interface FileResult {
  id: string
  path: string
  relative_path: string
  language: string
  framework: string | null
  layer: string
  line_count: number
  size_bytes: number
  last_modified: number
  is_test: number
}

export interface StatsResult {
  files: number
  symbols: number
  relationships: number
  imports: number
  languages: string[]
  avgComplexity: number
}

// ============================================================================
// SYMBOL QUERIES
// ============================================================================

/**
 * Search symbols by name with optional filters.
 * Used by: brain_search
 */
export function searchSymbols(
  db: Database.Database,
  projectHash: string,
  query: string,
  options: {
    kind?: string
    language?: string
    filePath?: string
    exact?: boolean
    limit?: number
    offset?: number
  } = {},
): SymbolResult[] {
  const limit = options.limit || 50
  const offset = options.offset || 0

  let sql = `
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ?
  `
  const params: any[] = [projectHash]

  if (options.exact) {
    sql += ` AND s.name = ?`
    params.push(query)
  } else {
    sql += ` AND s.name LIKE ?`
    params.push(`%${query}%`)
  }

  if (options.kind) {
    sql += ` AND s.kind = ?`
    params.push(options.kind)
  }

  if (options.language) {
    sql += ` AND f.language = ?`
    params.push(options.language)
  }

  if (options.filePath) {
    sql += ` AND f.relative_path LIKE ?`
    params.push(`%${options.filePath}%`)
  }

  sql += ` ORDER BY s.gravity_score DESC, s.complexity DESC LIMIT ? OFFSET ?`
  params.push(limit, offset)

  return db.prepare(sql).all(...params) as SymbolResult[]
}

/**
 * Get a single symbol by name with exact byte bounds.
 * Used by: brain_select
 */
export function findSymbol(
  db: Database.Database,
  projectHash: string,
  name: string,
  filePath?: string,
  lineStart?: number,
): SymbolResult | null {
  let sql = `
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ? AND s.name = ?
  `
  const params: any[] = [projectHash, name]

  if (filePath) {
    sql += ` AND f.relative_path LIKE ?`
    params.push(`%${filePath.replace(/\\/g, "/")}%`)
  }

  if (lineStart !== undefined) {
    sql += ` AND s.line_start = ?`
    params.push(lineStart)
  }

  sql += ` ORDER BY s.gravity_score DESC LIMIT 1`

  return (db.prepare(sql).get(...params) as SymbolResult) || null
}

/**
 * Get all symbols in a file (for file outline).
 * Used by: brain_select (outline mode)
 */
export function getFileSymbols(
  db: Database.Database,
  projectHash: string,
  relativePath: string,
): SymbolResult[] {
  return db.prepare(`
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ? AND f.relative_path = ?
    ORDER BY s.line_start
  `).all(projectHash, relativePath) as SymbolResult[]
}

/**
 * Get symbols of specific kinds (functions, classes, etc.)
 * Used by: brain_search (scope filter)
 */
export function getSymbolsByKind(
  db: Database.Database,
  projectHash: string,
  kinds: string[],
  limit = 50,
  offset = 0,
): SymbolResult[] {
  const placeholders = kinds.map(() => "?").join(",")
  return db.prepare(`
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ? AND s.kind IN (${placeholders})
    ORDER BY s.gravity_score DESC LIMIT ? OFFSET ?
  `).all(projectHash, ...kinds, limit, offset) as SymbolResult[]
}

// ============================================================================
// RELATIONSHIP QUERIES
// ============================================================================

/**
 * Get direct callers of a symbol.
 * Used by: brain_relationships (callers mode)
 */
export function getCallers(
  db: Database.Database,
  projectHash: string,
  symbolId: string,
  limit = 20,
): RelationshipResult[] {
  return db.prepare(`
    SELECT src.name as source_name, sf.relative_path as source_file,
           tgt.name as target_name, tf.relative_path as target_file,
           r.relationship_type, r.line_number, r.is_cross_file
    FROM relationships r
    JOIN symbols src ON src.id = r.source_symbol_id AND src.project_hash = r.project_hash
    JOIN files sf ON sf.id = src.file_id
    LEFT JOIN symbols tgt ON tgt.id = r.target_symbol_id AND tgt.project_hash = r.project_hash
    LEFT JOIN files tf ON tf.id = tgt.file_id
    WHERE r.project_hash = ? AND r.target_symbol_id = ?
    ORDER BY src.gravity_score DESC
    LIMIT ?
  `).all(projectHash, symbolId, limit) as RelationshipResult[]
}

/**
 * Get direct callees of a symbol.
 * Used by: brain_relationships (callees mode)
 */
export function getCallees(
  db: Database.Database,
  projectHash: string,
  symbolId: string,
  limit = 20,
): RelationshipResult[] {
  return db.prepare(`
    SELECT src.name as source_name, sf.relative_path as source_file,
           tgt.name as target_name, tf.relative_path as target_file,
           r.relationship_type, r.line_number, r.is_cross_file
    FROM relationships r
    JOIN symbols src ON src.id = r.source_symbol_id AND src.project_hash = r.project_hash
    JOIN files sf ON sf.id = src.file_id
    LEFT JOIN symbols tgt ON tgt.id = r.target_symbol_id AND tgt.project_hash = r.project_hash
    LEFT JOIN files tf ON tf.id = tgt.file_id
    WHERE r.project_hash = ? AND r.source_symbol_id = ?
    ORDER BY tgt.gravity_score DESC
    LIMIT ?
  `).all(projectHash, symbolId, limit) as RelationshipResult[]
}

/**
 * Get all callers recursively (BFS with depth tracking).
 * Used by: brain_relationships (traceToRoot mode)
 */
export function getRecursiveCallers(
  db: Database.Database,
  projectHash: string,
  symbolName: string,
  maxDepth = 10,
  limit = 100,
): Array<{ name: string; file: string; depth: number }> {
  const results: Array<{ name: string; file: string; depth: number }> = []
  const visited = new Set<string>()
  let currentLevel = [symbolName]

  for (let depth = 0; depth < maxDepth && currentLevel.length > 0; depth++) {
    const nextLevel: string[] = []
    for (const name of currentLevel) {
      if (visited.has(name)) continue
      visited.add(name)

      const callers = db.prepare(`
        SELECT DISTINCT src.name as caller, sf.relative_path as file
        FROM relationships r
        JOIN symbols src ON src.id = r.source_symbol_id AND src.project_hash = r.project_hash
        JOIN files sf ON sf.id = src.file_id
        JOIN symbols tgt ON tgt.id = r.target_symbol_id AND tgt.project_hash = r.project_hash
        WHERE r.project_hash = ? AND tgt.name = ? AND r.relationship_type = 'calls'
        LIMIT 50
      `).all(projectHash, name) as Array<{ caller: string; file: string }>

      for (const c of callers) {
        results.push({ name: c.caller, file: c.file, depth })
        nextLevel.push(c.caller)
      }
    }
    currentLevel = nextLevel
    if (results.length >= limit) break
  }

  return results.slice(0, limit)
}

// ============================================================================
// FILE QUERIES
// ============================================================================

/**
 * Find files by path pattern.
 * Used by: brain_search (files scope)
 */
export function findFiles(
  db: Database.Database,
  projectHash: string,
  pattern: string,
  limit = 20,
): FileResult[] {
  return db.prepare(`
    SELECT id, path, relative_path, language, framework, layer,
           line_count, size_bytes, last_modified, is_test
    FROM files
    WHERE project_hash = ? AND relative_path LIKE ?
    ORDER BY line_count DESC
    LIMIT ?
  `).all(projectHash, `%${pattern}%`, limit) as FileResult[]
}

/**
 * Get file metadata by path.
 */
export function getFile(
  db: Database.Database,
  projectHash: string,
  relativePath: string,
): FileResult | null {
  return (db.prepare(`
    SELECT id, path, relative_path, language, framework, layer,
           line_count, size_bytes, last_modified, is_test
    FROM files
    WHERE project_hash = ? AND relative_path = ?
  `).get(projectHash, relativePath) as FileResult) || null
}

// ============================================================================
// IMPORT/EXPORT QUERIES
// ============================================================================

/**
 * Get imports for a file.
 * Used by: brain_relationships (imports mode)
 */
export function getFileImports(
  db: Database.Database,
  projectHash: string,
  relativePath: string,
  limit = 50,
) {
  return db.prepare(`
    SELECT i.imported_name, i.import_path, i.import_type, i.is_external, i.line_number,
           f.relative_path as file
    FROM imports i
    JOIN files f ON f.id = i.file_id
    WHERE i.project_hash = ? AND f.relative_path LIKE ?
    LIMIT ?
  `).all(projectHash, `%${relativePath}%`, limit)
}

/**
 * Get files that import a given file (dependents).
 */
export function getFileDependents(
  db: Database.Database,
  projectHash: string,
  relativePath: string,
  limit = 50,
) {
  return db.prepare(`
    SELECT i.imported_name, i.import_path, f.relative_path as dependent_file
    FROM imports i
    JOIN files f ON f.id = i.file_id
    WHERE i.project_hash = ? AND i.import_path LIKE ?
    LIMIT ?
  `).all(projectHash, `%${relativePath}%`, limit)
}

// ============================================================================
// FTS5 FULL-TEXT SEARCH
// ============================================================================

/**
 * Search file content using FTS5.
 * Used by: brain_search (content fallback)
 */
export function searchContent(
  db: Database.Database,
  projectHash: string,
  query: string,
  limit = 50,
): Array<{ file_path: string; line: number; snippet: string }> {
  const safeQuery = query.replace(/"/g, '""')
  const results: Array<{ file_path: string; line: number; snippet: string }> = []

  try {
    const matches = db.prepare(`
      SELECT f.relative_path as file_path, f.content as file_content
      FROM content_fts ft
      JOIN files f ON f.id = ft.file_id
      WHERE content_fts MATCH ? AND f.project_hash = ?
      LIMIT ?
    `).all(`"${safeQuery}"`, projectHash, limit) as Array<{ file_path: string; file_content: string | null }>

    for (const match of matches) {
      if (!match.file_content) continue
      const lines = match.file_content.split("\n")
      const searchLower = query.toLowerCase()
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLowerCase().includes(searchLower)) {
          const start = Math.max(0, lines[i]!.toLowerCase().indexOf(searchLower) - 20)
          results.push({
            file_path: match.file_path,
            line: i + 1,
            snippet: lines[i]!.substring(start, start + query.length + 40),
          })
          if (results.length >= limit) break
        }
      }
    }
  } catch {
    // FTS5 may not be available for all queries — return empty
  }

  return results
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get comprehensive project statistics.
 * Used by: brain_health
 */
export function getStats(db: Database.Database, projectHash: string): StatsResult {
  const fileCount = (db.prepare("SELECT count(*) as c FROM files WHERE project_hash = ?").get(projectHash) as any)?.c || 0
  const symbolCount = (db.prepare("SELECT count(*) as c FROM symbols WHERE project_hash = ?").get(projectHash) as any)?.c || 0
  const relCount = (db.prepare("SELECT count(*) as c FROM relationships WHERE project_hash = ?").get(projectHash) as any)?.c || 0
  const importCount = (db.prepare("SELECT count(*) as c FROM imports WHERE project_hash = ?").get(projectHash) as any)?.c || 0
  const avgComplexity = (db.prepare("SELECT avg(complexity) as c FROM symbols WHERE project_hash = ?").get(projectHash) as any)?.c || 0

  const languages = db.prepare(
    "SELECT DISTINCT language FROM files WHERE project_hash = ? AND language IS NOT NULL"
  ).all(projectHash) as Array<{ language: string }>

  return {
    files: fileCount,
    symbols: symbolCount,
    relationships: relCount,
    imports: importCount,
    languages: languages.map((l) => l.language),
    avgComplexity: Math.round(avgComplexity * 100) / 100,
  }
}

// ============================================================================
// COMPLEXITY & PATTERNS
// ============================================================================

/**
 * Get top N most complex functions.
 * Used by: brain_patterns (complexity mode)
 */
export function getMostComplex(
  db: Database.Database,
  projectHash: string,
  limit = 10,
): SymbolResult[] {
  return db.prepare(`
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ? AND s.kind IN ('function', 'method')
    ORDER BY s.complexity DESC
    LIMIT ?
  `).all(projectHash, limit) as SymbolResult[]
}

/**
 * Find orphaned symbols (no incoming relationships).
 * Used by: brain_patterns (orphaned mode)
 */
export function findOrphaned(
  db: Database.Database,
  projectHash: string,
  limit = 20,
): SymbolResult[] {
  return db.prepare(`
    SELECT s.id, s.name, s.kind, f.path as file_path, f.relative_path,
           f.language, s.line_start, s.line_end, s.byte_start, s.byte_end,
           s.visibility, s.is_static, s.is_async, s.complexity,
           s.gravity_score, s.layer, s.parameters, s.return_type, s.docstring
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ?
      AND s.kind IN ('function', 'method', 'class')
      AND s.id NOT IN (SELECT DISTINCT target_symbol_id FROM relationships WHERE project_hash = ? AND target_symbol_id IS NOT NULL)
      AND s.id NOT IN (SELECT DISTINCT source_symbol_id FROM relationships WHERE project_hash = ?)
    ORDER BY s.complexity DESC
    LIMIT ?
  `).all(projectHash, projectHash, projectHash, limit) as SymbolResult[]
}

/**
 * Get coupling heatmap (most connected classes).
 * Used by: brain_relationships (feature mode)
 */
export function getCouplingHeatmap(
  db: Database.Database,
  projectHash: string,
  limit = 20,
): Array<{ name: string; file: string; incoming: number; outgoing: number; score: number }> {
  return db.prepare(`
    SELECT s.name, f.relative_path as file,
           (SELECT count(*) FROM relationships r WHERE r.target_symbol_id = s.id AND r.project_hash = ?) as incoming,
           (SELECT count(*) FROM relationships r WHERE r.source_symbol_id = s.id AND r.project_hash = ?) as outgoing,
           (SELECT count(*) FROM relationships r WHERE (r.source_symbol_id = s.id OR r.target_symbol_id = s.id) AND r.project_hash = ?) as score
    FROM symbols s
    JOIN files f ON f.id = s.file_id AND f.project_hash = s.project_hash
    WHERE s.project_hash = ? AND s.kind = 'class'
    ORDER BY score DESC
    LIMIT ?
  `).all(projectHash, projectHash, projectHash, projectHash, limit) as any[]
}

// ============================================================================
// TAINT / SECURITY QUERIES
// ============================================================================

/**
 * Get all taint flows (security vulnerabilities).
 * Used by: brain_security
 */
export function getTaintFlows(
  db: Database.Database,
  projectHash: string,
  limit = 50,
) {
  return db.prepare(`
    SELECT t.id, t.source_symbol_id, t.sink_symbol_id, t.source_type, t.sink_type,
           t.vulnerability_type, t.severity, t.is_mitigated, t.flow_path,
           src.name as source_name, sf.relative_path as source_file,
           snk.name as sink_name, tnf.relative_path as sink_file
    FROM taint_flows t
    LEFT JOIN symbols src ON src.id = t.source_symbol_id
    LEFT JOIN files sf ON sf.id = src.file_id
    LEFT JOIN symbols snk ON snk.id = t.sink_symbol_id
    LEFT JOIN files tnf ON tnf.id = snk.file_id
    WHERE t.project_hash = ?
    ORDER BY CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END
    LIMIT ?
  `).all(projectHash, limit)
}
