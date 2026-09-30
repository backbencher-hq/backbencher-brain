// Generated from the backbencher-brain reference (initSchema DDL).
// Schema for the standalone ~/.bb brain databases. Matches the opencode
// index schema (brain_file/symbol/relationship/import + pattern/cache/health).

const DDL = `
CREATE TABLE IF NOT EXISTS brain_schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, migration_name TEXT NOT NULL);
-- ================================================================
      -- UNIVERSAL PROJECT BRAIN DATABASE FOUNDATION
      -- Cross-language intelligence system  
      -- ================================================================
      
      -- Core Files Table
      CREATE TABLE IF NOT EXISTS brain_file (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        relative_path TEXT NOT NULL, 
        file_hash TEXT NOT NULL,
        size_bytes INTEGER,
        line_count INTEGER,
        language TEXT,
        last_modified REAL,
        indexed_at TEXT,
        layer TEXT,
        is_test_file INTEGER,
        is_config_file INTEGER,
        is_documentation INTEGER,
        has_syntax_errors INTEGER NOT NULL DEFAULT 0,
        error_report TEXT,
        framework_type TEXT,
        -- The analyzer's FileMetadata as JSON: patterns, detectedFrameworks,
        -- frameworkPatterns, architecturalInsights, complexity, cyclomaticComplexity,
        -- codeQuality. The framework_type column above is the ONE field promoted
        -- to its own column;
        -- everything else the analyzer computed had nowhere to go, so a correct
        -- analyzer's pattern evidence was discarded on the way into the index.
        -- This is the same shape brain_relationship.metadata already uses.
        metadata TEXT,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
      
      -- Universal Symbols Table

      CREATE TABLE IF NOT EXISTS brain_symbol (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT,
        symbol_type TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        byte_start INTEGER,
        byte_end INTEGER, 
        return_type TEXT,
        parameters TEXT,
        docstring TEXT,
        -- The symbol's own source text, bounded. This is what makes a word
        -- that appears ONLY inside a function reachable by a text query.
        -- Measured on real corpora before it existed: content search selected
        -- name/qualified_name/docstring and there was no body column at all, so
        -- a body-only word was unreachable by BOTH retrieval paths — 27% of
        -- body-only words on rake, 38% on ripgrep. The body WAS indexed, but
        -- only as a 50-dimensional hash, which cannot be queried by word.
        -- Bounded because a symbol can be very large (a 25 599-character body
        -- was measured on rake) and this table is scanned by content search.
        source_text TEXT,
        visibility TEXT,
        is_async INTEGER,
        is_static INTEGER,
        is_abstract INTEGER,
        is_override INTEGER,
        is_getter INTEGER,
        is_setter INTEGER,
        complexity INTEGER,
        owner_symbol_id TEXT,
        scope_kind TEXT,
        -- #612: 1 = the analyzer published this symbol as a DECLARATION
        -- (a c prototype, a cpp in-class/field-declaration or header
        -- prototype, a rust function_signature_item, a body-less zig
        -- function declaration), NULL = a definition or a language that does
        -- not distinguish. Name resolution reads this to prefer the
        -- definition when a declaration and its definition share a name.
        is_declaration INTEGER,
        annotations TEXT,
        generic_parameters TEXT,
        qualified_calls TEXT,
        api_contract_path TEXT,
        gravity_score REAL DEFAULT 0,
        layer TEXT DEFAULT "core",
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
      );
      
      -- Cross-Language Relationships Table  
      CREATE TABLE IF NOT EXISTS brain_relationship (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        source_symbol_id TEXT,
        target_symbol_id TEXT,
        source_external TEXT,
        target_external TEXT,
        relationship_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        context TEXT,
        line_number INTEGER,
        is_cross_language INTEGER,
        bridge_mechanism TEXT,
        is_cross_file INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
        FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL
      );
      
      -- Imports/Dependencies Table
      CREATE TABLE IF NOT EXISTS brain_import (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        imported_name TEXT NOT NULL,
        imported_as TEXT,
        import_path TEXT NOT NULL,
        import_type TEXT NOT NULL,
        is_external INTEGER,
        package_name TEXT,
        line_number INTEGER,
        is_dynamic INTEGER,
        resolved_symbol_id TEXT,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
      );
      
      -- Pattern Intelligence Table
      
      -- Query Cache Table
      CREATE TABLE IF NOT EXISTS brain_query_cache (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        query_type TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        query_params TEXT,
        result_data TEXT,
        confidence REAL NOT NULL,
        computation_time_ms INTEGER,
        cache_expires_at INTEGER,
        hit_count INTEGER DEFAULT 0 NOT NULL,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
      
      -- Index Status Tracking
      CREATE TABLE IF NOT EXISTS brain_index_status (
        project_id TEXT PRIMARY KEY NOT NULL,
        status TEXT,
        last_full_index INTEGER,
        last_incremental_index INTEGER,
        total_files INTEGER DEFAULT 0 NOT NULL,
        indexed_files INTEGER DEFAULT 0 NOT NULL,
        total_symbols INTEGER DEFAULT 0 NOT NULL,
        total_relationships INTEGER DEFAULT 0 NOT NULL,
        indexing_version TEXT NOT NULL,
        languages_detected TEXT,
        frameworks_detected TEXT,
        indexing_errors TEXT,
        performance_stats TEXT,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
      
      -- ================================================================
      -- PERFORMANCE INDEXES - Optimized for graph queries
      -- ================================================================
      
      CREATE INDEX IF NOT EXISTS brain_file_project_idx ON brain_file(project_id);
      CREATE INDEX IF NOT EXISTS brain_file_path_idx ON brain_file(path);
      CREATE INDEX IF NOT EXISTS brain_file_language_idx ON brain_file(language);
      CREATE INDEX IF NOT EXISTS brain_file_hash_idx ON brain_file(file_hash);
      
      CREATE INDEX IF NOT EXISTS brain_symbol_project_idx ON brain_symbol(project_id);
      CREATE INDEX IF NOT EXISTS brain_symbol_file_idx ON brain_symbol(file_id);
      CREATE INDEX IF NOT EXISTS brain_symbol_name_idx ON brain_symbol(name);
      CREATE INDEX IF NOT EXISTS brain_symbol_type_idx ON brain_symbol(symbol_type);
      CREATE INDEX IF NOT EXISTS brain_symbol_qualified_idx ON brain_symbol(qualified_name);
      
      CREATE INDEX IF NOT EXISTS brain_rel_project_idx ON brain_relationship(project_id);
      CREATE INDEX IF NOT EXISTS brain_rel_source_idx ON brain_relationship(source_symbol_id);
      CREATE INDEX IF NOT EXISTS brain_rel_target_idx ON brain_relationship(target_symbol_id);
      CREATE INDEX IF NOT EXISTS brain_rel_type_idx ON brain_relationship(relationship_type);
      CREATE INDEX IF NOT EXISTS brain_rel_source_type_idx ON brain_relationship(source_symbol_id, relationship_type);
      CREATE INDEX IF NOT EXISTS brain_rel_proj_type_target_idx ON brain_relationship(project_id, relationship_type, target_symbol_id);
      CREATE INDEX IF NOT EXISTS brain_rel_confidence_idx ON brain_relationship(confidence);
      CREATE INDEX IF NOT EXISTS brain_rel_cross_file_idx ON brain_relationship(is_cross_file);
      CREATE INDEX IF NOT EXISTS brain_rel_target_ext_idx ON brain_relationship(target_external);
      
      CREATE INDEX IF NOT EXISTS brain_import_project_idx ON brain_import(project_id);
      CREATE INDEX IF NOT EXISTS brain_import_file_idx ON brain_import(file_id);
      CREATE INDEX IF NOT EXISTS brain_import_path_idx ON brain_import(import_path);
      
      CREATE INDEX IF NOT EXISTS brain_symbol_owner_idx ON brain_symbol(owner_symbol_id);

      
      -- Initialize project brain status
      INSERT OR IGNORE INTO brain_index_status (
        project_id, 
        indexing_version, 
        languages_detected, 
        frameworks_detected,
        indexing_errors,
        performance_stats,
        time_created,
        time_updated
      ) VALUES (
        ?, 
        'v1.0.0',
        '[]',
        '[]', 
        '[]',
        '{}',
        strftime('%s','now') * 1000,
        strftime('%s','now') * 1000
      );
CREATE TABLE IF NOT EXISTS brain_project_health (
              project_id TEXT PRIMARY KEY NOT NULL,
              complexity_score INTEGER NOT NULL DEFAULT 0,
              maintainability_score INTEGER NOT NULL DEFAULT 0,
              technical_debt_score INTEGER NOT NULL DEFAULT 0,
              code_quality_score INTEGER NOT NULL DEFAULT 0,
              language_distribution TEXT,
              service_metrics TEXT,
              dependency_metrics TEXT,
              circular_dependencies TEXT,
              contract_drift TEXT,
              performance_bottlenecks TEXT,
              time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );

CREATE TABLE IF NOT EXISTS brain_taint_flow (
              id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              source_symbol_id TEXT,
              sink_symbol_id TEXT,
              source_type TEXT NOT NULL,
              sink_type TEXT NOT NULL,
              vulnerability_type TEXT NOT NULL,
              severity TEXT NOT NULL,
              is_mitigated INTEGER NOT NULL DEFAULT 0,
              flow_path TEXT,
              cross_language_boundaries INTEGER NOT NULL DEFAULT 0,
              mitigation_steps TEXT,
              time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
CREATE INDEX IF NOT EXISTS brain_taint_project_idx ON brain_taint_flow(project_id);
CREATE INDEX IF NOT EXISTS brain_taint_source_idx ON brain_taint_flow(source_symbol_id);
CREATE INDEX IF NOT EXISTS brain_taint_sink_idx ON brain_taint_flow(sink_symbol_id);
CREATE INDEX IF NOT EXISTS brain_taint_vuln_idx ON brain_taint_flow(vulnerability_type);
CREATE INDEX IF NOT EXISTS brain_taint_severity_idx ON brain_taint_flow(severity);

-- ================================================================
-- COMPOUND & MISSING INDEXES - aligned with the drizzle schema
-- ================================================================

CREATE INDEX IF NOT EXISTS brain_file_proj_path_idx ON brain_file(project_id, path);
CREATE INDEX IF NOT EXISTS brain_file_proj_hash_idx ON brain_file(project_id, file_hash);
CREATE INDEX IF NOT EXISTS brain_file_syntax_errors_idx ON brain_file(has_syntax_errors);

CREATE INDEX IF NOT EXISTS brain_sym_proj_file_idx ON brain_symbol(project_id, file_id);      CREATE INDEX IF NOT EXISTS brain_sym_proj_name_idx ON brain_symbol(project_id, name);
      -- Case-insensitive name index: LOWER(name) = LOWER(?) wraps the column and
      -- defeats the BINARY index (full scan on 1M symbols, M19.Q1 measured ~1.3s
      -- with the join). SQLite's NOCASE collation folds ASCII exactly like its
      -- LOWER(), so name = ? COLLATE NOCASE / name LIKE ? COLLATE NOCASE are
      -- semantically identical to the old LOWER() forms but index-accelerated.
      CREATE INDEX IF NOT EXISTS brain_sym_proj_name_nocase_idx ON brain_symbol(project_id, name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS brain_sym_proj_type_idx ON brain_symbol(project_id, symbol_type);
CREATE INDEX IF NOT EXISTS brain_sym_proj_name_type_idx ON brain_symbol(project_id, name, symbol_type);

CREATE INDEX IF NOT EXISTS brain_rel_proj_target_idx ON brain_relationship(project_id, target_symbol_id);
CREATE INDEX IF NOT EXISTS brain_rel_proj_source_idx ON brain_relationship(project_id, source_symbol_id);
CREATE INDEX IF NOT EXISTS brain_rel_proj_type_idx ON brain_relationship(project_id, relationship_type);
CREATE INDEX IF NOT EXISTS brain_rel_target_type_idx ON brain_relationship(target_symbol_id, relationship_type);
CREATE INDEX IF NOT EXISTS brain_rel_cross_lang_idx ON brain_relationship(is_cross_language);
-- M29.R3 (giant-repo, 59k files): hover's cross-language probes filter on
-- is_cross_language = 1 AND target/source_symbol_id = ?. The single-column
-- indexes leave SQLite scanning; the composite (symbol_id, is_cross_language)
-- form answers both probes from the index (measured 477ms -> <1ms at scale).
CREATE INDEX IF NOT EXISTS brain_rel_target_cross_idx ON brain_relationship(target_symbol_id, is_cross_language);
CREATE INDEX IF NOT EXISTS brain_rel_source_cross_idx ON brain_relationship(source_symbol_id, is_cross_language);

CREATE INDEX IF NOT EXISTS brain_import_name_idx ON brain_import(imported_name);
CREATE INDEX IF NOT EXISTS brain_import_external_idx ON brain_import(is_external);


CREATE INDEX IF NOT EXISTS brain_cache_project_idx ON brain_query_cache(project_id);
CREATE INDEX IF NOT EXISTS brain_cache_query_type_idx ON brain_query_cache(query_type);
CREATE INDEX IF NOT EXISTS brain_cache_hash_idx ON brain_query_cache(query_hash);

CREATE TABLE IF NOT EXISTS brain_semantic_embedding (
              id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              embedding_model TEXT NOT NULL,
              embedding_vector TEXT NOT NULL,
              -- M50.A2 (#764): little-endian float32 accelerator for DENSE
              -- vectors. embedding_vector (JSON) remains the source of truth;
              -- this column exists so semantic reads do not re-parse 260MB of
              -- JSON digits per bb_ask. NULL = no accelerator.
              embedding_blob BLOB,
              vector_dimension INTEGER NOT NULL,
              content_hash TEXT NOT NULL,
              semantic_context TEXT,
              similarity_threshold REAL DEFAULT 0.7,
              last_updated INTEGER NOT NULL,
              time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
CREATE INDEX IF NOT EXISTS brain_embed_project_idx ON brain_semantic_embedding(project_id);
CREATE INDEX IF NOT EXISTS brain_embed_entity_idx ON brain_semantic_embedding(entity_id);
CREATE INDEX IF NOT EXISTS brain_embed_type_idx ON brain_semantic_embedding(entity_type);
CREATE INDEX IF NOT EXISTS brain_embed_model_idx ON brain_semantic_embedding(embedding_model);
CREATE INDEX IF NOT EXISTS brain_embed_hash_idx ON brain_semantic_embedding(content_hash);
-- M52.P1 (#721): covering index for the bb_health aggregates (models/dims/
-- entities). Without it SQLite reads full ~8KB vector BLOB rows to reach four
-- metadata columns — measured 12.7s per bb_health call at 158k x 2048-dim.
CREATE INDEX IF NOT EXISTS brain_embed_health_idx ON brain_semantic_embedding(project_id, embedding_model, entity_id, vector_dimension);

      `

