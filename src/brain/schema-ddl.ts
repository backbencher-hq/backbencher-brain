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
      CREATE TABLE IF NOT EXISTS brain_pattern (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        pattern_name TEXT NOT NULL,
        description TEXT,
        framework TEXT,
        confidence REAL NOT NULL,
        symbol_ids TEXT,
        file_ids TEXT,
        is_anti_pattern INTEGER,
        severity TEXT,
        suggestion TEXT,
        metadata TEXT,
        time_created INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        time_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
      
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

      CREATE INDEX IF NOT EXISTS brain_pattern_project_idx ON brain_pattern(project_id);
      CREATE INDEX IF NOT EXISTS brain_pattern_type_idx ON brain_pattern(pattern_type);
      CREATE INDEX IF NOT EXISTS brain_pattern_confidence_idx ON brain_pattern(confidence);
      
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

CREATE INDEX IF NOT EXISTS brain_sym_proj_file_idx ON brain_symbol(project_id, file_id);
CREATE INDEX IF NOT EXISTS brain_sym_proj_name_idx ON brain_symbol(project_id, name);
CREATE INDEX IF NOT EXISTS brain_sym_proj_type_idx ON brain_symbol(project_id, symbol_type);
CREATE INDEX IF NOT EXISTS brain_sym_proj_name_type_idx ON brain_symbol(project_id, name, symbol_type);

CREATE INDEX IF NOT EXISTS brain_rel_proj_target_idx ON brain_relationship(project_id, target_symbol_id);
CREATE INDEX IF NOT EXISTS brain_rel_proj_source_idx ON brain_relationship(project_id, source_symbol_id);
CREATE INDEX IF NOT EXISTS brain_rel_proj_type_idx ON brain_relationship(project_id, relationship_type);
CREATE INDEX IF NOT EXISTS brain_rel_target_type_idx ON brain_relationship(target_symbol_id, relationship_type);
CREATE INDEX IF NOT EXISTS brain_rel_cross_lang_idx ON brain_relationship(is_cross_language);

CREATE INDEX IF NOT EXISTS brain_import_name_idx ON brain_import(imported_name);
CREATE INDEX IF NOT EXISTS brain_import_external_idx ON brain_import(is_external);

CREATE INDEX IF NOT EXISTS brain_pattern_framework_idx ON brain_pattern(framework);

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

      `

/** Current schema version — every freshly ensured brain database records this row. */
export const SCHEMA_VERSION = 1
export const SCHEMA_MIGRATION_NAME = "m13-universal-brain"

export function ensureSchema(raw: any): void {
  raw.exec(DDL)
  try {
    raw.prepare("INSERT OR IGNORE INTO brain_schema_version (version, applied_at, migration_name) VALUES (?, strftime('%s','now') * 1000, ?)").run(SCHEMA_VERSION, SCHEMA_MIGRATION_NAME)
  } catch {}
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
