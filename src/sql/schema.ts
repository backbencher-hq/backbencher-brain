export const SCHEMA_VERSION = 1

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS brain_file (
  id TEXT PRIMARY KEY, project_hash TEXT NOT NULL, path TEXT NOT NULL,
  relative_path TEXT NOT NULL, file_hash TEXT NOT NULL, size_bytes INTEGER,
  line_count INTEGER, language TEXT, framework TEXT, framework_type TEXT,
  layer TEXT DEFAULT 'core', system TEXT, content TEXT,
  is_test INTEGER DEFAULT 0, is_test_file INTEGER DEFAULT 0,
  is_config INTEGER DEFAULT 0, is_documentation INTEGER DEFAULT 0,
  has_syntax_errors INTEGER DEFAULT 0, error_report TEXT,
  last_modified INTEGER, indexed_at TEXT, time_created INTEGER, time_updated INTEGER
);

CREATE TABLE IF NOT EXISTS brain_symbol (
  id TEXT PRIMARY KEY, project_hash TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
  name TEXT NOT NULL, qualified_name TEXT, symbol_type TEXT NOT NULL,
  line_start INTEGER, line_end INTEGER, byte_start INTEGER, byte_end INTEGER,
  signature TEXT, return_type TEXT, parameters TEXT, docstring TEXT,
  body_preview TEXT, body_hash TEXT, visibility TEXT,
  is_async INTEGER DEFAULT 0, is_static INTEGER DEFAULT 0, is_abstract INTEGER DEFAULT 0,
  is_override INTEGER DEFAULT 0, is_getter INTEGER DEFAULT 0, is_setter INTEGER DEFAULT 0,
  complexity INTEGER, owner_symbol_id TEXT, scope_kind TEXT,
  annotations TEXT, generic_parameters TEXT, throws TEXT, qualified_calls TEXT,
  gravity_score REAL DEFAULT 0, layer TEXT DEFAULT 'core', api_contract_path TEXT,
  time_created INTEGER, time_updated INTEGER
);

CREATE TABLE IF NOT EXISTS brain_relationship (
  id TEXT PRIMARY KEY, project_hash TEXT NOT NULL,
  source_symbol_id TEXT NOT NULL REFERENCES brain_symbol(id) ON DELETE CASCADE,
  target_symbol_id TEXT REFERENCES brain_symbol(id) ON DELETE SET NULL,
  target_external TEXT, source_external TEXT, relationship_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0, context TEXT, line_number INTEGER,
  is_cross_file INTEGER DEFAULT 0, is_cross_language INTEGER DEFAULT 0,
  bridge_mechanism TEXT, call_frequency INTEGER,
  is_breaking_change_risk INTEGER DEFAULT 0, metadata TEXT,
  time_created INTEGER, time_updated INTEGER
);

CREATE TABLE IF NOT EXISTS brain_import (
  id TEXT PRIMARY KEY, project_hash TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
  imported_name TEXT NOT NULL, import_path TEXT NOT NULL,
  import_type TEXT, is_external INTEGER DEFAULT 0, line_number INTEGER,
  time_created INTEGER, time_updated INTEGER
);

CREATE TABLE IF NOT EXISTS brain_taint_flow (
  id TEXT PRIMARY KEY, project_hash TEXT NOT NULL,
  source_symbol_id TEXT, sink_symbol_id TEXT, source_type TEXT, sink_type TEXT,
  vulnerability_type TEXT, severity TEXT, flow_path TEXT,
  is_mitigated INTEGER DEFAULT 0, cross_language_boundaries INTEGER DEFAULT 0,
  time_created INTEGER, time_updated INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS brain_content_fts USING fts5(file_id, content, tokenize='porter');

CREATE INDEX IF NOT EXISTS idx_symbols_project ON brain_symbol(project_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON brain_symbol(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON brain_symbol(name);
CREATE INDEX IF NOT EXISTS idx_symbols_type ON brain_symbol(symbol_type);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON brain_relationship(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON brain_relationship(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON brain_relationship(relationship_type);
CREATE INDEX IF NOT EXISTS idx_relationships_project ON brain_relationship(project_hash);
CREATE INDEX IF NOT EXISTS idx_imports_file ON brain_import(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_project ON brain_import(project_hash);
CREATE INDEX IF NOT EXISTS idx_files_project ON brain_file(project_hash);
CREATE INDEX IF NOT EXISTS idx_files_language ON brain_file(language);
CREATE INDEX IF NOT EXISTS idx_taint_project ON brain_taint_flow(project_hash);
CREATE INDEX IF NOT EXISTS idx_sym_proj_name ON brain_symbol(project_hash, name);

CREATE TABLE IF NOT EXISTS checkpoints (
  project_hash TEXT PRIMARY KEY, total_files INTEGER, processed_files INTEGER,
  completed_files TEXT, last_processed_file TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS index_status (
  project_hash TEXT PRIMARY KEY, status TEXT DEFAULT 'idle',
  files_indexed INTEGER DEFAULT 0, symbols_indexed INTEGER DEFAULT 0,
  relationships_found INTEGER DEFAULT 0, last_indexed_at INTEGER, error_message TEXT
);
`

export const MIGRATIONS: Record<number, string> = { 1: MIGRATION_V1 }