/** Current schema version — every freshly ensured brain database records this row. */
export const SCHEMA_VERSION = 1
export const SCHEMA_MIGRATION_NAME = "m13-universal-brain"

/**
 * M28.A1 (issue #626, decision D-3/D-4): agent-authored annotations.
 *
 * An annotation is an OPINION layered on index evidence, never an index fact:
 * every row carries its author class ('agent' | 'human'), the tool identity
 * that wrote it, and a timestamp — provenance is the honesty boundary. The
 * migration is ADDITIVE-ONLY (D-4) and idempotent, and — like the M22.W2
 * column migrations — must run on EVERY open, not just fresh schema creation,
 * because ensureSchemaIfNew skips full DDL for pre-existing databases (the
 * same db every editor and verifier reads).
 */
export const ANNOTATION_DDL = `
    CREATE TABLE IF NOT EXISTS brain_annotation (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_path TEXT,
      author_class TEXT NOT NULL,
      tool_identity TEXT NOT NULL,
      body TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS brain_annotation_project_symbol_idx ON brain_annotation(project_id, symbol_name);
    CREATE INDEX IF NOT EXISTS brain_annotation_project_idx ON brain_annotation(project_id);
    -- Location identity in the schema, not in an encoded id string. COALESCE
    -- is load-bearing: symbol_path is nullable and SQLite counts NULLs as
    -- distinct in a UNIQUE index, so a path-less note must not escape the
    -- constraint. See src/brain/annotation-store.ts for the measured defect
    -- this replaces.
    CREATE UNIQUE INDEX IF NOT EXISTS brain_annotation_location_idx
      ON brain_annotation(project_id, symbol_name, author_class, COALESCE(symbol_path, ''));
  `

