import { sqliteTable, text, integer, real, blob, index, primaryKey } from "drizzle-orm/sqlite-core"
import type { ProjectID } from "../project/schema"
import { ProjectTable } from "../project/project.sql"

// Shared timestamp columns for every brain table.
const Timestamps = {
  time_created: integer("time_created").notNull(),
  time_updated: integer("time_updated").notNull(),
} as const

// Universal Project Brain Database Schema
// Supports ANY programming language with cross-language relationship mapping
// Based on ProxiCall Brain architecture but designed for universal intelligence

// ================================================================
// CORE ENTITIES - Universal across all languages
// ================================================================

export const BrainFileTable = sqliteTable(
  "brain_file",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    relative_path: text().notNull(),
    file_hash: text().notNull(),
    size_bytes: integer(),
    line_count: integer(),
    language: text(),
    last_modified: real(),
    indexed_at: text(),
    layer: text(), // e.g., "ui", "business", "data", "infrastructure"
    is_test_file: integer({ mode: "boolean" }),
    is_config_file: integer({ mode: "boolean" }),
    is_documentation: integer({ mode: "boolean" }),
    framework_type: text(), // e.g., "react", "flutter", "express", "django"
    has_syntax_errors: integer({ mode: "boolean" }).notNull().default(false),
    error_report: text({ mode: "json" }),
    ...Timestamps,
  },
  (table) => [
    index("brain_file_project_idx").on(table.project_id),
    index("brain_file_path_idx").on(table.path),
    index("brain_file_language_idx").on(table.language),
    index("brain_file_hash_idx").on(table.file_hash),
    index("brain_file_syntax_errors_idx").on(table.has_syntax_errors),
    // COMPOUND INDEXES for ultra-fast lookups
    index("brain_file_proj_path_idx").on(table.project_id, table.path),
    index("brain_file_proj_hash_idx").on(table.project_id, table.file_hash),
  ],
)

export const BrainSymbolTable = sqliteTable(
  "brain_symbol",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    file_id: text()
      .notNull()
      .references(() => BrainFileTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    qualified_name: text(), // Full namespace/module path
    symbol_type: text().notNull(), // "function", "class", "variable", "interface", "enum", "type", etc.
    line_start: integer(),
    line_end: integer(),
    byte_start: integer(),
    byte_end: integer(),
    return_type: text(),
    parameters: text({ mode: "json" }),
    docstring: text(),
    visibility: text(), // "public", "private", "protected", "internal"
    is_async: integer({ mode: "boolean" }),
    is_static: integer({ mode: "boolean" }),
    is_abstract: integer({ mode: "boolean" }),
    is_override: integer({ mode: "boolean" }),
    is_getter: integer({ mode: "boolean" }),
    is_setter: integer({ mode: "boolean" }),
    complexity: integer(),
    owner_symbol_id: text(), // Parent class/namespace
    scope_kind: text(), // "global", "class", "function", "module"
    is_declaration: integer({ mode: "boolean" }), // #612: analyzer-published declaration (c prototype, cpp/rust/zig signature form); NULL/0 = definition
    annotations: text({ mode: "json" }), // Language-specific annotations/decorators
    generic_parameters: text({ mode: "json" }),
    qualified_calls: text({ mode: "json" }), // ProxiCall-style: JSON array of qualified call strings extracted as-is
    gravity_score: real().default(0),
    layer: text().default("core"),
    api_contract_path: text(), // Deterministic mapping: Exact Route URL or Fetch URL for 100% accurate cross-language links
    ...Timestamps,
  },
  (table) => [
    index("brain_symbol_project_idx").on(table.project_id),
    index("brain_symbol_file_idx").on(table.file_id),
    index("brain_symbol_name_idx").on(table.name),
    index("brain_symbol_type_idx").on(table.symbol_type),
    index("brain_symbol_qualified_idx").on(table.qualified_name),
    index("brain_symbol_owner_idx").on(table.owner_symbol_id),
    // COMPOUND INDEXES for ultra-fast lookups
    index("brain_sym_proj_file_idx").on(table.project_id, table.file_id),
    index("brain_sym_proj_name_idx").on(table.project_id, table.name),
    index("brain_sym_proj_type_idx").on(table.project_id, table.symbol_type),
    // Tool query: find symbol by project + name + type (callers/callees trace)
    index("brain_sym_proj_name_type_idx").on(table.project_id, table.name, table.symbol_type),
  ],
)

