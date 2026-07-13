// Database Schema — All CREATE TABLE statements as raw SQL
// Ported from backbencher's Drizzle ORM schema (brain.sql.ts)
// Uses raw SQL for zero-dependency, maximum simplicity

export const SCHEMA_VERSION = 1

// ============================================================================
// MIGRATION 1 — Initial schema (all tables + indexes)
// ============================================================================

const MIGRATION_V1 = `
-- ================================================================
-- FILES — One row per source file in the project
-- ================================================================
CREATE TABLE IF NOT EXISTS brain_file (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  size_bytes INTEGER,
  line_count INTEGER,
  language TEXT,
  framework TEXT,
  layer TEXT DEFAULT 'core',
  is_test INTEGER DEFAULT 0,
  is_config INTEGER DEFAULT 0,
  last_modified INTEGER,
  indexed_at INTEGER
);

-- ================================================================
-- SYMBOLS — Functions, classes, variables, interfaces, etc.
-- ================================================================
CREATE TABLE IF NOT EXISTS brain_symbol (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qualified_name TEXT,
  symbol_type TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  byte_start INTEGER,
  byte_end INTEGER,
  visibility TEXT DEFAULT 'public',
  is_static INTEGER DEFAULT 0,
  is_async INTEGER DEFAULT 0,
  is_abstract INTEGER DEFAULT 0,
  parameters TEXT,
  return_type TEXT,
  qualified_calls TEXT,
  complexity INTEGER DEFAULT 1,
  gravity_score REAL DEFAULT 0,
  layer TEXT DEFAULT 'core',
  owner_symbol_id TEXT,
  annotations TEXT,
  generic_parameters TEXT,
  docstring TEXT
);

-- ================================================================
-- RELATIONSHIPS — Directed edges between symbols
-- ================================================================
CREATE TABLE IF NOT EXISTS brain_relationship (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_symbol_id TEXT NOT NULL REFERENCES brain_symbol(id) ON DELETE CASCADE,
  target_symbol_id TEXT,
  target_external TEXT,
  relationship_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  line_number INTEGER,
  is_cross_file INTEGER DEFAULT 0,
  is_cross_language INTEGER DEFAULT 0,
  bridge_mechanism TEXT
);

-- ================================================================
-- IMPORTS — File-level import statements
-- ================================================================
CREATE TABLE IF NOT EXISTS brain_import (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
  imported_name TEXT NOT NULL,
  import_path TEXT NOT NULL,
  import_type TEXT,
  is_external INTEGER DEFAULT 0,
  line_number INTEGER
);

-- ================================================================
-- TAINT FLOWS — Security vulnerability traces
-- ================================================================
CREATE TABLE IF NOT EXISTS brain_taint_flow (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_symbol_id TEXT,
  sink_symbol_id TEXT,
  source_type TEXT,
  sink_type TEXT,
  vulnerability_type TEXT,
  severity TEXT,
  flow_path TEXT,
  is_mitigated INTEGER DEFAULT 0
);

-- ================================================================
-- FULL-TEXT SEARCH — FTS5 for content search
-- ================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS brain_content_fts USING fts5(
  file_id,
  content,
  tokenize='porter'
);

-- ================================================================
-- INDEXES — For fast lookups
-- ================================================================

-- Symbol indexes
CREATE INDEX IF NOT EXISTS idx_symbols_project ON brain_symbol(project_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON brain_symbol(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON brain_symbol(name);
CREATE INDEX IF NOT EXISTS idx_symbols_type ON brain_symbol(symbol_type);

-- Relationship indexes
CREATE INDEX IF NOT EXISTS idx_relationships_source ON brain_relationship(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON brain_relationship(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON brain_relationship(relationship_type);
CREATE INDEX IF NOT EXISTS idx_relationships_project ON brain_relationship(project_id);

-- Compound indexes for common JOIN patterns
CREATE INDEX IF NOT EXISTS idx_sym_proj_name ON brain_symbol(project_id, name);
CREATE INDEX IF NOT EXISTS idx_sym_proj_file ON brain_symbol(project_id, file_id);

-- Import indexes
CREATE INDEX IF NOT EXISTS idx_imports_file ON brain_import(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_project ON brain_import(project_id);

-- File indexes
CREATE INDEX IF NOT EXISTS idx_files_project ON brain_file(project_id);
CREATE INDEX IF NOT EXISTS idx_files_language ON brain_file(language);

-- Taint flow index
CREATE INDEX IF NOT EXISTS idx_taint_project ON brain_taint_flow(project_id);

-- ================================================================
-- MANAGEMENT TABLES
-- ================================================================

-- Checkpoints for crash recovery during indexing
CREATE TABLE IF NOT EXISTS checkpoints (
  project_id TEXT PRIMARY KEY,
  total_files INTEGER,
  processed_files INTEGER,
  completed_files TEXT,
  last_processed_file TEXT,
  created_at INTEGER
);

-- Index status tracking
CREATE TABLE IF NOT EXISTS index_status (
  project_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'idle',
  files_indexed INTEGER DEFAULT 0,
  symbols_indexed INTEGER DEFAULT 0,
  relationships_found INTEGER DEFAULT 0,
  last_indexed_at INTEGER,
  error_message TEXT
);
`

// ============================================================================
// MIGRATIONS MAP
// ============================================================================

export const MIGRATIONS: Record<number, string> = {
  1: MIGRATION_V1,
}