/**
 * The honesty boundary for `author_class`, enforced by the DATABASE rather than
 * by convention. `author_class` was `TEXT NOT NULL`, which refuses NULL but
 * accepts any string — a row could claim 'human'. The write door hardcodes
 * 'agent', so a bb_annotate call cannot spoof it, but every reader trusts this
 * column verbatim (annotation_ui labels each note with it), so the column itself
 * is where the claim has to be made true.
 *
 * A trigger, not a CHECK: SQLite has no `ALTER TABLE ADD CONSTRAINT`, and
 * rebuilding the table on a shared, long-lived index is a destructive migration
 * this schema deliberately avoids (every migration here is additive + idempotent,
 * see ensureAnnotationTable). A BEFORE trigger is additive, survives reopening,
 * and refuses the write loudly instead of letting a mislabelled note be rendered
 * to a human as a human's own note.
 */
export const ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL = `
    CREATE TRIGGER IF NOT EXISTS brain_annotation_author_class_guard
    BEFORE INSERT ON brain_annotation
    WHEN NEW.author_class IS NULL OR NEW.author_class NOT IN ('agent', 'human')
    BEGIN
      SELECT RAISE(ABORT, 'brain_annotation.author_class must be ''agent'' or ''human'' (got: ' || COALESCE(NEW.author_class, 'NULL') || ')');
    END;
    CREATE TRIGGER IF NOT EXISTS brain_annotation_author_class_guard_update
    BEFORE UPDATE OF author_class ON brain_annotation
    WHEN NEW.author_class IS NULL OR NEW.author_class NOT IN ('agent', 'human')
    BEGIN
      SELECT RAISE(ABORT, 'brain_annotation.author_class must be ''agent'' or ''human'' (got: ' || COALESCE(NEW.author_class, 'NULL') || ')');
    END;
  `