// ================================================================
// RELATIONSHIPS - Cross-language intelligence core
// ================================================================

export const BrainRelationshipTable = sqliteTable(
  "brain_relationship",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    source_symbol_id: text()
      .references(() => BrainSymbolTable.id, { onDelete: "cascade" }),
    target_symbol_id: text().references(() => BrainSymbolTable.id, { onDelete: "set null" }),
    source_external: text(), // For unresolved / external sources (when source is a string but symbol not declared)
    target_external: text(), // For external dependencies
    relationship_type: text().notNull(), // "calls", "extends", "implements", "uses", "imports", "exports", etc.
    confidence: real().notNull(), // 0.0 to 1.0 - AI confidence in relationship
    context: text(), // Additional context about the relationship
    line_number: integer(), // Where relationship occurs
    is_cross_language: integer({ mode: "boolean" }), // True for relationships across languages
    bridge_mechanism: text(), // How cross-language bridge works (API, FFI, etc.)
    is_cross_file: integer({ mode: "boolean" }).notNull().default(false), // Fast UI stat index
    metadata: text({ mode: "json" }), // Flexible metadata storage
    ...Timestamps,
  },
  (table) => [
    index("brain_rel_project_idx").on(table.project_id),
    index("brain_rel_source_idx").on(table.source_symbol_id),
    index("brain_rel_target_idx").on(table.target_symbol_id),
    // Enrichment in-degree: GROUP BY target_symbol_id WHERE project_id
    index("brain_rel_proj_target_idx").on(table.project_id, table.target_symbol_id),
    index("brain_rel_type_idx").on(table.relationship_type),
    index("brain_rel_confidence_idx").on(table.confidence),
    index("brain_rel_cross_lang_idx").on(table.is_cross_language),
    index("brain_rel_cross_file_idx").on(table.is_cross_file),
    // COMPOUND INDEXES for ultra-fast lookups
    index("brain_rel_proj_source_idx").on(table.project_id, table.source_symbol_id),
    index("brain_rel_proj_target_idx").on(table.project_id, table.target_symbol_id),
    index("brain_rel_proj_type_idx").on(table.project_id, table.relationship_type),
    // Tool query: find callers/callees by target symbol + relationship type
    index("brain_rel_target_type_idx").on(table.target_symbol_id, table.relationship_type),
    // M29.R3: hover's cross-language probes (is_cross_language = 1 AND
    // target/source_symbol_id = ?) need the composite form — see schema-ddl.ts.
    index("brain_rel_target_cross_idx").on(table.target_symbol_id, table.is_cross_language),
    index("brain_rel_source_cross_idx").on(table.source_symbol_id, table.is_cross_language),
  ],
)

// ================================================================
// IMPORTS/EXPORTS - Dependency tracking
// ================================================================

export const BrainImportTable = sqliteTable(
  "brain_import",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    file_id: text()
      .notNull()
      .references(() => BrainFileTable.id, { onDelete: "cascade" }),
    imported_name: text().notNull(),
    imported_as: text(), // Alias name
    import_path: text().notNull(),
    import_type: text().notNull(), // "default", "named", "namespace", "side_effect"
    is_external: integer({ mode: "boolean" }), // External package vs internal
    package_name: text(), // For external imports
    line_number: integer(),
    is_dynamic: integer({ mode: "boolean" }), // Dynamic imports
    resolved_symbol_id: text(), // Link to actual symbol if internal
    ...Timestamps,
  },
  (table) => [
    index("brain_import_project_idx").on(table.project_id),
    index("brain_import_file_idx").on(table.file_id),
    index("brain_import_path_idx").on(table.import_path),
    index("brain_import_name_idx").on(table.imported_name),
    index("brain_import_external_idx").on(table.is_external),
  ],
)