/** Idempotent, additive-only annotation migration. Safe to call repeatedly. */
export function ensureAnnotationTable(raw: any): void {
  try {
    raw.exec(ANNOTATION_DDL)
  } catch {}
  // The author-class guard is part of the same additive, idempotent migration:
  // a pre-existing DB gains it on the next open, exactly like the table and the
  // location index. Failures stay swallowed (a read-only or busy open must not
  // fail because a trigger could not be created) — the same contract as every
  // other migration here.
  try {
    raw.exec(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL)
  } catch {}
}

/**
 * M52.P1 (#721): covering index for the bb_health embedding aggregates.
 * Idempotent, runs on EVERY open (both ensureSchemaIfNew branches and
 * ensureSchema) because ensureSchemaIfNew skips full DDL for pre-existing
 * databases — the exact population (large, long-lived indexes) that needs
 * this index most. try/catch: a read-only or transient open must never fail
 * because of an index creation.
 */
/**
 * M50.A2 (#764): additive migration for the dense-vector accelerator column.
 * Additive-only and idempotent: legacy DBs gain a NULL column (reads fall back
 * to the JSON column, so nothing changes functionally), fresh DBs already have
 * it from the DDL. Safe on read-only or busy opens (try/catch).
 */
export function ensureEmbeddingBlobColumn(raw: any): void {
  try {
    const cols = (raw.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as Array<{ name: string }>).map((c) => c.name)
    if (cols.length === 0) return // table absent (fresh DB handled by DDL)
    if (cols.includes("embedding_blob")) return
    raw.exec("ALTER TABLE brain_semantic_embedding ADD COLUMN embedding_blob BLOB")
  } catch {}
}

/**
 * #612: additive migration for the declaration/definition column.
 * Additive-only and idempotent, same contract as ensureEmbeddingBlobColumn:
 * legacy DBs gain a NULL column (NULL = "a definition, or a language that does
 * not distinguish", which is exactly what every pre-#612 row is), fresh DBs
 * already have it from the DDL. Safe on read-only or busy opens (try/catch).
 * Leaving legacy rows NULL is deliberate, not a gap: the resolver treats NULL
 * and 0 identically, so an un-migrated DB keeps the previous resolution order
 * until a re-index writes the real value.
 */
export function ensureSymbolDeclarationColumn(raw: any): void {
  try {
    const cols = (raw.prepare("PRAGMA table_info(brain_symbol)").all() as Array<{ name: string }>).map((c) => c.name)
    if (cols.length === 0) return // table absent (fresh DB handled by DDL)
    if (cols.includes("is_declaration")) return
    raw.exec("ALTER TABLE brain_symbol ADD COLUMN is_declaration INTEGER")
  } catch {}
}

/**
 * `brain_symbol.source_text` — the symbol's own body, bounded.
 *
 * Added because a word that appears ONLY inside a function was unreachable by
 * every retrieval path. `searchContent` selects name/qualified_name/docstring,
 * and there was no body column at all, so on real corpora:
 *
 *     rake       121 body-only words   88 found   33 UNREACHABLE (27%)
 *     ripgrep    118 body-only words   73 found   45 UNREACHABLE (38%)
 *
 * The body was indexed, but only as a 50-dimensional hash, which cannot be
 * queried by a specific word. The text was in the database and absent from
 * retrieval at the same time.
 *
 * Legacy rows are NULL and stay NULL until a re-index writes the body. That is
 * deliberate: content search treats a NULL body as "this row has no body to
 * search", which is true of an un-migrated database, and the tool reports
 * `bodyCoverage` rather than implying the corpus is complete.
 *
 * This MUST run on the pre-existing-database open path, not only on fresh
 * schema creation. Wiring it into the fresh-DB branch alone is the documented
 * way migrations go missing in this codebase (see the M22.W2 comment in
 * database.ts), and the first run of this change failed exactly that way:
 * the indexer's own INSERT hit "table brain_symbol has no column named
 * source_text" on a database that already had its tables.
 *
 * Idempotent, and a no-op on a fresh DB where the DDL already created it.
 */