// ================================================================
// PATTERNS - Framework & architectural intelligence
// ================================================================

// ================================================================
// SECURITY & DATA-FLOW INTELLIGENCE (taint flow)
// ================================================================

export const BrainTaintFlowTable = sqliteTable(
  "brain_taint_flow",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    source_symbol_id: text().references(() => BrainSymbolTable.id, { onDelete: "cascade" }),
    sink_symbol_id: text().references(() => BrainSymbolTable.id, { onDelete: "cascade" }),
    source_type: text().notNull(), // "user_input", "database_read", "network_receive"
    sink_type: text().notNull(), // "database_write", "log_output", "shell_execution", "http_response"
    vulnerability_type: text().notNull(), // "sql_injection", "xss", "pii_leak", "command_injection"
    severity: text().notNull(), // "critical", "high", "medium", "low"
    is_mitigated: integer({ mode: "boolean" }).notNull().default(false),
    flow_path: text({ mode: "json" }), // Array of intermediate symbol IDs
    cross_language_boundaries: integer().notNull().default(0),
    mitigation_steps: text({ mode: "json" }),
    ...Timestamps,
  },
  (table) => [
    index("brain_taint_project_idx").on(table.project_id),
    index("brain_taint_source_idx").on(table.source_symbol_id),
    index("brain_taint_sink_idx").on(table.sink_symbol_id),
    index("brain_taint_vuln_idx").on(table.vulnerability_type),
    index("brain_taint_severity_idx").on(table.severity),
  ],
)



// ============================================================================
// ANALYSIS HISTORY - reusable run/finding lifecycle
// ============================================================================

export const BrainAnalysisRunTable = sqliteTable(
  "brain_analysis_run",
  {
    id: text().primaryKey(),
    project_id: text().$type<ProjectID>().notNull().references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    status: text().notNull(),
    engine_version: text().notNull(),
    input_hash: text().notNull(),
    started_at: integer().notNull(),
    completed_at: integer(),
    finding_count: integer().notNull().default(0),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    index("brain_analysis_run_project_idx").on(table.project_id),
    index("brain_analysis_run_kind_idx").on(table.kind),
    index("brain_analysis_run_started_idx").on(table.started_at),
  ],
)

export const BrainAnalysisFindingTable = sqliteTable(
  "brain_analysis_finding",
  {
    id: text().primaryKey(),
    project_id: text().$type<ProjectID>().notNull().references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    fingerprint: text().notNull(),
    rule: text().notNull(),
    title: text().notNull(),
    severity: text().notNull(),
    state: text().notNull(),
    confidence: real(),
    evidence: text({ mode: "json" }),
    first_seen_at: integer().notNull(),
    last_seen_at: integer().notNull(),
    resolved_at: integer(),
    suppressed_at: integer(),
    mitigated_at: integer(),
    occurrence_count: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("brain_analysis_finding_project_idx").on(table.project_id),
    index("brain_analysis_finding_fingerprint_idx").on(table.project_id, table.kind, table.fingerprint),
    index("brain_analysis_finding_state_idx").on(table.project_id, table.state),
  ],
)

export const BrainAnalysisOccurrenceTable = sqliteTable(
  "brain_analysis_occurrence",
  {
    id: text().primaryKey(),
    finding_id: text().notNull().references(() => BrainAnalysisFindingTable.id, { onDelete: "cascade" }),
    run_id: text().notNull().references(() => BrainAnalysisRunTable.id, { onDelete: "cascade" }),
    state: text().notNull(),
    location: text(),
    evidence: text({ mode: "json" }),
    observed_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("brain_analysis_occurrence_finding_idx").on(table.finding_id),
    index("brain_analysis_occurrence_run_idx").on(table.run_id),
  ],
)


// ================================================================
// INTELLIGENCE CACHE - Query optimization & pattern recognition
// ================================================================

export const BrainQueryCacheTable = sqliteTable(
  "brain_query_cache",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    query_type: text().notNull(), // "call_graph", "impact_analysis", "feature_map", etc.
    query_hash: text().notNull(),
    query_params: text({ mode: "json" }),
    result_data: text({ mode: "json" }),
    confidence: real().notNull(),
    computation_time_ms: integer(),
    cache_expires_at: integer(),
    hit_count: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("brain_cache_project_idx").on(table.project_id),
    index("brain_cache_query_type_idx").on(table.query_type),
    index("brain_cache_hash_idx").on(table.query_hash),
    index("brain_cache_expires_idx").on(table.cache_expires_at),
  ],
)

// ================================================================
// ARCHITECTURAL HEALTH - Project Metrics & Security (Phase 3)
// ================================================================

export const BrainProjectHealthTable = sqliteTable("brain_project_health", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  complexity_score: integer().notNull().default(0), // 0-100
  maintainability_score: integer().notNull().default(0), // 0-100
  technical_debt_score: integer().notNull().default(0), // 0-100
  code_quality_score: integer().notNull().default(0), // 0-100
  language_distribution: text({ mode: "json" }), // LanguageMetric[]
  service_metrics: text({ mode: "json" }), // ServiceMetric[]
  dependency_metrics: text({ mode: "json" }), // DependencyMetric
  circular_dependencies: text({ mode: "json" }), // string[][]
  contract_drift: text({ mode: "json" }), // string[]
  performance_bottlenecks: text({ mode: "json" }), // string[]
  ...Timestamps,
})

// ================================================================
// INDEXING STATUS - Track what's been processed
// ================================================================

export const BrainIndexStatusTable = sqliteTable("brain_index_status", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  status: text(), // M21.I2: persisted complete/partial status (previously dropped)
  last_full_index: integer(), // Timestamp
  last_incremental_index: integer(),
  total_files: integer().notNull().default(0),
  indexed_files: integer().notNull().default(0),
  total_symbols: integer().notNull().default(0),
  total_relationships: integer().notNull().default(0),
  indexing_version: text().notNull(), // Schema version for migrations
  languages_detected: text({ mode: "json" }), // Array of languages found
  frameworks_detected: text({ mode: "json" }), // Array of frameworks detected
  indexing_errors: text({ mode: "json" }), // Array of error messages
  performance_stats: text({ mode: "json" }), // Indexing performance metrics
  ...Timestamps,
})

// ================================================================
// SEMANTIC EMBEDDINGS - Vector search for conceptual understanding
// ================================================================

export const BrainSemanticEmbeddingTable = sqliteTable(
  "brain_semantic_embedding",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    entity_id: text().notNull(), // Can be symbol_id, file_id, or pattern_id
    entity_type: text().notNull(), // "symbol", "file", "pattern", "comment", "documentation"
    embedding_model: text().notNull(), // "openai-ada-002", "sentence-transformers", etc.
    embedding_vector: text().notNull(), // JSON array of floats (source of truth)
    // M50.A2 (#764): little-endian float32 accelerator for dense vectors; NULL
    // on legacy rows (readers then use embedding_vector). Additive migration:
    // ensureEmbeddingBlobColumn() in schema-ddl.ts.
    embedding_blob: blob("embedding_blob", { mode: "buffer" }),
    vector_dimension: integer().notNull(),
    content_hash: text().notNull(), // Hash of content that generated embedding
    semantic_context: text({ mode: "json" }), // Additional context for better search
    similarity_threshold: real().default(0.7), // Minimum similarity for matches
    last_updated: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("brain_embed_project_idx").on(table.project_id),
    index("brain_embed_entity_idx").on(table.entity_id),
    index("brain_embed_type_idx").on(table.entity_type),
    index("brain_embed_model_idx").on(table.embedding_model),
    index("brain_embed_hash_idx").on(table.content_hash),
  ],
)