export function ensureSymbolSourceTextColumn(raw: any): void {
  try {
    const cols = (raw.prepare("PRAGMA table_info(brain_symbol)").all() as Array<{ name: string }>).map((c) => c.name)
    if (cols.length === 0) return
    if (cols.includes("source_text")) return
    raw.exec("ALTER TABLE brain_symbol ADD COLUMN source_text TEXT")
  } catch {}
}

/**
 * M14 #277 follow-on: `brain_file.metadata`.
 *
 * Found from the bash lane, but it is not a bash problem: EVERY analyzer returns
 * its FileMetadata and `storeResults` had no column for it, so `patterns`,
 * `detectedFrameworks`, `architecturalInsights`, `complexity`,
 * `cyclomaticComplexity` and `codeQuality` were computed for all 29 languages
 * and thrown away. The worker was ALSO dropping the object before the store, so
 * the data was lost at two independent points; this fixes the second one.
 *
 * SQLite cannot add a column inside CREATE TABLE IF NOT EXISTS, so existing
 * databases need the explicit ALTER. Idempotent, and a no-op on a fresh DB where
 * the DDL above already created the column.
 */
export function ensureFileMetadataColumn(raw: any): void {
  try {
    const cols = (raw.prepare("PRAGMA table_info(brain_file)").all() as Array<{ name: string }>).map((c) => c.name)
    if (cols.length === 0) return // table absent (fresh DB handled by DDL)
    if (cols.includes("metadata")) return
    raw.exec("ALTER TABLE brain_file ADD COLUMN metadata TEXT")
  } catch {}
}

export function ensureHealthIndexes(raw: any): { recreated: number } {
  try {
    raw.exec(`CREATE INDEX IF NOT EXISTS brain_embed_health_idx ON brain_semantic_embedding(project_id, embedding_model, entity_id, vector_dimension)`)
  } catch {}
  // M50.A2 (#764): core traversal indexes are self-healing too. A DB that lost
  // a structural index (interrupted migration, manual surgery, old-tooling
  // write) degrades to full scans of brain_symbol per graph hop — the same
  // symptom class as missing planner stats. IF NOT EXISTS costs one
  // sqlite_master lookup per name at open; steady state is free.
  const coreIdx: Array<[string, string]> = [
    ["brain_symbol_owner_idx", "brain_symbol(owner_symbol_id)"],
    ["brain_symbol_project_idx", "brain_symbol(project_id)"],
    ["brain_symbol_name_idx", "brain_symbol(name)"],
    ["brain_rel_proj_type_target_idx", "brain_relationship(project_id, relationship_type, target_symbol_id)"],
    ["brain_rel_source_idx", "brain_relationship(source_symbol_id)"],
    ["brain_rel_target_idx", "brain_relationship(target_symbol_id)"],
    ["brain_file_project_idx", "brain_file(project_id)"],
    ["brain_file_path_idx", "brain_file(path)"],
  ]
  let recreated = 0
  for (const [name, cols] of coreIdx) {
    try {
      const before = raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name)
      raw.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${cols}`)
      if (!before) recreated++
    } catch {}
  }
  return { recreated }
}

/**
 * M50.A2 (#764): planner-truth healing. The SQLite query planner only makes
 * good index choices when sqlite_stat1 exists; on real user DBs that never
 * saw an ANALYZE, the graph owner-cascade subquery was planned as a
 * brain_symbol_project_idx scan over every symbol (measured: 117-126ms per
 * traversal hop; ~15s per bb_graph call; bb_patterns timed out at 45s). With
 * stats present the same hop is 0.3-0.6ms — a 200-400x error, purely from a
 * missing planner input, not a missing index.
 *
 * Absence-only policy: when sqlite_stat1 is MISSING (legacy DBs, DBs written
 * by runtimes that skip ANALYZE), run ANALYZE once at open. When it EXISTS we
 * do nothing — no per-call scans, no re-analyze churn. Fresh statistics for
 * growing indexes are handled by the `analyze` post-processing phase
 * (parallel-indexer), which re-runs ANALYZE after every full index. If a real
 * ANALYZE is undesirable here (huge DB, busy disk), set BB_SKIP_ANALYZE=1.
 * Idempotent; measured one-time cost ~8s on a 4.8GB/168k-symbol DB, paid on
 * the first open only.
 */
export function ensurePlannerStats(raw: any): { analyzed: boolean } {
  try {
    const hasStats = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get()
    if (hasStats) return { analyzed: false }
    if (process.env.BB_SKIP_ANALYZE === "1") return { analyzed: false }
    raw.exec("ANALYZE")
    return { analyzed: true }
  } catch {
    // Readonly or locked DB: never fail a read because stats are missing.
    return { analyzed: false }
  }
}

/**
 * M54.P1 (#727): one-time healing for rows written while FK enforcement was
 * OFF under Bun (the runtime asymmetry proven in script/m54/probe-fk.ts A3).
 * Real-repo measurement at decision time: 4,154 relationship rows LEFT-JOIN
 * to a missing symbol, but 4,122 of those have source_symbol_id IS NULL with
 * source_external carrying the name — the BY-DESIGN external-source edge
 * representation (M51.A3, FK-legal, never touched here). Only 32 were true
 * danglers (non-NULL missing source), already re-stored away. This cleanup
 * therefore deletes only rows whose FK value is non-NULL and unresolved:
 * relationship source/target, symbol file_id, import file_id.
 * Order matters: relationship orphans first (they reference brain_symbol),
 * then import and symbol orphans (they reference brain_file).
 * Idempotent — a conforming DB deletes 0 rows. Per-handle memoization
 * (WeakSet on the native driver) means the scan runs once per connection per
 * process even when callers invoke it on every open; a NEW handle (fresh open)
 * re-scans, which is the correct moment to heal a DB dirtied by an FK-OFF
 * window. Returns per-table counts so gates can assert outcomes.
 */
const fkHealedHandles = new WeakSet<object>()
export function cleanupOrphanedFkRows(raw: any): { relationships: number; imports: number; symbols: number } {
  const handle = raw?.native ?? raw
  if (handle && typeof handle === "object" && fkHealedHandles.has(handle)) {
    return { relationships: 0, imports: 0, symbols: 0 }
  }
  let relationships = 0
  let imports = 0
  let symbols = 0
  try {
    const r = raw.prepare(`DELETE FROM brain_relationship WHERE source_symbol_id IN (
      SELECT r.source_symbol_id FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      WHERE s.id IS NULL
    )`).run()
    relationships = r?.changes ?? 0
  } catch {}
  try {
    const i = raw.prepare(`DELETE FROM brain_import WHERE file_id IN (
      SELECT i.file_id FROM brain_import i
      LEFT JOIN brain_file f ON f.id = i.file_id
      WHERE f.id IS NULL
    )`).run()
    imports = i?.changes ?? 0
  } catch {}
  try {
    const s = raw.prepare(`DELETE FROM brain_symbol WHERE file_id IN (
      SELECT sy.file_id FROM brain_symbol sy
      LEFT JOIN brain_file f ON f.id = sy.file_id
      WHERE f.id IS NULL
    )`).run()
    symbols = s?.changes ?? 0
  } catch {}
  if (handle && typeof handle === "object") fkHealedHandles.add(handle)
  return { relationships, imports, symbols }
}

/**
 * M22.W2: idempotent column migrations that must run on EVERY open, not just
 * fresh schema creation. Pre-existing brain_index_status tables (created before
 * later columns existed) lack them; the indexer persists complete/partial +
 * timing columns there, so a missing column crashes the whole run (noop path
 * updateIndexStatus ws: "table brain_index_status has no column named …").
 * SQLite can't add a column inside CREATE TABLE IF NOT EXISTS, so compare
 * PRAGMA columns against the current definition and ALTER TABLE for any that
 * are missing. Safe to call repeatedly; the DDL types for NOT NULL DEFAULT
 * columns are preserved so existing rows satisfy the constraint.
 */
export function migrateSchemaColumns(raw: any): void {
  try {
    const cols = new Set((raw.prepare("PRAGMA table_info(brain_index_status)").all() as Array<{ name: string }>).map((c) => c.name))
    const expected: Array<[string, string]> = [
      ["status", "TEXT"],
      ["last_full_index", "INTEGER"],
      ["last_incremental_index", "INTEGER"],
      ["total_files", "INTEGER NOT NULL DEFAULT 0"],
      ["indexed_files", "INTEGER NOT NULL DEFAULT 0"],
      ["total_symbols", "INTEGER NOT NULL DEFAULT 0"],
      ["total_relationships", "INTEGER NOT NULL DEFAULT 0"],
      ["time_created", "INTEGER"],
      ["time_updated", "INTEGER"],
      // M23.P3: codebase identity for index portability (adopt-on-move).
      ["codebase_fingerprint", "TEXT"],
      ["codebase_git", "TEXT"],
    ]
    for (const [name, ddl] of expected) {
      if (!cols.has(name)) {
        raw.exec(`ALTER TABLE brain_index_status ADD COLUMN ${name} ${ddl}`)
        cols.add(name)
      }
    }
  } catch {}
}

export function ensureSchema(raw: any): void {
  raw.exec(DDL)
  ensureHealthIndexes(raw)
  // M50.A2 (#764): dense-vector accelerator column (idempotent; the DDL above
  // already carries it for fresh DBs, this covers re-created tables via paths
  // that ran an older DDL).
  ensureEmbeddingBlobColumn(raw)
  // #612: additive symbol column (idempotent; the DDL above carries it for
  // fresh DBs, this covers DBs created by an older DDL).
  ensureSymbolDeclarationColumn(raw)
  // The symbol body, so content search can reach a word that appears only
  // inside a function. Idempotent; the DDL above carries it for fresh DBs.
  ensureSymbolSourceTextColumn(raw)
  try {
    raw.prepare("INSERT OR IGNORE INTO brain_schema_version (version, applied_at, migration_name) VALUES (?, strftime('%s','now') * 1000, ?)").run(SCHEMA_VERSION, SCHEMA_MIGRATION_NAME)
  } catch {}
  // Column migrations run for freshly-created databases too (idempotent).
  migrateSchemaColumns(raw)
  // M28.A1: annotation store is additive + idempotent, every open.
  ensureAnnotationTable(raw)
  raw.exec(`
    CREATE TABLE IF NOT EXISTS brain_analysis_run (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, engine_version TEXT NOT NULL, input_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL, completed_at INTEGER, finding_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brain_analysis_finding (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL, rule TEXT NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL,
      state TEXT NOT NULL, confidence REAL, evidence TEXT, first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL, resolved_at INTEGER, suppressed_at INTEGER, mitigated_at INTEGER,
      occurrence_count INTEGER NOT NULL DEFAULT 0, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brain_analysis_occurrence (
      id TEXT PRIMARY KEY NOT NULL, finding_id TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL,
      location TEXT, evidence TEXT, observed_at INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS brain_analysis_finding_identity_idx ON brain_analysis_finding(project_id, kind, fingerprint);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_project_idx ON brain_analysis_run(project_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_kind_idx ON brain_analysis_run(kind);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_started_idx ON brain_analysis_run(started_at);
    CREATE INDEX IF NOT EXISTS brain_analysis_finding_project_idx ON brain_analysis_finding(project_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_finding_state_idx ON brain_analysis_finding(project_id, state);
    CREATE INDEX IF NOT EXISTS brain_analysis_occurrence_finding_idx ON brain_analysis_occurrence(finding_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_occurrence_run_idx ON brain_analysis_occurrence(run_id);
  `)
  try {
    raw.prepare(`INSERT OR IGNORE INTO brain_index_status (project_id, indexing_version, languages_detected, frameworks_detected, indexing_errors, performance_stats, time_created, time_updated)
      VALUES ('__schema__', 'v1.0.0', '[]', '[]', '[]', '{}', strftime('%s','now') * 1000, strftime('%s','now') * 1000)`).run()
  } catch {}
}
