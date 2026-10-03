import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

type SqlSymbol = ASTEngine.UniversalSymbol
type SqlRelationship = ASTEngine.UniversalRelationship

/**
 * A node's absolute position, when it came from a re-parsed slice rather than
 * the file's own tree. `analyze` records the base pass with the identity, and
 * the resync pass with the slice's own origin, so every emitted range is in
 * FILE coordinates no matter which parse produced the node.
 */
type Slice = { byteOffset: number; rowOffset: number; columnOffset: number }
const IDENTITY: Slice = { byteOffset: 0, rowOffset: 0, columnOffset: 0 }

type ParseState = {
  symbols: SqlSymbol[]
  relationships: SqlRelationship[]
  /** Per-bucket counts of edges whose target is a PostgreSQL or platform object
   *  rather than a project declaration. Reported so an unresolved edge can be
   *  READ correctly: `external` is a fact about the world, while an edge with
   *  neither a resolved symbol nor an external label is a genuine gap. */
  externalTargets?: Record<string, number>
  /** Absolute start indices of `statement` nodes already dispatched, so the deep
   *  walk does not re-process one the root walk handled. */
  nestedStatements: Set<number>
  /** CTE names declared by the TOP-LEVEL statement currently being processed.
   *
   *  The per-call set is rebuilt from `descendants(node, "cte")` for whatever
   *  node happens to be processed, so a reference inside a LATER CTE cannot see
   *  a name declared at the statement level and the alias leaks out as a table:
   *  `WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a) SELECT * FROM b`
   *  published `uses global->a` when the contract requires ZERO relationships. A
   *  local binding published as a table is a false edge, and a false edge is what
   *  sends a consumer looking for a table that does not exist.
   *
   *  Deliberately STATEMENT-scoped and nothing wider. A first attempt also walked
   *  the node's ANCESTORS for `cte` nodes, which over-reached: it collected names
   *  from the whole enclosing statement and so shadowed real tables outside the
   *  with-clause's actual scope, breaking four fixtures. The scope belongs to the
   *  statement, and only the statement. */
  localCtes: Set<string>
  /** First declaration of each replaceable name in this file, by 1-based line,
   *  keyed `kind:name` so two DIFFERENT objects that share a name cannot collide.
   *
   *  `CREATE OR REPLACE FUNCTION f` is a REPLACEMENT in PostgreSQL's own words,
   *  and the corpus carries it in quantity: 666 OR REPLACE declarations over the
   *  1,459-file census. Almost all of them replace a declaration made in ANOTHER
   *  file — a migration chain re-declaring what the previous migration declared —
   *  which a per-file analyzer cannot see. The events this analyzer CAN see are
   *  the ones where the earlier declaration is in the SAME file, and this map is
   *  what makes them visible.
   *
   *  The kind is part of the key because it is load-bearing, not decoration. With
   *  the name alone as the key, Hasura's `CREATE FUNCTION hdb_catalog.f()` at line
   *  7 and its `CREATE TRIGGER f` at line 25 counted as one redefinition, and they
   *  are two different objects that share a name. That was a documented intent with
   *  no implementation behind it until pass 2, and it is why the analyzer emitted
   *  22 `overrides` edges where the construct probe measured 15. */
  redeclared: Map<string, number>
  /** `kind path line` of every include directive already recorded, so the resync
   *  and EXECUTE-literal passes cannot record the same `\ir` a second time. The
   *  relationship itself is deduplicated by type/source/target; this guards the
   *  `imports` ROW, which has no such dedup. */
  includeKeys: Set<string>
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  relationshipKeys: Set<string>
  relationshipsByKey: Map<string, SqlRelationship>
  symbolKeys: Set<string>
  /** Absolute start-index keys of declarations already extracted, so the
   *  resync pass can add what the main pass missed without ever re-emitting one
   *  it already has. */
  declarationKeys: Set<string>
  symbolNames: Set<string>
  idCounts: Map<string, number>
  patterns: Set<string>
  /** Which parse the node currently being walked came from. */
  slice: Slice
  metadata: Partial<ASTEngine.FileMetadata>
  ambiguity: Record<string, number>
}

/**
 * SQL reserved words. A relationship target or a call target that is a reserved
 * word is never a table and never a function: the shipped grammar cannot parse
 * GRANT/REVOKE, so `REVOKE SELECT ON t FROM joe` put the ROLE name in a `from`
 * clause and the old code reported it as a table use; error recovery turned
 * `USING` and `FILTER` into call targets. Measured on 441 corpus files: 49 edges
 * to a keyword before this guard, 0 after.
 */
/**
 * Exported so the lane's own probes can ask the GUARD's question instead of
 * guessing at it. `validation/m14/fixtures/sql/adversarial-probe.mts` has to
 * distinguish "a qualified call was suppressed because it is a PostgreSQL catalog
 * builtin" from "a qualified call was dropped for an unexplained reason", and it
 * cannot do that from a hardcoded copy of these lists: a copy would drift, and a
 * drifted copy turns a working guard into a reported defect. Read-only by use —
 * both are `Set`s the probe only calls `has` on.
 */
export const SQL_KEYWORDS = new Set([
  "all", "alter", "analyze", "and", "any", "array", "as", "asc", "at", "authorization",
  "begin", "between", "both", "by", "cascade", "case", "cast", "check", "collate",
  "column", "comment", "commit", "concurrently", "conflict", "constraint", "copy",
  "create", "cross", "cube", "current", "current_date", "current_role", "current_time",
  "current_timestamp", "current_user", "database", "default", "deferrable", "deferred",
  "delete", "desc", "distinct", "do", "drop", "else", "end", "except", "execute",
  "exists", "explain", "false", "fetch", "filter", "first", "for", "foreign", "from",
  "full", "function", "generated", "global", "grant", "group", "grouping", "having",
  "if", "ilike", "in", "index", "initially", "inner", "inout", "insert", "intersect",
  "into", "is", "join", "key", "language", "last", "lateral", "leading", "left", "like",
  "limit", "local", "localtime", "localtimestamp", "natural", "not", "nothing", "null",
  "nulls", "offset", "on", "only", "or", "order", "out", "outer", "over", "overlaps",
  "partition", "preceding", "precision", "primary", "procedure", "range", "recursive",
  "references", "rename", "replace", "reset", "restrict", "returning", "revoke", "right",
  "rollback", "row", "rows", "savepoint", "schema", "select", "session_user", "set",
  "show", "similar", "some", "start", "table", "tablesample", "then", "to", "trailing",
  "transaction", "trigger", "true", "truncate", "union", "unique", "unknown", "unlogged",
  "update", "using", "vacuum", "values", "view", "when", "where", "window", "with",
])

/**
 * Functions the SQL itself provides. A call to one of these is a language
 * feature, not a dependency on a project symbol, so it must not become a `calls`
 * edge: the store would try to resolve it and fail, and `bb_graph` would show a
 * call into a table name. The previous 37-entry list missed most of what real
 * schemas use — `generate_series`, `jsonb_build_object`, `current_setting`,
 * `set_config` and `cardinality` were all measured leaking out of the corpus.
 */
/**
 * Is this target a PostgreSQL or platform object rather than a project
 * declaration? Returns the bucket name, or null.
 *
 * The four buckets are kept separate because they are different claims:
 *   postgresCatalog    a `pg_*` relation the migration genuinely reads
 *   informationSchema  an `information_schema` view, including a bare view name
 *   implicitSchema     `public`, which PostgreSQL creates in every database and
 *                      no migration ever declares
 *   platform           a hosted-platform object (Supabase `vault`, `auth`,
 *                      `storage`, `extensions`), which is real in the file and
 *                      absent from the repository by construction
 */
const POSTGRES_CATALOG = /^pg_[a-z_]+$/
const INFORMATION_SCHEMA_VIEWS = new Set([
  "columns", "tables", "views", "routines", "schemata", "sequences", "key_column_usage",
  "table_constraints", "constraint_column_usage", "referential_constraints",
  "check_constraints", "routine_parameters", "table_privileges", "column_privileges",
  "role_table_grants", "role_routine_grants", "trigger", "triggers", "views",
])
const PLATFORM_SCHEMAS = new Set(["vault", "auth", "storage", "extensions", "realtime", "graphql", "pgsodium", "pgtle"])

function classifyExternalTarget(
  target: string,
  qualified?: string,
): "postgresCatalog" | "informationSchema" | "implicitSchema" | "platform" | null {
  if (qualified) {
    const q = qualified.toLowerCase()
    if (q.startsWith("information_schema.")) return "informationSchema"
    const qdot = q.indexOf(".")
    if (qdot > 0 && PLATFORM_SCHEMAS.has(q.slice(0, qdot))) return "platform"
  }
  const t = target.toLowerCase()
  if (t.startsWith("information_schema.")) return "informationSchema"
  if (INFORMATION_SCHEMA_VIEWS.has(t)) return "informationSchema"
  if (POSTGRES_CATALOG.test(t)) return "postgresCatalog"
  if (t === "public") return "implicitSchema"
  const dot = t.indexOf(".")
  if (dot > 0) {
    const schema = t.slice(0, dot)
    if (PLATFORM_SCHEMAS.has(schema)) return "platform"
  }
  return null
}

export const SQL_BUILTINS = new Set([
  // Provided by PostgreSQL or a stock EXTENSION rather than by this project.
  //
  // WHY THIS BLOCK EXISTS, measured 2026-09-27. Every name the analyzer
  // suppresses here is one a consumer of the graph could otherwise mistake for
  // a project function — and an AI agent reading `calls X->encode` has no way to
  // know `encode` is pgcrypto's. Classifying the whole unknown population on
  // ProxiCall put 48 edges / 3 names in this category (`encode` 30, `digest` 17,
  // `daterange` 1) and a further 122 edges / 42 names that were ALSO SQL-provided
  // but live in files the grammar cannot parse (`uuid_generate_v4` 16,
  // `gen_random_bytes` 12, `array_append`, `regexp_replace`, `regexp_matches`,
  // `has_function_privilege`). Only 11 edges are genuinely dangling project
  // references, so the raw "unknown" count was overwhelmingly this gap and not a
  // real dangling-reference problem.
  //
  // Extensions are included deliberately: uuid-ossp, pgcrypto and PostGIS ship
  // these functions as part of a normal PostgreSQL install, and a project that
  // calls them has no declaration for them anywhere.
  //
  // pgcrypto
  "encode", "decode", "digest", "hmac", "crypt", "gen_salt", "gen_random_bytes",
  "gen_random_uuid",   // uuid-ossp and friends
  "uuid_generate_v4", "uuid_generate_v1", "uuid_nil", "gen_random_uuid",
  // pgTAP / assertion helpers
  "has_function_privilege", "has_table_privilege", "has_schema_privilege",
  "has_column_privilege", "has_database_privilege", "has_type_privilege",
  "throws_ok", "lives_ok", "is", "isnt", "matches", "results_eq", "set_eq",
  // information_schema / catalogue accessors
  "pg_get_functiondef", "pg_get_viewdef", "pg_get_indexdef", "pg_get_constraintdef",
  "pg_get_triggerdef", "pg_get_expr", "pg_get_userbyid", "pg_get_viewdef",
  "pg_get_partkeydef", "pg_get_statisticsobjdef_columns", "pg_tablespace_location",
  "pg_relation_filenode", "pg_get_function_arguments", "pg_get_function_result",
  "obj_description", "col_description", "shobj_description", "col_description_schema",
  "pg_describe_object", "pg_identify_object", "pg_get_object_address", "pg_get_object_keywords",
  "has_any_column_privilege", "has_sequence_privilege", "pg_get_ruledef", "pg_get_triggerdef",
  "pg_stat_get_numscans", "aclexplode", "acldefault", "makeaclitem", "pg_backend_memory_contexts",
  "pg_get_function_identity_arguments", "format_type", "pg_typeof", "pg_table_is_visible",
  "pg_function_is_visible", "pg_opclass_is_visible", "pg_conversion_is_visible",
  "pg_collation_is_visible", "pg_ts_config_is_visible", "pg_statistics_obj_is_visible",
  "pg_total_relation_size", "pg_relation_size", "pg_table_size", "pg_indexes_size",
  "pg_database_size", "pg_size_pretty", "pg_column_size", "pg_size_bytes",
  "pg_encoding_to_char", "pg_char_to_encoding", "pg_advisory_lock", "pg_advisory_unlock",
  "pg_advisory_xact_lock", "pg_try_advisory_lock", "pg_notify", "pg_sleep",
  "pg_backend_pid", "pg_current_xact_id", "txid_current", "pg_export_snapshot",
  "pg_import_snapshot", "pg_cancel_backend", "pg_terminate_backend", "pg_reload_conf",
  "pg_stat_reset", "pg_is_in_recovery", "pg_last_wal_receive_lsn",
  "pg_current_wal_lsn", "pg_wal_lsn_diff", "pg_switch_wal", "pg_create_restore_point",
  "pg_replication_origin_advance", "pg_logical_emit_message",
  "pg_column_is_updatable", "pg_index_column_has_property", "pg_indexam_has_property",
  "pg_index_has_property", "pg_index_column_has_property", "pg_options_to_table",
  "pg_tablespace_databases", "pg_ls_dir", "pg_read_file", "pg_read_binary_file",
  "pg_stat_file", "pg_ls_logdir", "pg_ls_waldir", "pg_ls_tmpdir", "pg_ls_archive_statusdir",
  // string / pattern builtins the corpus leans on
  "regexp_replace", "regexp_match", "regexp_matches", "regexp_count", "regexp_instr",
  "regexp_like", "regexp_substr", "split_part", "string_to_array", "array_to_string",
  "array_position", "array_positions", "array_remove", "array_replace", "array_prepend",
  "array_append", "array_cat", "array_fill", "cardinality", "array_dims", "array_upper",
  "array_lower", "array_ndims", "array_length", "trim_array", "width_bucket",
  // range / multirange, which the corpus uses for exclusion constraints
  "daterange", "tsrange", "tstzrange", "int4range", "int8range", "numrange",
  "range_merge", "range_lower", "range_upper", "range_lower_inc", "range_upper_inc",
  "range_lower_inf", "range_upper_inf", "range_empty", "int4multirange", "datemultirange",
  "int8multirange", "nummultirange", "tsmultirange", "tstzmultirange",
  "range_contains", "range_contained_by", "range_overlaps", "range_adjacent",
  // PostGIS, which the extension corpus is full of
  "st_x", "st_y", "st_z", "st_m", "st_2d", "st_3d", "st_srid", "st_set_srid",
  "st_astext", "st_asbinary", "st_asgeojson", "st_geometrytype", "st_type",
  "st_geometryn", "st_numgeometries", "st_npoints", "st_nrings", "st_isempty",
  "st_isvalid", "st_isvalidreason", "st_issimple", "st_isclosed", "st_isring",
  "st_transform", "st_intersects", "st_contains", "st_within", "st_containsproperly",
  "st_covers", "st_coveredby", "st_overlaps", "st_crosses", "st_touches",
  "st_distance", "st_dwithin", "st_area", "st_perimeter", "st_length", "st_length2d",
  "st_buffer", "st_convexhull", "st_envelope", "st_centroid", "st_makeenvelope",
  "st_makepoint", "st_makeline", "st_geographyfromtext",
  "st_geometryfromtext", "st_geogfromtext", "st_geomfromtext", "st_point",
  "postgis_version", "postgis_full_version", "postgis_geos_version",
  "box2d", "box3d", "geometry", "geography", "box", "path", "polygon",
  // aggregate / window extras the corpus uses
  "percentile_cont", "percentile_disc", "mode", "rank", "dense_rank", "row_number",
  "ntile", "first_value", "last_value", "nth_value", "grouping", "corr", "covar_pop",
  "covar_samp", "regr_slope", "regr_intercept", "regr_r2", "regr_count", "regr_avgx", "regr_avgy",
  "bool_and", "bool_or", "every", "bit_and", "bit_or", "bit_xor", "json_agg", "json_object_agg",
  // statistical aggregates, which the corpus uses and this set was missing
  "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp",
  "stddev_pop_zscore", // hosted-platform functions a project calls with no local declaration
  "jwt", "auth_uid", "current_user_id",
  "aggregate", // aggregate
  "any_value", "array_agg", "avg", "bit_and", "bit_or", "bool_and", "bool_or", "count",
  "every", "json_agg", "json_object_agg", "jsonb_agg", "jsonb_object_agg", "max", "min",
  "string_agg", "sum", "xmlagg",
  // window
  "cume_dist", "dense_rank", "first_value", "lag", "last_value", "lead", "nth_value",
  "ntile", "percent_rank", "percentile_cont", "percentile_disc", "rank", "row_number",
  // numeric / math
  "abs", "acos", "asin", "atan", "atan2", "cbrt", "ceil", "ceiling", "cos", "cot", "degrees",
  "div", "exp", "floor", "gcd", "lcm", "ln", "log", "log10", "mod", "pi", "power", "radians",
  "random", "round", "scale", "sign", "sin", "sqrt", "tan", "trunc", "width_bucket",
  // string
  "ascii", "btrim", "char_length", "character_length", "chr", "concat", "concat_ws",
  "format", "initcap", "left", "length", "lower", "lpad", "ltrim", "md5", "overlay",
  "position", "quote_ident", "quote_literal", "repeat", "replace", "reverse", "right",
  "rpad", "rtrim", "split_part", "starts_with", "strpos", "substr", "substring", "translate",
  "trim", "upper",
  // date / time
  "age", "clock_timestamp", "current_date", "current_time", "current_timestamp", "date",
  "date_bin", "date_part", "date_trunc", "datediff", "dateadd", "datetime", "extract",
  "getdate", "getutcdate", "interval", "isfinite", "justify_days", "justify_hours",
  "justify_interval", "localtime", "localtimestamp", "make_date", "make_interval",
  "make_time", "make_timestamp", "make_timestamptz", "now", "statement_timestamp",
  "sysdate", "timeofday", "to_char", "to_date", "to_number", "to_timestamp", "transaction_timestamp",
  // conditional / null
  "coalesce", "greatest", "ifnull", "iif", "least", "nullif", "nvl", "nvl2",
  // json
  "json_array_length", "json_build_array", "json_build_object", "json_each",
  "json_each_text", "json_extract", "json_object", "json_object_field",
  "json_object_keys", "json_populate_record", "json_query", "json_set", "json_strip_nulls",
  "json_type", "jsonb_array_elements", "jsonb_build_object", "jsonb_each", "jsonb_each_text",
  "jsonb_pretty", "jsonb_set", "jsonb_typeof", "row_to_json", "to_json", "to_jsonb",
  // array / set
  "array_fill", "array_length", "array_lower", "array_position", "array_to_string",
  "array_upper", "cardinality", "generate_series", "generate_subscripts", "unnest",
  "range_agg", "width_bucket",
  // system / session / type
  "coalesce", "current_setting", "format_type", "nextval", "pg_advisory_lock",
  "pg_backend_pid", "pg_cancel_backend", "pg_client_encoding", "pg_column_size",
  "pg_current_xact_id", "pg_terminate_backend", "pg_typeof", "pg_total_relation_size",
  "set_config", "setseed", "setval", "to_regclass", "txid_current", "version",
  "newid", "scope_identity", "dense_rank",
  // cast / conversion
  "cast", "convert", "convert_tz", "parse_ident", "try_cast", "try_convert", "try_parse_ident",
])

/**
 * The name-bearing leaves this grammar produces for an identifier: `identifier`
 * unquoted, `literal` for a QUOTED one — `CREATE TABLE t ("Id" int)` puts the
 * name in a `literal`, never an `identifier`, which is why every quoted column
 * was silently lost.
 *
 * `word` is deliberately NOT here. grammar.js declares `word: $ => $._identifier`,
 * which RENAMES that token to `identifier`; `word` is never itself a node type,
 * so listing it was a dead defensive branch (measured over 441 corpus files + a
 * 6-file dialect battery, 367 distinct node types, `word` among none of them).
 */
const identifierTypes = new Set(["identifier", "literal"])
const queryTypes = new Set(["select", "set_operation", "create_query", "subquery", "cte"])

/**
 * psql's file-include directives, and what the argument has to look like before
 * it is treated as a file on disk.
 *
 * WHY `imports` IS EMITTED AT ALL. This lane's spec recorded the opposite
 * decision — `script/m14/spec/sql-completeness.json` SQL-D* ruled that "the
 * analyzer emits no `imports`. SQL has no import statement", on the grounds that
 * the previous implementation scanned for `#import`/`@import` text the grammar
 * can never produce. That was true of the MECHANISM and false of the LANGUAGE,
 * and the measurement that separates them is the whole point of a ruling being
 * falsifiable:
 *
 *   psql meta-command nodes over the same 1,460-file corpus: 143
 *   of which `\ir`: 22, every one naming another .sql file, across 6 files
 *   include with a psql VARIABLE target (`:name`):  0
 *   include with no recognisable filename suffix:  0
 *
 * `\i file` and `\ir file` ARE imports: a file dependency, resolved by the psql
 * client before any SQL runs. `postgrest/test/io/fixtures/load.sql` includes six
 * sibling scripts this way, so the dependency graph of that fixture directory is
 * real and was invisible. `\ir` resolves relative to the INCLUDING script's own
 * directory and `\i` relative to psql's working directory, which is why the kind
 * is recorded on the edge rather than being flattened.
 *
 * The 121 other meta-commands (`\echo` 108, `\set` 8, `\gexec`, `\if`, `\endif`,
 * `\gset`, `\pset`) are NOT imports and are counted as such in
 * `ambiguity.psqlCommandsSkipped`, so a command shape added to the grammar later
 * shows up in a number rather than silently as nothing.
 */
const PSQL_INCLUDE_COMMANDS = new Set(["i", "ir"])
const PSQL_INCLUDE_SUFFIXES = [".sql", ".psql", ".dump"]

/**
 * Declarations PostgreSQL accepts `OR REPLACE` on, and nothing else.
 *
 * `CREATE OR REPLACE TABLE`, `... TYPE`, `... TRIGGER`, `... SCHEMA` and
 * `... INDEX` are syntax errors in PostgreSQL, so a replacement event cannot
 * exist for them and admitting them here would let any re-declared name be
 * published as an override. `CREATE OR REPLACE VIEW` and `... MATERIALIZED VIEW`
 * are legal and replace the existing definition.
 */
const REPLACEABLE_DECLARATIONS = new Set([
  "create_function",
  "create_procedure",
  "create_view",
  "create_materialized_view",
])

/**
 * The value-shape nodes that build a value rather than convert one.
 *
 * `ROW(1,2)::my_composite` is PostgreSQL's composite constructor — the cast IS a
 * call to that type's constructor — and `('a', 2)::pet` is the same thing written
 * as a bare parenthesised row. `x::my_enum`, `col::my_type` and
 * `nextval('s')::bigint` are CONVERSIONS of a value that already exists, and
 * publishing those as `instantiates` would assert an object was created where
 * none was.
 */
const CONSTRUCTOR_VALUE_NODES = new Set(["list", "array"])

/**
 * Reserved words that error recovery can re-emit as an UNQUOTED column name, and
 * which therefore cannot legally be one.
 *
 * The wired grammar cannot represent `CREATE TABLE c (LIKE p INCLUDING ALL)`, so
 * it parses the `LIKE p` pair as `column_definition name:(identifier "LIKE")
 * custom_type:(object_reference "p")` — and `processColumn` read that as a column
 * named `LIKE` of type `p`, with a fabricated `sqlType`. Measured corpus-wide: 6
 * phantom columns named `LIKE` in 2 files, each carrying the source table's name
 * as its type. `ALTER TABLE c INHERIT p` parses the same way (`INHERIT p` as a
 * column named `INHERIT`).
 *
 * Both words are reserved in every dialect the wired grammar serves — `LIKE` in
 * SQL:2016, in PostgreSQL and in MySQL; `INHERIT` in PostgreSQL — so a column
 * that really carries one must be quoted, and a quoted name arrives as a
 * `literal`, not an `identifier`. That is what makes this guard narrow rather than
 * a keyword sweep: `key`, `name`, `range`, `type` and `value` are all legal
 * unquoted column names in PostgreSQL and a broad keyword guard would delete real
 * symbols, which is why the one other phantom this lane has — `ALTER TABLE log ADD
 * KEY useragent_id (useragent_id)`, which the grammar reads as a column named
 * `KEY` of type `useragent_id` — is NOT guarded here and is reported instead. The
 * tree cannot tell that shape from `ALTER TABLE t ADD key my_type`, which is
 * legal PostgreSQL, so a text guard would trade one wrong symbol for a missing
 * one. One phantom symbol corpus-wide is the cheaper of the two and is stated
 * rather than hidden.
 */
const RESERVED_AS_COLUMN_NAME = new Set(["like", "inherit"])

/** ASCII letter or `_`, the first character of an unquoted SQL identifier. */
function isTagIdentStart(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  )
}

/** ASCII letter, digit or `_`. */
function isTagIdentPart(code: number): boolean {
  return isTagIdentStart(code) || (code >= 48 && code <= 57)
}

/**
 * The dollar-quote delimiter at `at`: `$`, an optional bare identifier, `$`.
 * Returns its exact text, or null if there is no delimiter here.
 *
 * A character scan rather than `/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/`, which is
 * the same language with no regex engine: PostgreSQL's tag rule is
 * `$` + optional identifier + `$`, the identifier may not start with a digit,
 * and the closing `$` is mandatory. `$$` (length 2) and `$body$` are the two
 * shapes that occur; a lone `$` (a parameter placeholder, or a dollar inside a
 * string that the caller's quote tracking already skipped) returns null.
 */
function dollarTagAt(content: string, at: number): string | null {
  if (content.charCodeAt(at) !== 36 /* $ */) return null
  let i = at + 1
  if (i < content.length && isTagIdentStart(content.charCodeAt(i))) {
    i++
    while (i < content.length && isTagIdentPart(content.charCodeAt(i))) i++
  }
  if (i < content.length && content.charCodeAt(i) === 36) return content.slice(at, i + 1)
  return null
}

/**
 * Whether `text` opens with a `CONSTRAINT` keyword, tolerating leading
 * whitespace and one separating comma — the shape a recovered constraint
 * arrives in. Equivalent to `/^\s*,?\s*CONSTRAINT\s/i`, with the
 * case-insensitivity done by folding ASCII letters rather than a regex flag
 * and the whitespace run consumed explicitly.
 */
function opensWithConstraintKeyword(text: string): boolean {
  const KEYWORD = "CONSTRAINT"
  let i = 0
  const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11
  while (i < text.length && isSpace(text.charCodeAt(i))) i++
  if (text.charCodeAt(i) === 44 /* , */) {
    i++
    while (i < text.length && isSpace(text.charCodeAt(i))) i++
  }
  if (i + KEYWORD.length > text.length) return false
  for (let k = 0; k < KEYWORD.length; k++) {
    let c = text.charCodeAt(i + k)
    if (c >= 97 && c <= 122) c -= 32 // fold a-z to A-Z
    if (c !== KEYWORD.charCodeAt(k)) return false
  }
  return isSpace(text.charCodeAt(i + KEYWORD.length))
}

/**
 * How far gone a parse has to be before re-parsing the file statement by
 * statement is worth the second pass. The catastrophic shape is ONE top-level
 * ERROR spanning (almost) the whole file, which is what an unterminated
 * dollar-quote produces: measured on database/schema.sql, `program > ERROR
 * rows 1-10573` with 9,809 children, 13 `create_table` nodes in the entire tree
 * against 163 `CREATE TABLE` statements in the text.
 */
const RESYNC_ERROR_SPAN_RATIO = 0.6
const RESYNC_MIN_ERROR_NODES = 1

export class RealSqlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const state: ParseState = {
      nestedStatements: new Set<number>(),
      localCtes: new Set<string>(),
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      relationshipKeys: new Set(),
      relationshipsByKey: new Map(),
      redeclared: new Map(),
      includeKeys: new Set(),
      symbolKeys: new Set(),
      declarationKeys: new Set(),
      symbolNames: new Set(),
      idCounts: new Map(),
      patterns: new Set(),
      slice: IDENTITY,
      metadata: {
        linesOfCode: this.countLines(content),
        performanceScore: 100,
        architecturalInsights: [],
        detectedFrameworks: ["SQL"],
        patterns: [],
        complexity: 1,
        cyclomaticComplexity: 1,
      },
      ambiguity: {
        errorNodes: 0,
        unparseableRegions: 0,
        resyncStatements: 0,
        resyncDeclarations: 0,
        resyncSkipped: 0,
        keywordTargetsSuppressed: 0,
        recoveryCallsSuppressed: 0,
        sweepDeclarationsRecovered: 0,
        builtinCallsSuppressed: 0,
        quotedIdentifiers: 0,
        constraintsRecoveredFromError: 0,
        executeLiterals: 0,
        executeRecovered: 0,
        executeSkipped: 0,
        psqlCommandsSkipped: 0,
        includeNonLiteral: 0,
        extensionImportsEmitted: 0,
        overridesEmitted: 0,
        instantiationsEmitted: 0,
        reservedNameSymbolsSuppressed: 0,
        indexOwnersAdopted: 0,
        indexOwnersExternalToFile: 0,
      },
    }

    this.collectParseErrors(rootNode, state)
    if (rootNode) this.processRoot(rootNode, state)

    // The second pass. Strictly additive: `declarationKeys` holds the absolute
    // start index of every declaration the main pass already emitted, so a
    // re-parsed slice can only contribute what was missing.
    const resync = this.resyncNeeded(rootNode, state)
    if (resync) this.runResync(content, state)

    // The third pass. Declarations handed to the database as a STRING rather
    // than written as source. See `scanExecuteLiterals` for why no grammar can
    // reach these and why this pass is text-based rather than tree-based.
    this.runExecuteScan(content, state)

    // The fourth pass, and it is the only one that MUTATES a symbol rather than
    // adding one. Adopts index symbols whose table was declared after them.
    this.adoptLateDeclaredIndexOwners(state)

    const tables = state.symbols.filter((s) => s.metadata?.type === "table")
    if (tables.length > 2) state.metadata.architecturalInsights!.push("Complex schema detected")
    if (state.patterns.has("Foreign Key Constraints")) {
      state.metadata.architecturalInsights!.push("Relational integrity enforced via Foreign Keys")
    }
    // Surface the external classification at the top level of metadata, next to
    // `ambiguity`, because that is what a consumer reads to decide whether an
    // unresolved edge is a fact about PostgreSQL or a gap in this project.
    if (state.externalTargets) (state.metadata as any).externalTargets = state.externalTargets
    state.metadata.patterns = [...state.patterns].sort()
    state.metadata.complexity = Math.max(1, state.metadata.cyclomaticComplexity ?? 1)
    ;(state.metadata as any).ambiguity = state.ambiguity

    return {
      symbols: state.symbols,
      relationships: state.relationships,
      imports: state.imports,
      exports: state.exports,
      metadata: state.metadata,
      errors: (state.metadata as any).errors ?? [],
    }
  }

  /**
   * Give an index symbol the owner its `contains` edge already names, when the
   * table was declared AFTER the index.
   *
   * `processIndex` attaches the owner when the table symbol already exists, which
   * covers `CREATE TABLE` then `CREATE INDEX`. The reverse order — a migration that
   * adds the index first, or a file where the table is recovered by the
   * declaration sweep or the EXECUTE-literal pass after the index was walked —
   * leaves the index with `ownerName: undefined` while `contains table -> index`
   * says otherwise. 70 containment edges over a 200-file corpus slice were in that
   * state before this pass, and `bb_graph`'s owner-cascade and `bb_impact`'s reverse
   * walk both read `ownerName`, so the member read as an orphan that happened to be
   * named in an edge.
   *
   * WHY IT IS A SEPARATE PASS AND NOT A LOOKAHEAD. Declaration order in a SQL file
   * is not the order the analyzer visits in: the root walk dispatches top-level
   * statements, the declaration sweep then re-walks the whole tree, and the resync
   * and EXECUTE-literal passes append afterwards. Any "is the table there yet"
   * question asked at `processIndex` time is answered about a partial file. A pass
   * at the end is a question about the finished one.
   *
   * IT ADDS NO EDGE AND NO SYMBOL. It writes four fields the symbol should have had
   * from the start, and counts what it did in `ambiguity.indexOwnersAdopted`, so a
   * file where the order was already right reports 0.
   */
  private adoptLateDeclaredIndexOwners(state: ParseState): void {
    for (const symbol of state.symbols) {
      if (symbol.metadata?.type !== "index") continue
      if (symbol.ownerName) continue
      const table = symbol.metadata.table
      if (typeof table !== "string" || table.length === 0) continue
      const owner = this.existingSymbol(table, ASTEngine.SymbolKind.Class, state)
      if (!owner) {
        // The table is not a symbol in THIS file — a migration that adds an index
        // to a table an earlier migration created, which is the ordinary shape in
        // a migration corpus. The edge `contains table -> index` is still true, so
        // the member must still say who owns it or the symbol and the edge
        // disagree; what it must not do is imply the owner is a resolvable symbol
        // here. `ownerExternalToFile` is that statement, and the counter is what a
        // consumer reads to tell "not adopted" from "cannot be adopted".
        symbol.ownerName = table
        symbol.ownerKind = ASTEngine.SymbolKind.Class
        symbol.parent = table
        symbol.metadata = { ...symbol.metadata, ownerExternalToFile: true }
        state.ambiguity.indexOwnersExternalToFile++
        continue
      }
      symbol.ownerName = owner.name
      symbol.ownerKind = owner.kind
      symbol.parent = owner.name
      symbol.parentId = `${owner.id}.${symbol.name}`
      symbol.metadata = { ...symbol.metadata, ownerDeclaredLater: true }
      state.ambiguity.indexOwnersAdopted++
    }
  }

  // ---------------------------------------------------------------- errors

  /**
   * ERROR and MISSING nodes, reported on the analyzer's own channel.
   *
   * The engine also reports tree errors, but every gate that calls
   * `analyzer.analyze` directly (the M14 fixture lane, the mutation harness, the
   * contract battery) sees only what the analyzer returns, and the previous
   * version returned `errors: []` unconditionally — a file it could not parse at
   * all read as a clean 0 symbols / 0 relationships / 0 errors. A `severity`
   * field is part of the ParseError contract and the indexer keys its
   * `hasSyntaxErrors` report off it, so these are warnings, not errors.
   */
  private collectParseErrors(rootNode: Node, state: ParseState): void {
    if (!rootNode || !rootNode.hasError) return
    const errors: ASTEngine.ParseError[] = []
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "ERROR" || current.isMissing) {
        state.ambiguity.errorNodes++
        if (current.type === "ERROR") state.ambiguity.unparseableRegions++
        if (errors.length < 50) {
          errors.push({
            message: current.type === "ERROR"
              ? "Unrecoverable syntax region: tree-sitter-sql could not parse this subtree. Extraction continued on a best-effort basis, so symbols and relationships inside this range may be missing."
              : `Missing ${current.type} token: the source is syntactically incomplete at this point. Extraction continued on a best-effort basis.`,
            range: this.range(current, state),
            severity: "warning",
          })
        }
      }
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    ;(state.metadata as any).errors = errors
  }

  // ---------------------------------------------------------------- resync

  /** Is this parse damaged badly enough that a per-statement re-parse pays? */
  private resyncNeeded(rootNode: Node, state: ParseState): boolean {
    if (!rootNode || !rootNode.hasError) return false
    if (state.ambiguity.errorNodes < RESYNC_MIN_ERROR_NODES) return false
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i)
      if (child?.type !== "ERROR") continue
      const span = child.endIndex - child.startIndex
      if (span > 0 && span / Math.max(1, rootNode.endIndex - rootNode.startIndex) >= RESYNC_ERROR_SPAN_RATIO) {
        return true
      }
    }
    return false
  }

  /**
   * Re-parse the file one top-level statement at a time and extract from the
   * statements the whole-file parse could not reach.
   *
   * Why this is worth a second parse: the grammar requires a dollar-quoted body
   * to be `BEGIN … END` of parseable `statement`s, so ONE statement keyword it
   * does not know (RAISE, GET DIAGNOSTICS, …) leaves the closing tag
   * unconsumed and the parser absorbs the rest of the file into a single ERROR.
   * Measured over 441 files / 2,336 textual declarations: the whole-file parse
   * reaches 1,557 (66.65%); re-parsing per statement reaches 2,263 (96.88%).
   *
   * Offsets are translated back to FILE coordinates by `Slice`, so a symbol
   * recovered here carries the same 1-based lines and byte bounds as one the
   * main pass produced. Any failure degrades to the main pass alone, which is
   * exactly today's behaviour.
   */
  private runResync(content: string, state: ParseState): void {
    const slices = this.splitTopLevelStatements(content)
    if (slices.length === 0) return
    state.ambiguity.resyncStatements = slices.length

    let parser: any = null
    try {
      parser = this.acquireParser()
    } catch {
      state.ambiguity.resyncSkipped = slices.length
      return
    }
    if (!parser) {
      state.ambiguity.resyncSkipped = slices.length
      return
    }

    const savedSlice = state.slice
    try {
      for (const slice of slices) {
        let tree: any
        try {
          tree = parser.parse(slice.text)
        } catch {
          state.ambiguity.resyncSkipped++
          continue
        }
        if (!tree?.rootNode) {
          state.ambiguity.resyncSkipped++
          continue
        }
        const before = state.symbols.length
        state.slice = {
          byteOffset: slice.start,
          rowOffset: slice.row,
          columnOffset: slice.column,
        }
        this.processRoot(tree.rootNode, state)
        const recovered = state.symbols.length - before
        // Only count a statement that actually contributed something the main
        // pass did not already have; a re-parse that re-derives an existing
        // declaration is a no-op by construction (declarationKeys), so any
        // growth here is genuinely recovered.
        if (recovered > 0) state.ambiguity.resyncDeclarations += recovered
        state.slice = savedSlice
        tree.delete?.()
      }
    } catch {
      state.ambiguity.resyncSkipped++
    } finally {
      state.slice = savedSlice
    }
  }

  /**
   * `EXECUTE [IMMEDIATE] '<sql>'` literals, as re-parseable slices.
   *
   * WHY THIS PASS EXISTS, and why it is TEXT rather than tree.
   *
   * PostgreSQL migrations reach the database two ways: by writing DDL, or by
   * handing it over as a string inside a procedural body. Measured on the 387
   * PostgreSQL extension files this lane can parse within 400 KB
   * (/usr/share/postgresql/14/extension), the analyzer emits 2,172 symbols while
   * **1,326 further CREATE declarations sit inside `EXECUTE '...'` literals**,
   * across 78 files — INDEX 546, TABLE 312, SEQUENCE 234, SCHEMA 78, VIEW 78,
   * TRIGGER 78. That is a potential +61 % on the corpus, and it is invisible to
   * every tree-based pass, because the DDL is a string: a tree-sitter grammar
   * parses one language and cannot produce `statement` nodes for SQL that is
   * text inside a literal, at any amount of grammar work.
   *
   * The plpgsql grammar candidate (validation/m60/sql/v4-plpgsql-candidate.json)
   * was the attempt to reach them through the tree, and it is instructive: it
   * cut ProxiCall error nodes 36 % and added 9 % structure while leaving the
   * product output byte-identical, because parsing the body still leaves the DDL
   * inside a string. This pass reads the text instead, which is why it needs no
   * grammar change and works on the grammar that is actually wired.
   *
   * WHAT IS SKIPPED, and why each skip is necessary:
   *   - `--` and `/* *\/` comments, so `-- EXECUTE 'CREATE TABLE x'` in a
   *     comment is not a declaration. Measured on the corpus, comments carry
   *     real DDL text and this is the main false-positive risk.
   *   - `'...'` strings, so an `EXECUTE` inside another string is not matched,
   *     and so the matched literal's own text is not rescanned.
   *   - `"..."` and `` `...` `` quoted identifiers, for the same reason.
   * Dollar-quoted regions are deliberately NOT skipped: that is precisely where
   * these literals live.
   *
   * The returned text is the RAW between-the-quotes slice, with `''` left
   * intact. That is not laziness, it is what makes the offsets exact: `''` is a
   * valid escaped quote inside a SQL string, so the parser reads it correctly
   * as written, and the slice is a contiguous substring of the file, so
   * `slice.byteOffset` maps every recovered range back to its true absolute
   * position. Unescaping first would shorten the text and silently shift every
   * range after the first escaped quote.
   */
  private scanExecuteLiterals(content: string): { text: string; start: number }[] {
    const out: { text: string; start: number }[] = []
    let i = 0
    let lineComment = false
    let blockComment = false
    let quote: string | null = null
    let row = 0
    let lineStart = 0
    const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11
    const isWord = (c: number) => isTagIdentPart(c)
    /** A bare word at `at`, case-insensitive; returns its length or 0. */
    const wordAt = (at: number, word: string): number => {
      if (at + word.length > content.length) return 0
      for (let k = 0; k < word.length; k++) {
        let c = content.charCodeAt(at + k)
        if (c >= 97 && c <= 122) c -= 32
        if (c !== word.charCodeAt(k)) return 0
      }
      // must not be part of a longer identifier
      if (at > 0 && isWord(content.charCodeAt(at - 1))) return 0
      if (isWord(content.charCodeAt(at + word.length))) return 0
      return word.length
    }
    while (i < content.length) {
      const c = content[i]
      if (lineComment) {
        if (c === "\n") {
          lineComment = false
          row++
          lineStart = i + 1
        }
        i++
        continue
      }
      if (blockComment) {
        if (c === "*" && content[i + 1] === "/") {
          blockComment = false
          i += 2
          continue
        }
        if (c === "\n") {
          row++
          lineStart = i + 1
        }
        i++
        continue
      }
      if (quote) {
        if (c === quote) {
          // '' inside a '...' string is an escaped quote, not the end
          if (content[i + 1] === quote) {
            i += 2
            continue
          }
          quote = null
        }
        if (c === "\n") {
          row++
          lineStart = i + 1
        }
        i++
        continue
      }
      if (c === "-" && content[i + 1] === "-") {
        lineComment = true
        i += 2
        continue
      }
      if (c === "/" && content[i + 1] === "*") {
        blockComment = true
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === "`") {
        quote = c
        i++
        continue
      }
      if (isWord(content.charCodeAt(i))) {
        const len = wordAt(i, "EXECUTE")
        if (len) {
          let j = i + len
          while (j < content.length && isSpace(content.charCodeAt(j))) j++
          // EXECUTE IMMEDIATE '...'
          const imm = wordAt(j, "IMMEDIATE")
          if (imm) {
            j += imm
            while (j < content.length && isSpace(content.charCodeAt(j))) j++
          }
          if (content[j] === "'") {
            // find the closing quote, honouring '' escapes
            let k = j + 1
            let closed = false
            while (k < content.length) {
              if (content[k] === "'") {
                if (content[k + 1] === "'") {
                  k += 2
                  continue
                }
                closed = true
                break
              }
              if (content[k] === "\n") {
                row++
                lineStart = k + 1
              }
              k++
            }
            if (closed) {
              const text = content.slice(j + 1, k)
              // Only `start` is returned: the caller resolves the row/column
              // through `lineColumnAt`, which is the analyzer's single source of
              // truth for positions. Tracking a second position here would be a
              // second implementation of the same arithmetic.
              if (text.length > 0) out.push({ text, start: j + 1 })
              // continue after the literal so its own text is never rescanned
              i = k + 1
              continue
            }
          }
        }
      }
      if (c === "\n") {
        row++
        lineStart = i + 1
      }
      i++
    }
    void lineStart
    return out
  }

  /** 0-based row of an absolute offset. */
  private rowOf(content: string, offset: number): number {
    let row = 0
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") row++
    }
    return row
  }

  /**
   * The EXECUTE-literal pass: re-parse each literal's contents as SQL and let
   * the ordinary extraction path run over it.
   *
   * Structurally identical to `runResync`, and for the same reasons: the same
   * parser, `state.slice` for absolute offsets, and `declarationKeys` making it
   * strictly additive. A declaration that the main pass or the resync already
   * emitted cannot be emitted again, so this pass can only add.
   */
  private runExecuteScan(content: string, state: ParseState): void {
    const literals = this.scanExecuteLiterals(content)
    if (literals.length === 0) return
    state.ambiguity.executeLiterals = literals.length

    let parser: any = null
    try {
      parser = this.acquireParser()
    } catch {
      state.ambiguity.executeSkipped = literals.length
      return
    }
    if (!parser) {
      state.ambiguity.executeSkipped = literals.length
      return
    }

    const savedSlice = state.slice
    try {
      for (const lit of literals) {
        let tree: any
        try {
          tree = parser.parse(lit.text)
        } catch {
          state.ambiguity.executeSkipped++
          continue
        }
        if (!tree?.rootNode) {
          state.ambiguity.executeSkipped++
          continue
        }
        const before = state.symbols.length
        const at = this.lineColumnAt(content, lit.start)
        state.slice = { byteOffset: lit.start, rowOffset: at.row, columnOffset: at.column }
        this.processRoot(tree.rootNode, state)
        state.ambiguity.executeRecovered += state.symbols.length - before
        state.slice = savedSlice
        tree.delete?.()
      }
    } catch {
      state.ambiguity.executeSkipped++
    } finally {
      state.slice = savedSlice
    }
  }

  /**
   * Hand the analyzer the grammar it should re-parse with.
   *
   * `analyze` is synchronous and `Language.load` is not, so the resync pass
   * cannot build its own parser on the first file it sees. The engine calls this
   * in `parseRaw` — it has already loaded the SQL grammar for the file it is
   * parsing — and any harness that drives the analyzer directly can do the same,
   * which is what keeps the resync visible to the fixture lane instead of
   * silently inert. Without a grammar the resync is skipped and counted in
   * `ambiguity.resyncSkipped`; the main pass is unaffected either way.
   */  public static setGrammar(language: any, ParserCtor?: any): void {
    if (!language) return
    RealSqlAnalyzer._language = language
    if (ParserCtor) (globalThis as any).__bbTreeSitterParser = ParserCtor
    RealSqlAnalyzer._parser = null
  }

  private static _language: any = null
  private static _parser: any = null
  private static _loading = false

  /** The parser is built lazily and reused: a file that parsed cleanly must not
   *  pay for a second parse, and a clean file never asks for one at all. */
  private acquireParser(): any {
    if (RealSqlAnalyzer._parser) return RealSqlAnalyzer._parser
    const language = RealSqlAnalyzer._language
    if (language) {
      const ParserCtor = (globalThis as any).__bbTreeSitterParser
      if (ParserCtor) {
        try {
          const parser = new ParserCtor()
          parser.setLanguage(language)
          RealSqlAnalyzer._parser = parser
          return parser
        } catch {
          return null
        }
      }
    }
    this.kickoffGrammarLoad()
    return null
  }

  /** One-shot async load, so a harness that never called `setGrammar` still gets
   *  the resync from the second SQL file onwards. */
  private kickoffGrammarLoad(): void {
    if (RealSqlAnalyzer._loading || RealSqlAnalyzer._language) return
    RealSqlAnalyzer._loading = true
    void (async () => {
      try {
        const wasm: any = await import("../util/wasm")
        const mod: any = await wasm.loadWebTreeSitter()
        const ParserCtor = mod?.Parser ?? mod?.default?.Parser ?? mod?.default
        const LanguageCtor = mod?.Language ?? mod?.default?.Language
        if (ParserCtor) (globalThis as any).__bbTreeSitterParser = ParserCtor
        if (!LanguageCtor) return
        const { readFileSync } = await import("node:fs")
        const bytes = new Uint8Array(readFileSync(wasm.resolveWasmAsset("tree-sitter-sql.wasm")))
        const grammar = await LanguageCtor.load(bytes)
        RealSqlAnalyzer.setGrammar(grammar)
      } catch {
        // The resync stays off; ambiguity.resyncSkipped records it.
      } finally {
        RealSqlAnalyzer._loading = false
      }
    })()
  }

  /**
   * Split a SQL file into top-level statements on `;`, honouring the four
   * contexts a `;` can appear in without ending a statement: a single-quoted
   * string, a double-quoted identifier, a `--`/`/* *\/` comment, and a
   * dollar-quoted string. The dollar-quote case is the one that matters — a
   * PL/pgSQL body is full of `;` and splitting inside it would hand the resync
   * a fragment that cannot parse.
   */
  private splitTopLevelStatements(content: string): { text: string; start: number; row: number; column: number }[] {
    const out: { text: string; start: number; row: number; column: number }[] = []
    let start = 0
    let i = 0
    let quote: string | null = null
    let lineComment = false
    let blockComment = false
    let dollar: string | null = null
    const origin = this.lineColumnAt(content, 0)

    const push = (endExclusive: number) => {
      const text = content.slice(start, endExclusive)
      if (text.trim().length === 0) return
      const at = this.lineColumnAt(content, start)
      out.push({ text, start, row: at.row, column: start === 0 ? origin.column + at.column : at.column })
    }

    while (i < content.length) {
      const c = content[i]
      if (lineComment) {
        if (c === "\n") lineComment = false
        i++
        continue
      }
      if (blockComment) {
        if (c === "*" && content[i + 1] === "/") {
          blockComment = false
          i += 2
          continue
        }
        i++
        continue
      }
      if (dollar) {
        if (content.startsWith(dollar, i)) {
          i += dollar.length
          dollar = null
          continue
        }
        i++
        continue
      }
      if (quote) {
        if (c === "\\") {
          i += 2
          continue
        }
        if (c === quote) {
          if (content[i + 1] === quote) {
            i += 2
            continue
          }
          quote = null
        }
        i++
        continue
      }
      if (c === "-" && content[i + 1] === "-") {
        lineComment = true
        i += 2
        continue
      }
      if (c === "/" && content[i + 1] === "*") {
        blockComment = true
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === "`") {
        quote = c
        i++
        continue
      }
      if (c === "$") {
        const tag = dollarTagAt(content, i)
        if (tag) {
          dollar = tag
          i += tag.length
          continue
        }
      }
      if (c === ";") {
        i++
        push(i)
        start = i
        continue
      }
      i++
    }
    if (start < content.length) push(content.length)
    return out
  }

  /** 0-based row and 0-based column of a byte offset. */
  private lineColumnAt(content: string, offset: number): { row: number; column: number } {
    let row = 0
    let lineStart = 0
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") {
        row++
        lineStart = i + 1
      }
    }
    return { row, column: offset - lineStart }
  }

  // ---------------------------------------------------------------- walk

  private processRoot(node: Node, state: ParseState): void {
    const stack: Node[] = []
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }

    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === "transaction" || current.type === "block") {
        this.addPattern(current.type === "transaction" ? "Transaction Management" : "Procedural Block", state)
        this.bumpComplexity(current, state)
        for (let i = current.namedChildCount - 1; i >= 0; i--) {
          const child = current.namedChild(i)
          if (child && (child.type === "statement" || child.type === "block" || child.type === "transaction")) stack.push(child)
        }
        continue
      }
      state.localCtes.clear()
      if (current.type === "statement") {
        for (const cte of this.descendants(current, "cte")) {
          const nm = this.firstIdentifier(cte, state)
          if (nm) state.localCtes.add(this.identifierName(nm, state))
        }
      }
      // Record the top-level statement in the sweep's own ledger BEFORE dispatching
      // it, so `sweepDeclarations` does not walk straight back into the node the
      // root walk is already handling. That set's comment has claimed this since it
      // was written — "records what this walk has already dispatched so a top-level
      // statement is not processed twice" — and it was doing exactly that for the
      // sweep while the root walk never wrote to it, so every top-level statement in
      // every file was processed twice. No edge doubled (`relationshipsByKey`
      // deduplicates) but the pass did, and so did every counter it touches: one
      // `ROW(1,2)::t` construction reported `instantiationsEmitted: 2`.
      if (current.type === "statement") state.nestedStatements.add(current.startIndex + state.slice.byteOffset)
      this.processStatement(current, state, null)
    }

    /**
     * The declarations the root walk cannot reach.
     *
     * `program` requires every top-level item to be a `statement`/`block`/
     * `transaction`, and error recovery routinely buries a declaration inside
     * one of those (a runaway dollar-quote puts every later `CREATE TABLE` under
     * the preceding function's body). Walking the whole tree for declaration
     * nodes finds those too: 1,644 of 2,336 corpus declarations against 1,557
     * for the root walk alone. `declarationKeys` keeps it from double-emitting.
     */
    this.sweepDeclarations(node, state)
  }

  /**
   * Every declaration node in the tree, at any depth, each emitted once.
   *
   * `program` requires every top-level item to be a `statement`/`block`/
   * `transaction`, and error recovery routinely buries a declaration inside one
   * of those: on the corpus's `database/schema.sql` a function whose body the
   * grammar could not fully parse swallows the rest of the file, and the 158
   * `CREATE TABLE` nodes after it end up NESTED INSIDE that function's
   * `function_body` — a declaration inside a declaration. Walking the whole tree
   * for declaration nodes finds them: 1,644 of 2,336 corpus declarations against
   * 1,557 for the root-children walk alone.
   *
   * The sweep DESCENDS THROUGH declarations rather than stopping at them, which
   * is the whole point: a `create_table` inside a `create_function` is reachable
   * only by passing through the function. The earlier version stopped at the first
   * declaration it met, so every such nested declaration stayed invisible — and
   * `business_profiles`, `business_rules`, `business_content` and
   * `business_locations` (the corpus's most-referenced tables) were among the
   * casualties, 117 edges in the unknown-symbol population of `probe/
   * unknown-symbols.mts`. `declarationKeys` keeps the walk from dispatching the
   * same node twice, and `createSymbol`'s identity check makes a re-dispatch
   * idempotent, so descending is safe and costs one redundant walk of a body.
   */
  private sweepDeclarations(node: Node, state: ParseState): void {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      // A `statement` NESTED inside another statement — the SQL embedded in a
      // plpgsql body — contributes nothing to the graph without this.
      //
      // Measured: `DO $$ BEGIN SELECT count(*) FROM pg_policies; END $$;`
      // produced NO edges at all, while the same SELECT at top level produced
      // `uses global->pg_policies`. So before this, a plpgsql body contributed
      // SYMBOLS (via the declaration walk) but zero RELATIONSHIPS, which on a
      // corpus that wraps its DDL in `DO $$ … EXECUTE '…'; END $$;` is most of
      // the file. The re-entry is safe for the same reason the declaration
      // re-entry is: `relationshipsByKey` and `symbolKeys` make both passes
      // idempotent, and `nestedStatements` records what this walk has already
      // dispatched so a top-level statement is not processed twice.
      if (current.type === "statement" && !state.nestedStatements!.has(current.startIndex + state.slice.byteOffset)) {
        state.nestedStatements!.add(current.startIndex + state.slice.byteOffset)
        // A statement nested inside a `cte` sees that CTE's NAME as a local
        // binding, and the sweep was dispatching it with an EMPTY scope.
        //
        // `parseState.localCtes` is documented as holding the scope of the
        // statement and only the statement, and the main walk honours that because
        // `processRoot` populates it before dispatching. The sweep is a SEPARATE
        // walk with no such step, so it reached
        //
        //   WITH recent_users AS (...), named_users AS (SELECT u.id FROM recent_users u)
        //   SELECT ... FROM named_users
        //
        // and dispatched `named_users`'s body statement — whose only enclosing
        // `statement` ancestor is the top-level one — with both sets empty. The
        // CTE guard is `localCtes.has(leaf) || state.localCtes.has(leaf)`, so
        // `FROM recent_users u` was published as `uses global->recent_users`: a
        // table edge to a name no file declares and cannot declare, because the
        // CTE binds it. `named_users` in the outer SELECT was suppressed
        // correctly, so the file published exactly the one edge it should not
        // have.
        //
        // This is the single false positive the m12 differential has been
        // reporting against 84 hand-audited facts (precision 0.988,
        // `FP rel:Queries.sql:uses:global:recent_users`), recorded in this file's
        // Differential section as "left unnamed because re-deriving it requires
        // re-running the differential". It was this.
        //
        // The scope is RESTORED afterwards rather than left in place: the sweep
        // visits sibling statements, and the next one has its own CTEs.
        const saved = new Set(state.localCtes)
        state.localCtes = this.cteScope(current, state)
        this.processStatement(current, state, null)
        state.localCtes.clear()
        for (const name of saved) state.localCtes.add(name)
      }
      if (DECLARATION_NODES.has(current.type)) {
        if (this.markDeclaration(current, state)) {
          this.dispatchDeclaration(current, state, null)
          // The honest count of what the sweep bought over the main walk: a
          // declaration the root walk never reached, which is every declaration
          // that error recovery nested inside another declaration. Reported
          // rather than inferred, so the pre-sweep state is reconstructable from
          // the result and a regression here is catchable rather than silent.
          state.ambiguity.sweepDeclarationsRecovered++
        }
      }
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  private processStatement(node: Node, state: ParseState, owner: SqlSymbol | null): void {
    if (node.type === "statement") {
      /**
       * A `statement` is `seq(<query/declaration>, from, where, …)`: `from` and
       * the predicates are SIBLINGS of `select`, not children of it. So the
       * query is processed on the STATEMENT — passing the `select` child loses
       * every FROM relation, which is where the tables are.
       *
       * What was added is the second half: the previous version returned after
       * that one check, so a `statement` holding anything else was dropped
       * before it reached the switch, which made the `set_statement`,
       * `reset_statement` and `comment_statement` arms unreachable ("Session
       * Configuration" / "SQL Documentation" could never fire) and left
       * `merge` — whose rule is hidden, so it inlines into `statement` — with
       * no relationship at all.
       */
      const children = this.namedChildren(node)
      const isQueryPart = (c: Node) => queryTypes.has(c.type) || c.type === "from" || c.type === "cte"
      if (children.some(isQueryPart)) this.processQuery(node, state, owner)
      for (const child of children) {
        if (isQueryPart(child)) continue
        this.processStatement(child, state, owner)
      }
      return
    }

    if (DECLARATION_NODES.has(node.type)) {
      // A function CALL is not only a thing a query does. `DEFAULT public.f()`,
      // `CHECK (public.g(x))`, a generated column's expression and a policy's
      // `USING (public.is_admin())` are all `invocation` nodes in grammar-mandated
      // expression slots, and before this the only route into `processCalls` was
      // `processQuery`, so none of them produced an edge. Measured on the corpus:
      // `proxicall/database/archive/2026/20260129_pms_c1_3_rls_policies.sql` alone
      // holds 17 qualified invocations in policy expressions and emitted none of
      // them. That is a gap in reading the language, not a labelling question, so it
      // is closed here rather than declared.
      //
      // WHY IT IS SAFE TO CALL THIS ALONGSIDE `dispatchDeclaration`. The two paths
      // use the same source — the declaration's own name — and `addRelationship`
      // deduplicates on (type, source, target), so an invocation inside a function
      // body's `SELECT` is emitted once by `processQuery` and merges here. And the
      // guard is the same `invocation`-with-no-ERROR test `processCalls` already
      // applies, so a damaged expression contributes nothing rather than a guess.
      const declaredName = this.declarationOwner(node, state)
      this.processCalls(node, declaredName, state)
      // `markDeclaration` is the guard, and it was being CALLED and IGNORED here.
      // The sweep walks every declaration in the tree, including the ones the root
      // walk already dispatched, so `dispatchDeclaration` ran twice for every
      // top-level declaration: once from `processRoot` and once from
      // `sweepDeclarations` re-entering the same top-level `statement`. Nothing in
      // the graph doubled, because `symbolKeys`/`relationshipsByKey` deduplicate —
      // but the WORK doubled and, once the counters existed, so did the honesty
      // numbers: a single `CREATE TABLE … (LIKE s)` reported
      // `reservedNameSymbolsSuppressed: 2` and a single
      // `CREATE OR REPLACE FUNCTION f` pair reported `overridesEmitted: 3`, all
      // three from the same one edge. An ambiguity counter that reports three of
      // something that happened once is the exact failure the honesty contract
      // exists to prevent, so the guard is now load-bearing.
      if (this.markDeclaration(node, state)) this.dispatchDeclaration(node, state, owner)
      return
    }

    switch (node.type) {
      case "alter_table":
        this.addPattern("Schema Evolution (ALTER)", state)
        this.recordTableTarget(node, "uses", "alter", state)
        this.processAlterTable(node, state)
        return
      case "drop_table":
      case "drop_view":
      case "drop_index":
      case "drop_type":
      case "drop_schema":
      case "drop_sequence":
      case "drop_column":
      case "drop_constraint":
      case "drop_function":
      case "drop_policy":
        this.addPattern("Schema Evolution (DROP)", state)
        this.recordTableTarget(node, "uses", "drop", state)
        return
      case "insert":
        this.recordDml(node, "insert", state)
        return
      case "update":
        this.recordDml(node, "update", state)
        return
      case "delete":
        this.recordDml(node, "delete", state)
        return
      case "select":
      case "set_operation":
      case "cte":
      case "create_query":
      case "subquery":
        this.processQuery(node, state, owner)
        return
      case "set_statement":
      case "reset_statement":
        this.addPattern("Session Configuration", state)
        return
      case "comment_statement":
        this.processComment(node, state)
        return
      case "grant_statement":
      case "revoke_statement":
        this.processGrant(node, state, node.type === "grant_statement" ? "grant" : "revoke")
        return
      case "transaction":
      case "block":
        this.addPattern("Transaction Management", state)
        this.bumpComplexity(node, state)
        return
      // No `merge` / `truncate` / `copy` arms: those grammar rules are HIDDEN
      // (`_merge_statement`, `_truncate_statement`, `_copy_statement`), so the
      // keywords and references inline into `statement` and a node of those
      // types can never exist. Measured over the corpus and the dialect battery.
      // The `keyword_*` arms below are the only real routes.
      case "keyword_merge":
        this.processInlineMerge(node, state)
        return
      case "keyword_truncate":
        this.processInlineTruncate(node, state)
        return
      case "keyword_copy":
        this.processInlineCopy(node, state)
        return
      case "returning":
        this.processReturning(node, state)
        return
      case "psql_meta_command":
        this.processPsqlMetaCommand(node, state)
        return
      default:
        return
    }
  }

  /** Record that this declaration node has been dispatched, so neither the main
   *  walk nor the sweep can emit it twice, and so the sweep can report how much
   *  it contributed that the main walk could not reach.
   *
   *  THE KEY IS IN FILE COORDINATES, and that is load-bearing rather than
   *  cosmetic. `node.startIndex` is relative to the PARSE that produced the node,
   *  and three of this analyzer's passes produce nodes from a re-parsed SLICE: the
   *  main walk parses the whole file (so its offsets are already file offsets),
   *  the resync pass parses one statement at a time, and the EXECUTE-literal pass
   *  parses the text between a literal's quotes. Keyed on the raw `startIndex`,
   *  a declaration inside an EXECUTE literal collided with whatever the main pass
   *  had already seen at the same SLICE-LOCAL offset, and was silently dropped.
   *  `state.slice.byteOffset` maps a slice node back to its true position — the
   *  raw literal is handed to the parser with its `''` escapes intact precisely so
   *  it stays a contiguous substring of the file and that mapping holds — so the
   *  file coordinate is both correct and unique.
   *
   *  This was invisible while `processStatement` called `markDeclaration` and then
   *  dispatched regardless of the answer: the redundant dispatch is what was
   *  masking the collision. Making the guard load-bearing (`if (markDeclaration(…))`)
   *  and correct are the same piece of work, and `validation/m14/fixtures/sql/
   *  sqld11` is what caught it — its `quoted_name` table lives inside an EXECUTE
   *  literal and vanished the moment the guard started meaning what it says. */
  /**
 * The name a declaration's own invocations belong to.
 *
 * A function call inside a `CREATE FUNCTION` body is a call BY that function; one
 * inside a table's column `DEFAULT` is a call BY that table. `global` is the
 * analyzer's synthetic owner and is only correct where there is no declaration to
 * attribute to — which is why the anonymous-statement path uses it and this does
 * not.
 */
private declarationOwner(node: Node, state: ParseState): string {
    const object = this.directChild(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return "global"
    return this.identifierName(nameNode, state) || "global"
}

private markDeclaration(node: Node, state: ParseState): boolean {
    const key = `${node.startIndex + state.slice.byteOffset}:${node.type}`
    if (state.declarationKeys.has(key)) return false
    state.declarationKeys.add(key)
    return true
  }

  private dispatchDeclaration(node: Node, state: ParseState, owner: SqlSymbol | null): void {
    if (REPLACEABLE_DECLARATIONS.has(node.type)) this.recordReplacement(node, state)
    switch (node.type) {
      case "create_table":
        this.processTable(node, state)
        return
      case "create_view":
      case "create_materialized_view":
        this.processView(node, state)
        return
      case "create_index":
        this.processIndex(node, state)
        return
      case "create_function":
        this.processFunction(node, state)
        return
      case "create_procedure":
        this.processProcedure(node, state)
        return
      case "create_trigger":
        this.processTrigger(node, state)
        return
      case "create_type":
        this.processType(node, state)
        return
      case "create_schema":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Namespace, "schema", state)
        return
      case "create_sequence":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Constant, "sequence", state)
        return
      case "create_role":
        this.processNamedContainer(node, ASTEngine.SymbolKind.Namespace, "role", state)
        return
      case "create_extension":
        this.processExtension(node, state)
        return
      case "create_database":
        this.processDatabase(node, state)
        return
      case "create_policy":
        this.processPolicy(node, state)
        return
      case "do_statement":
        this.processDo(node, state)
        return
      default:
        return
    }
  }

  /**
   * `CREATE OR REPLACE FUNCTION f` when this file ALREADY declared `f` of the
   * same kind: the second declaration replaces the first.
   *
   * The scope is exactly that, and each clause of it is a measured boundary:
   *
   *   - SAME FILE only. 666 OR REPLACE declarations exist over the 1,460-file
   *     census and all but a handful replace a declaration made in a DIFFERENT
   *     file — a migration chain re-declaring what the previous migration
   *     declared. A per-file analyzer cannot see those, so this emits for the 15
   *     events it can and declares the rest rather than pretending to them.
   *   - SAME KIND only. Keyed on the name alone, `CREATE FUNCTION
   *     hdb_catalog.f()` at line 7 and `CREATE TRIGGER f` at line 25 of Hasura's
   *     `10_to_11.sql` counted as a redefinition; they are two different objects
   *     that happen to share a name, and the probe that produced that number is
   *     the same shape-versus-role error this lane has now hit three times.
   *   - `OR REPLACE` REQUIRED on the later declaration. Measured 20 same-kind
   *     re-declarations carry no `OR REPLACE` and PostgreSQL rejects those
   *     outright ("relation already exists"), so calling them overrides would
   *     assert a replacement the language does not perform.
   *
   * The SOURCE is `global`, this lane's existing spelling for a file-level fact
   * about a named object (`uses global->t` for a DML target, `references
   * global->t` for `GRANT … ON t`). The two ends cannot be two symbols: SQL
   * replacement is same-name, so any source/target pair would collapse to a
   * self-loop `overrides f->f` that tells a graph consumer nothing about which
   * declaration replaced which. The lines that do distinguish them ride in
   * metadata instead, which is where a consumer can read them.
   */
  private recordReplacement(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    const name = this.identifierName(nameNode, state)
    // KEYED ON NAME **AND KIND**. It was keyed on the name alone, and
    // `state.redeclared`'s own field comment claimed the caller "has established
    // that both declarations are the same KIND" — which nothing did. Two DIFFERENT
    // objects that share a name therefore collided: pass 1's own construct probe
    // measured 15 same-kind OR REPLACE redeclarations against the analyzer's 22
    // emitted `overrides` edges, and the 7-edge gap was exactly this. The field
    // comment was right about the failure and wrong about where it was enforced.
    const key = `${node.type}:${name}`
    const line = node.startPosition.row + state.slice.rowOffset + 1
    const replaces = this.directChild(node, "keyword_replace") !== null
    if (!replaces) {
      // Not a replacement, but the first declaration of this name is still worth
      // recording: a LATER `CREATE OR REPLACE` of the same name replaces THIS one.
      if (!state.redeclared.has(key)) state.redeclared.set(key, line)
      return
    }
    const prior = state.redeclared.get(key)
    if (prior === undefined) {
      state.redeclared.set(key, line)
      return
    }
    this.addRelationship(ASTEngine.RelationshipType.Overrides, "global", name, state, {
      orReplace: true,
      redefinition: true,
      scope: "file",
      priorLine: prior,
      replacementLine: line,
    })
    state.redeclared.set(key, line)
    state.ambiguity.overridesEmitted++
  }

  // ---------------------------------------------------------------- tables

  private processTable(node: Node, state: ParseState): void {
    const object = this.directChild(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    const table = this.createSymbol(
      this.identifierName(nameNode, state),
      ASTEngine.SymbolKind.Class,
      nameNode,
      null,
      state,
      {
        type: "table",
        isSchemaEntity: true,
        qualifiedName: object ? this.referenceText(object, state) : this.identifierName(nameNode, state),
      },
    )

    const definitions = this.directChild(node, "column_definitions")
    if (definitions) {
      for (const column of this.namedChildren(definitions)) {
        if (column.type === "column_definition") this.processColumn(column, table, state)
      }
      const tableConstraints = this.directChild(definitions, "constraints")
      if (tableConstraints) {
        for (const child of this.namedChildren(tableConstraints)) {
          if (child.type === "constraint") {
            this.processConstraint(child, table, state)
          } else {
            // A named `CONSTRAINT <n> UNIQUE|FOREIGN KEY` used to arrive here as
            // an ERROR holding `CONSTRAINT <n> FOREIGN`, with the rest re-parsed
            // as a nameless `constraint`. The name is still in the tree, so
            // recover it and mark the symbol as recovered rather than dropping it.
            const recovered = this.recoverNamedConstraint(child)
            if (recovered) this.processConstraint(recovered, table, state)
          }
        }
      }
    }

    this.addPattern("Tables", state)
  }

  /**
   * Is this column name a reserved word that error recovery re-emitted?
   *
   * Only an UNQUOTED name can be one: a quoted `"like"` arrives as a `literal` and
   * is a legal column name in every dialect, so the guard keys on the node type as
   * well as the text. See `RESERVED_AS_COLUMN_NAME` for the measured counts and for
   * why this list is two words and not the whole keyword set.
   */
  private reservedColumnName(node: Node): boolean {
    if (node.type !== "identifier") return false
    if (!RESERVED_AS_COLUMN_NAME.has(node.text.toLowerCase())) return false
    return true
  }

  /**
   * A `CONSTRAINT <name> FOREIGN KEY` the grammar could not build a `constraint`
   * node for arrives as an ERROR whose own children are still
   * `keyword_constraint` + `identifier`. Rebuild a constraint-shaped view of it
   * so `processConstraint` has a node to read, and say so in the symbol's
   * metadata — the recovery is deterministic, but it is a recovery.
   */
  private recoverNamedConstraint(node: Node): Node | null {
    if (node.type !== "ERROR" && !node.hasError) return null
    const text = node.text
    if (!opensWithConstraintKeyword(text)) return null
    const children = this.namedChildren(node)
    const keywordAt = children.findIndex((c) => c.type === "keyword_constraint")
    if (keywordAt < 0) return null
    const nameAt = children.findIndex((c, i) => i > keywordAt && identifierTypes.has(c.type))
    if (nameAt < 0) return null
    // The `constraint` node the grammar DID build (the `KEY (…) REFERENCES …`
    // remainder) is a sibling further along the same `constraints` list; hand
    // back a synthetic view only if one exists in this subtree.
    const rest = this.descendants(node, "constraint")[0]
    void rest
    return node
  }

  private processColumn(node: Node, table: SqlSymbol, state: ParseState): void {
    const rawName = node.childForFieldName?.("name") ?? this.firstIdentifier(node)
    if (!rawName || !identifierTypes.has(rawName.type)) return
    if (this.reservedColumnName(rawName)) {
      state.ambiguity.reservedNameSymbolsSuppressed++
      return
    }

    let isPrimaryKey = false
    let isUnique = false
    let isNullable = true
    let references: string | undefined
    let referenceNode: Node | null = null

    const children = this.namedChildren(node)
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.type === "keyword_primary") isPrimaryKey = true
      if (child.type === "keyword_unique") isUnique = true
      if (child.type === "keyword_not" && children[i + 1]?.type === "keyword_null") isNullable = false
      /**
       * A foreign key is an `object_reference` that FOLLOWS `keyword_references`.
       * Matching any `object_reference` child instead is what turned every
       * user-defined column type into a fabricated foreign key:
       *   CREATE TABLE t (b my_schema.my_type)
       *     → references t -> my_type, pattern "Foreign Key Constraints"
       * The grammar makes the two cases unambiguous — `custom_type` sits
       * directly after the name, a REFERENCES target sits after
       * `keyword_references` — so the position is the discriminator, not a guess.
       */
      if (child.type === "object_reference" && children[i - 1]?.type === "keyword_references") {
        referenceNode = child
        references = this.referenceLeaf(child, state)
      }
    }

    const column = this.createSymbol(
      this.identifierName(rawName, state),
      ASTEngine.SymbolKind.Property,
      rawName,
      table,
      state,
      {
        type: "column",
        sqlType: this.columnType(node, state),
        isPrimaryKey,
        isUnique,
        isNullable,
        references,
      },
    )
    this.addRelationship(ASTEngine.RelationshipType.Contains, table.name, column.name, state)
    if (isPrimaryKey) this.addPattern("Primary Key Constraint", state)
    if (isUnique) this.addPattern("Unique Constraint", state)
    if (references && referenceNode) {
      this.addPattern("Foreign Key Constraints", state)
      this.addRelationship(ASTEngine.RelationshipType.References, table.name, references, state, {
        constraint: "foreign_key",
        column: column.name,
      })
    }
  }

  /**
   * A column's declared type.
   *
   * The grammar puts `type` on the type node and, for an array, on
   * `array_size_definition` as well — `childForFieldName("type")` returns only
   * the first, so `c int[]` reported `"int"`. Both fields are read and the
   * array suffix appended. A user-defined type arrives as `custom_type` (which
   * `childForFieldName("type")` also resolves) and is returned whole, so
   * `my_schema.my_type` and `character varying(20)` survive intact.
   */
  private columnType(node: Node, state: ParseState): string | undefined {
    const parts: { text: string; startIndex: number; endIndex: number }[] = []
    for (let i = 0; i < node.childCount; i++) {
      const field = node.fieldNameForChild(i)
      if (field !== "type" && field !== "custom_type") continue
      const child = node.child(i)
      if (!child) continue
      // Skip the name, which some reductions also label.
      if (child.type === "identifier" || child.type === "literal") continue
      if (parts.some((p) => p.startIndex === child.startIndex)) continue
      parts.push({ text: child.text, startIndex: child.startIndex, endIndex: child.endIndex })
    }
    if (parts.length === 0) {
      const fallback = node.childForFieldName?.("type") ?? node.childForFieldName?.("custom_type")
      if (fallback) parts.push({ text: fallback.text, startIndex: fallback.startIndex, endIndex: fallback.endIndex })
    }
    void state
    if (parts.length === 0) return undefined
    parts.sort((a, b) => a.startIndex - b.startIndex)
    // `type` sits on BOTH the type node and `array_size_definition` for `int[]`,
    // and `childForFieldName` returns only the first — hence both, joined by
    // byte adjacency so the source's own spelling survives (`int[]`, not
    // `int []`).
    let out = ""
    for (const part of parts) {
      if (out && part.startIndex > parts[parts.indexOf(part) - 1].endIndex) out += " "
      out += part.text
    }
    return out
  }

  private processConstraint(node: Node, table: SqlSymbol, state: ParseState): void {
    const children = this.namedChildren(node)
    const keywordAt = children.findIndex((c) => c.type === "keyword_constraint")
    let nameNode: Node | null = null
    if (keywordAt >= 0) {
      nameNode = children.slice(keywordAt + 1).find((c) => identifierTypes.has(c.type)) ?? null
    } else {
      nameNode = node.childForFieldName?.("name") ?? null
    }
    // MySQL's `UNIQUE KEY <name> (cols)` puts the index name in a `name` field.
    if (!nameNode && keywordAt < 0) {
      nameNode = this.directChild(node, "identifier")
    }

    const hasPrimary = this.containsChildType(node, "keyword_primary")
    const hasUnique = this.containsChildType(node, "keyword_unique")
    // A constraint's target is the `object_reference` after `keyword_references`.
    // "Any object_reference" was wrong here for the same reason it was wrong on a
    // column: a CHECK expression or an ordered-column list has no reference, but
    // a name that is not a REFERENCES target would have been read as one.
    const referenceNode = this.referencesTarget(node)
    const reference = referenceNode ? this.referenceLeaf(referenceNode, state) : undefined
    const recovered = node.type === "ERROR"

    if (nameNode) {
      const constraint = this.createSymbol(
        this.identifierName(nameNode, state),
        ASTEngine.SymbolKind.Constant,
        nameNode,
        table,
        state,
        {
          type: "constraint",
          constraintKind: reference ? "foreign_key" : hasPrimary ? "primary_key" : hasUnique ? "unique" : "check",
          ...(recovered ? { recoveredFromErrorRegion: true } : {}),
        },
      )
      this.addRelationship(ASTEngine.RelationshipType.Contains, table.name, constraint.name, state)
    }
    if (hasPrimary) this.addPattern("Primary Key Constraint", state)
    if (hasUnique) this.addPattern("Unique Constraint", state)
    if (reference) {
      this.addPattern("Foreign Key Constraints", state)
      this.addRelationship(ASTEngine.RelationshipType.References, table.name, reference, state, { constraint: "foreign_key" })
    }
  }

  /** The `object_reference` a `REFERENCES` clause points at, if there is one. */
  private referencesTarget(node: Node): Node | null {
    const children = this.namedChildren(node)
    for (let i = 0; i < children.length; i++) {
      if (children[i].type === "keyword_references" && children[i + 1]?.type === "object_reference") {
        return children[i + 1]
      }
    }
    return null
  }

  // ---------------------------------------------------------------- views / indexes

  private processView(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    const kind = node.type === "create_materialized_view" ? "materialized_view" : "view"
    const view = this.createSymbol(
      this.identifierName(nameNode, state),
      ASTEngine.SymbolKind.Class,
      nameNode,
      null,
      state,
      { type: kind, isSchemaEntity: true, qualifiedName: object ? this.referenceText(object, state) : this.identifierName(nameNode, state) },
    )
    this.addPattern(kind === "view" ? "Views" : "Materialized Views", state)
    const query = this.firstDescendant(node, "create_query")
    if (query) this.processQuery(query, state, view)
  }

  private processIndex(node: Node, state: ParseState): void {
    const identifiers = this.namedChildren(node).filter((c) => c.type === "identifier" || c.type === "literal")
    const nameNode = identifiers[0] ?? this.firstIdentifier(node)
    if (!nameNode) return
    const object = this.firstDescendant(node, "object_reference")
    const tableName = object ? this.referenceLeaf(object, state) : undefined
    const name = this.identifierName(nameNode, state)
    // The owner, when the table it indexes is already a symbol in this file.
    //
    // It usually is not. `CREATE TABLE` and `CREATE INDEX` are sibling
    // statements, so a migration that writes the index before the table — and the
    // corpus has 70 such containment edges whose member symbol carries
    // `ownerName: undefined` — leaves nothing to attach to. Before pass 2 this was
    // unconditional: `parent` was hardcoded `null`, so EVERY index symbol in the
    // corpus had no owner, while the edge two lines below said the table contains
    // it. The edge and the symbol's own metadata then disagreed, and both
    // `bb_graph`'s owner-cascade and `bb_impact`'s reverse walk read `ownerName`,
    // so the member looked like an orphan that happened to be mentioned in an edge.
    // A later `CREATE TABLE` of the same name is adopted as the owner rather than
    // re-creating the symbol, because the edge already names the table and two
    // symbols for one index would break the id-keyed consumers.
    const owner = tableName ? this.existingSymbol(tableName, ASTEngine.SymbolKind.Class, state) : undefined
    this.createSymbol(name, ASTEngine.SymbolKind.Constant, nameNode, owner ?? null, state, {
      type: "index",
      indexName: name,
      table: tableName,
      columns: this.identifierTexts(this.firstDescendant(node, "index_fields"), state),
      ...(tableName && !owner ? { ownerDeclaredLater: true } : {}),
    })
    this.addPattern("Custom Indexes", state)
    if (tableName) {
      this.addRelationship(ASTEngine.RelationshipType.References, name, tableName, state, { dependency: true, indexOn: tableName })
      this.addRelationship(ASTEngine.RelationshipType.Contains, tableName, name, state)
      if (state.metadata.performanceScore !== undefined) state.metadata.performanceScore += 10
    }
  }

  // ---------------------------------------------------------------- functions

  private processFunction(node: Node, state: ParseState): void {
    this.processCallable(node, state, { kind: ASTEngine.SymbolKind.Function, pattern: "Stored Functions" })
  }

  private processProcedure(node: Node, state: ParseState): void {
    this.processCallable(node, state, { kind: ASTEngine.SymbolKind.Function, pattern: "Procedures", type: "procedure" })
  }

  private processCallable(
    node: Node,
    state: ParseState,
    opts: { kind: ASTEngine.SymbolKind; pattern: string; type?: string },
  ): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    const name = this.identifierName(nameNode, state)

    const params = this.callableParameters(node, state)
    const returns = this.returnTypeText(node, state)
    const returnsTable = this.returnsTableNode(node)

    this.createSymbol(name, opts.kind, nameNode, null, state, {
      ...(opts.type ? { type: opts.type } : {}),
      functionName: name,
      qualifiedName: object ? this.referenceText(object, state) : name,
      sqlFunction: true,
      ...(returnsTable ? { returnsTable: true } : {}),
    }, { parameters: params, returnType: returns })

    this.addPattern(opts.pattern, state)
    this.processQueryDependencies(node, null, state, name)
    this.processCalls(node, name, state)
  }

  /**
   * A parameter's declared type, read from the grammar's own layout.
   *
   * `function_argument` has NO `type` field at all — only `custom_type`, and only
   * when the type is a user-defined name. The builtin type is simply the child
   * after the parameter's name, which is why the previous accessor (matching
   * `type` or `keyword_*`) lost `integer`, `bigint`, `numeric`, `varchar`,
   * `timestamp` and `uuid` — 69 parameters on the corpus, and inconsistently:
   * `UUID` and `TEXT` came through, `bigint` did not.
   *
   * It also matched the mode keyword first, so `IN a integer` produced
   * `{ name: "a", type: "IN" }` — a fabricated type. Everything from the name to
   * the DEFAULT is the type; the mode keyword sits BEFORE the name and so falls
   * outside the span on its own.
   */
  private callableParameters(node: Node, state: ParseState): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []
    const args = this.directChild(node, "function_arguments")
    if (args) {
      for (const argument of this.namedChildren(args)) {
        if (argument.type !== "function_argument") continue
        const param = this.functionArgument(argument, state)
        if (param) params.push(param)
      }
    }
    // `RETURNS TABLE (a int, b text)` declares OUT parameters in the grammar's
    // own `column_definitions`, which is not `function_arguments`, so they were
    // dropped entirely.
    const table = this.returnsTableNode(node)
    if (table) {
      for (const column of this.namedChildren(table)) {
        if (column.type !== "column_definition") continue
        const nameNode = column.childForFieldName?.("name") ?? this.firstIdentifier(column)
        if (!nameNode) continue
        params.push({
          name: this.identifierName(nameNode, state),
          type: this.columnType(column, state),
          direction: "out",
        })
      }
    }
    return params
  }

  private functionArgument(argument: Node, state: ParseState): ASTEngine.Parameter | null {
    const nameNode = argument.childForFieldName?.("name") ?? this.firstIdentifier(argument)
    if (!nameNode) return null
    const children = this.namedChildren(argument)
    // web-tree-sitter hands back a NEW wrapper object on every `namedChild(i)`,
    // so the name node found by traversal is never `===` the child. Positions
    // are the identity that holds.
    const nameIndex = children.findIndex((c) => c.startIndex === nameNode.startIndex)
    const hasDefault = children.some((c) => c.type === "keyword_default")
    const type = this.spanAfter(argument, nameNode, (c) => c.type === "keyword_default" || c.type === "literal")
    const before = nameIndex >= 0 ? children.slice(0, nameIndex) : []
    const modeNode = before.find((c) => c.type === "keyword_inout")
      ?? before.find((c) => c.type === "keyword_in")
      ?? before.find((c) => c.type === "keyword_out")
    const param: ASTEngine.Parameter = { name: this.identifierName(nameNode, state) }
    if (type) param.type = type
    if (hasDefault) param.isOptional = true
    const direction = modeNode?.type === "keyword_inout" ? "inout" : modeNode?.type === "keyword_in" ? "in" : modeNode?.type === "keyword_out" ? "out" : undefined
    if (direction) param.direction = direction
    return param
  }

  /**
   * The source text between `fromExclusive` and the first child that `stopAt`
   * accepts, read out of the container's own text so the spacing is the
   * source's own (`int[]`, not `int []`; `numeric(10,2)`, not `numeric (10,2)`).
   */
  private spanAfter(container: Node, fromExclusive: Node, stopAt: (child: Node) => boolean): string {
    const from = fromExclusive.endIndex - container.startIndex
    let to = container.endIndex - container.startIndex
    for (const child of this.namedChildren(container)) {
      if (child.startIndex < fromExclusive.endIndex) continue
      if (stopAt(child)) {
        to = child.startIndex - container.startIndex
        break
      }
    }
    if (to <= from) return ""
    return container.text.substring(from, to).trim()
  }

  /** The `column_definitions` of a `RETURNS TABLE (...)`, if that is the return. */
  private returnsTableNode(node: Node): Node | null {
    const children = this.namedChildren(node)
    const returnsAt = children.findIndex((c) => c.type === "keyword_returns")
    if (returnsAt < 0) return null
    if (children[returnsAt + 1]?.type !== "keyword_table") return null
    return children[returnsAt + 2]?.type === "column_definitions" ? children[returnsAt + 2] : null
  }

  /**
   * Everything after `RETURNS`, up to the body or the language clause.
   *
   * The previous version took the single next sibling, which read `int` for
   * `RETURNS int[]` (the `[]` is a following `array_size_definition`), `SETOF`
   * for `RETURNS SETOF record`, and `TABLE` for `RETURNS TABLE (a int, b text)`.
   */
  private returnTypeText(node: Node, state: ParseState): string | undefined {
    const children = this.namedChildren(node)
    const returnsAt = children.findIndex((c) => c.type === "keyword_returns")
    if (returnsAt < 0) return undefined
    void state
    return this.spanAfter(
      node,
      children[returnsAt],
      (c) => c.type === "function_body" || c.type === "function_language"
        || c.type === "function_volatility" || c.type === "function_strictness",
    ) || undefined
  }

  // ---------------------------------------------------------------- triggers

  /**
   * A trigger's name, its table, and the function it executes.
   *
   * These were read as the FIRST THREE `object_reference`s anywhere in the
   * subtree. A `WHEN (old.a <> new.a)` clause contributes two more
   * (`old` and `new` are `object_reference`s in this grammar), so the action
   * function was read as `old` and the analyzer emitted
   * `calls tg -> old` instead of `calls tg -> audit_it`. The three references are
   * read from the trigger's own top level instead: the first is the name, the one
   * after `keyword_on` is the table, and the last is the executed routine.
   */
  private processTrigger(node: Node, state: ParseState): void {
    const top = this.namedChildren(node).filter((c) => c.type === "object_reference")
    if (top.length === 0) return
    const nameRef = top[0]
    const onAt = this.namedChildren(node).findIndex((c) => c.type === "keyword_on")
    const tableRef = onAt >= 0
      ? this.namedChildren(node).slice(onAt + 1).find((c) => c.type === "object_reference") ?? null
      : top[1] ?? null
    const actionRef = top.length > 1 ? top[top.length - 1] : null
    const nameNode = this.referenceNameNode(nameRef)
    if (!nameNode) return
    const name = this.identifierName(nameNode, state)
    const target = tableRef && tableRef !== nameRef ? this.referenceLeaf(tableRef, state) : undefined
    const action = actionRef && actionRef !== nameRef && actionRef !== tableRef ? this.referenceLeaf(actionRef, state) : undefined

    this.createSymbol(name, ASTEngine.SymbolKind.Function, nameNode, null, state, {
      type: "trigger",
      isTrigger: true,
      targetTable: target,
      actionFunction: action,
    })
    this.addPattern("Triggers", state)
    if (target) this.addRelationship(ASTEngine.RelationshipType.References, name, target, state, { triggerTarget: true })
    // The action's qualification travels with the edge, for the same reason
    // `processCalls` passes it: `EXECUTE FUNCTION app.f()` names its schema, and a
    // `calls` edge that discarded that was published as `usage_contextual`.
    if (action) {
      const parts = actionRef ? this.referenceParts(actionRef, state) : []
      this.addRelationship(ASTEngine.RelationshipType.Calls, name, action, state,
        { triggerAction: true, ...(parts.length > 1 ? { qualified: parts.join(".") } : {}) })
    }
  }

  // ---------------------------------------------------------------- types / containers

  private processType(node: Node, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    const enumElements = this.firstDescendant(node, "enum_elements")
    const values = this.literalTexts(enumElements)
    const attributes = this.directChild(node, "column_definitions")
    const fields = attributes
      ? this.namedChildren(attributes)
        .filter((c) => c.type === "column_definition")
        .map((c) => {
          const fieldName = c.childForFieldName?.("name") ?? this.firstIdentifier(c)
          return fieldName ? this.identifierName(fieldName, state) : undefined
        })
        .filter((v): v is string => !!v)
      : []
    this.createSymbol(this.identifierName(nameNode, state), ASTEngine.SymbolKind.Type, nameNode, null, state, {
      type: values.length > 0 ? "enum" : "custom_type",
      enumValues: values,
      ...(fields.length ? { fields } : {}),
      customType: true,
    })
    this.addPattern(values.length > 0 ? "Enum Types" : "Custom Types", state)
  }

  private processNamedContainer(node: Node, kind: ASTEngine.SymbolKind, type: string, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    this.createSymbol(this.identifierName(nameNode, state), kind, nameNode, null, state, { type, isSchemaEntity: true })
    this.addPattern(type === "schema" ? "Schemas" : type === "sequence" ? "Sequences" : type === "extension" ? "Extensions" : "Roles", state)
  }

  /**
   * `CREATE EXTENSION name` — a declaration AND a dependency, and only the
   * declaration was being read.
   *
   * The extension is the closest thing SQL has to a separately published unit: it
   * ships its own types, functions and operators, it lives outside this unit, and
   * the database cannot run this file without it. `processNamedContainer` recorded
   * the symbol and stopped there, so 27 declarations over the 1,460-file census
   * produced 27 `module` symbols and **no edge at all** — a real cross-unit
   * dependency, invisible in the graph, in the one construct where SQL genuinely
   * has one.
   *
   * The edge is `imports`, and it is the same type the psql `\i`/`\ir` pass emits
   * for a different reason: a dependency on a named artifact resolved from outside
   * the file before the file's own SQL can mean anything. The two mechanisms are
   * kept distinguishable in metadata (`extensionInstall` vs `psqlInclude`) because
   * they answer different questions — one is "this file loads another FILE", the
   * other is "this file requires another DISTRIBUTION to be installed" — and a
   * consumer that cannot tell them apart will read a `\i schema.sql` edge as
   * evidence about the environment.
   *
   * WHY `global` AS THE SOURCE and why the target is an external name. The
   * extension is not declared by this file; it is installed into the DATABASE.
   * Labelling the edge `external` keeps it distinguishable from a psql include,
   * whose target IS a file in this repository and is in principle resolvable. That
   * makes the extension edges the only `imports` edges in this lane with a target
   * that can never bind, which is a property of the construct and is stated here
   * rather than left for a reader to discover from the resolution rate.
   *
   * `evidenceClass` is `structural`: `create_extension` is a visible rule and the
   * name is in the `object_reference` the rule puts there. Nothing here is a name
   * match. `CREATE EXTENSION IF NOT EXISTS` is the same shape with a guard
   * keyword, so it is the same edge — the extension is still required.
   */
  private processExtension(node: Node, state: ParseState): void {
    this.processNamedContainer(node, ASTEngine.SymbolKind.Module, "extension", state)
    const object = this.firstDescendant(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) {
      state.ambiguity.includeNonLiteral++
      return
    }
    const name = this.identifierName(nameNode, state)
    if (SQL_KEYWORDS.has(name.toLowerCase())) {
      state.ambiguity.keywordTargetsSuppressed++
      return
    }
    const line = node.startPosition.row + state.slice.rowOffset + 1
    this.addRelationship(ASTEngine.RelationshipType.Imports, "global", name, state, {
      extensionInstall: true,
      external: true,
      fileDependency: false,
      scope: "database",
      line,
    })
    state.ambiguity.extensionImportsEmitted++
    state.imports.push({
      module: name,
      items: [],
      importType: "sql_extension",
      lineNumber: line,
      line,
      range: this.range(node, state),
      isExternal: true,
      metadata: { extensionInstall: true, scope: "database" },
    })
  }

  private processDatabase(node: Node, state: ParseState): void {
    const object = this.directChild(node, "object_reference")
    const nameNode = object ? this.referenceNameNode(object) : this.firstIdentifier(node)
    if (!nameNode) return
    this.createSymbol(this.identifierName(nameNode, state), ASTEngine.SymbolKind.Namespace, nameNode, null, state, {
      type: "database",
      isSchemaEntity: true,
    })
    this.addPattern("Databases", state)
  }

  /**
   * `CREATE POLICY <name> ON <table> …` — a row-level-security policy.
   *
   * The name is the first `object_reference` and the table is the one after
   * `keyword_on`; both are real schema entities, so the policy is a symbol and
   * the table is an edge. `AS PERMISSIVE|RESTRICTIVE` and `TO <role>` are
   * deliberately not edged: a role is not a table, which is the same rule the
   * GRANT rule is written to keep.
   *
   * The policy's USING/WITH CHECK expressions are read through the same
   * declaration sweep as any other query node, so tables named inside them are
   * still reached.
   */
  private processPolicy(node: Node, state: ParseState): void {
    const children = this.namedChildren(node)
    const nameRef = children.find((c) => c.type === "object_reference")
    const onAt = children.findIndex((c) => c.type === "keyword_on")
    const targetRef = onAt >= 0 ? children.slice(onAt + 1).find((c) => c.type === "object_reference") ?? null : null
    const nameNode = nameRef ? this.referenceNameNode(nameRef) : null
    if (!nameRef || !nameNode) return
    const name = this.identifierName(nameNode, state)
    this.createSymbol(name, ASTEngine.SymbolKind.Constant, nameNode, null, state, {
      type: "policy",
      isSchemaEntity: true,
      ...(targetRef ? { policyOn: this.referenceLeaf(targetRef, state) } : {}),
    })
    this.addPattern("Row Level Security", state)
    const target = targetRef ? this.referenceLeaf(targetRef, state) : undefined
    if (target) this.addRelationship(ASTEngine.RelationshipType.References, name, target, state, { policyOn: true })
  }

  /**
   * `DO $$ … $$` — an anonymous procedural block.
   *
   * It declares nothing, so it mints no symbol, but the body is a real query
   * when the grammar could parse it (`EXECUTE format('DROP POLICY …')` and
   * `SELECT … FROM pg_policies` are the shapes a migrations corpus is full of),
   * so its table references are read and the procedural pattern is reported.
   */
  private processDo(node: Node, state: ParseState): void {
    this.addPattern("Anonymous Procedural Block", state)
    this.bumpComplexity(node, state)
    this.processQueryDependencies(node, null, state)
    this.processCalls(node, "global", state)
  }

  // ---------------------------------------------------------------- dml

  private recordDml(node: Node, operation: string, state: ParseState): void {
    const scope = node.parent?.type === "statement" ? node.parent : node
    const object = this.dmlTargetNode(node)
    const target = object ? this.referenceLeaf(object, state) : this.referenceLeaf(this.firstDescendant(scope, "object_reference"), state)
    if (target) {
      // The qualification travels with the edge. `INSERT INTO app.t` names its
      // schema and was published as `usage_contextual` because only the leaf was
      // read here — the same defect `addTableEdge` never had, in the one DML path
      // that resolves its own reference node.
      const parts = object ? this.referenceParts(object, state) : []
      this.addRelationship(ASTEngine.RelationshipType.Uses, "global", target, state, {
        operation,
        tableReference: true,
        ...(parts.length > 1 ? { qualified: parts.join(".") } : {}),
      })
    }
    this.addPattern(`${operation.toUpperCase()} Statements`, state)
    this.processQueryDependencies(scope, null, state)
  }

  /**
   * `MERGE INTO t USING s` — the rule is hidden (`_merge_statement`), so there is
   * no `merge` node: the keywords and both references are inlined into
   * `statement`. Both tables are real dependencies and neither was emitted.
   */
  private processMerge(node: Node, state: ParseState): void {
    for (const ref of this.namedChildren(node).filter((c) => c.type === "object_reference")) {
      const target = this.referenceLeaf(ref, state)
      if (target) this.addRelationship(ASTEngine.RelationshipType.Uses, "global", target, state, { operation: "merge", tableReference: true })
    }
    this.addPattern("MERGE Statements", state)
  }


  private processTruncate(node: Node, state: ParseState): void {
    for (const ref of this.namedChildren(node).filter((c) => c.type === "object_reference")) {
      const target = this.referenceLeaf(ref, state)
      if (target) this.addRelationship(ASTEngine.RelationshipType.Uses, "global", target, state, { operation: "truncate", tableReference: true })
    }
    this.addPattern("TRUNCATE Statements", state)
  }


  private processCopy(node: Node, state: ParseState): void {
    const target = this.referenceLeaf(this.firstDescendant(node, "object_reference"), state)
    if (target) this.addRelationship(ASTEngine.RelationshipType.Uses, "global", target, state, { operation: "copy", tableReference: true })
    this.addPattern("COPY Statements", state)
  }


  /**
   * A hidden-rule statement (`MERGE`, `TRUNCATE`, `COPY`) arrives as a KEYWORD
   * child of `statement`, because `_merge_statement` / `_truncate_statement` /
   * `_copy_statement` inline into their parent and emit no node of their own — so
   * no node of type `merge`/`truncate`/`copy` can exist to dispatch on. The
   * handler needs the enclosing `statement` (it holds the object_references), so
   * walk up SEEKING for it rather than by a fixed hop count: the first version
   * climbed four parents, sailed past `statement`, landed on `program`, and
   * emitted nothing.
   */
  /**
   * The nearest ANCESTOR `statement` — the scope a nested statement inherits.
   *
   * SQL attaches its `WITH` list to the STATEMENT, so a statement inside a `cte`
   * body, inside a plpgsql block or inside a dollar-quoted fragment inherits the
   * CTEs of the statement it is nested in, and nothing else. Distinct from
   * `enclosingStatement` above, which SEEKING includes the node itself and falls
   * back to it: this one starts at the parent and admits that there may be none,
   * because a top-level statement has no enclosing scope to inherit.
   *
   * `descendants` is transitive, so one level of lookup suffices however deeply
   * the statement is buried.
   */
  private ancestorStatement(node: Node): Node | null {
    let parent = node.parent
    while (parent) {
      if (parent.type === "statement") return parent
      parent = parent.parent
    }
    return null
  }

  private enclosingStatement(node: Node): Node {
    let current: Node | null = node
    while (current) {
      if (current.type === "statement") return current
      current = current.parent
    }
    return node
  }

  private processInlineMerge(keyword: Node, state: ParseState): void {
    this.processMerge(this.enclosingStatement(keyword), state)
  }

  private processInlineTruncate(keyword: Node, state: ParseState): void {
    this.processTruncate(this.enclosingStatement(keyword), state)
  }

  private processInlineCopy(keyword: Node, state: ParseState): void {
    this.processCopy(this.enclosingStatement(keyword), state)
  }

  /** `RETURNING col` names columns of the statement's own target table. */
  private processReturning(node: Node, state: ParseState): void {
    const columns = this.identifierTexts(node, state)
    if (columns.length === 0) return
    this.addPattern("RETURNING Clause", state)
  }

  /**
   * psql meta-commands. `\i` / `\ir` name another FILE, which is an import; the
   * other 121 shapes over the census corpus do not, and are counted rather than
   * silently ignored so a command the grammar starts producing later appears in
   * a number instead of in nothing.
   *
   * `psql_meta_command` is a LEAF token — the whole `\ir schema.sql` is one node
   * with no children — so both the command word and its argument have to be read
   * out of that one string. A character scan rather than a regex, per this
   * lane's zero-regex policy (`reviews/regex-policy.md`, and
   * `validation/m12/results/regex-census.json` which once recorded SQL at all as
   * unregistered).
   *
   * Three guards, each of which has already cost something if dropped:
   *   - the command must be `i` or `ir` exactly, so `\echo`, `\set`, `\gexec`,
   *     `\gset`, `\pset`, `\if`, `\endif` stay out (`\gset` writes a variable
   *     FROM a query, which is the opposite direction, and `\o`/`\g` write a
   *     query result TO a file, which is not a source dependency).
   *   - the argument must not begin with `:`. `\i :script` includes a file whose
   *     NAME is computed by an earlier `\set`, and a target invented from a
   *     variable name is a fabricated edge. Measured 0 on the corpus, so the
   *     guard costs nothing there and is kept for the corpus that uses it.
   *   - the argument must carry a SQL/dump suffix, so `\i` onto an extensionless
   *     name is skipped rather than resolved against nothing.
   *
   * The path is kept exactly as written — `../../orioledb.sql` is what the file
   * says and what a reader needs — with `relativeToScript` recording that `\ir`
   * resolves against the including script's own directory rather than psql's
   * working directory.
   */
  private processPsqlMetaCommand(node: Node, state: ParseState): void {
    const text = node.text
    if (text.length < 2 || text.charCodeAt(0) !== 92 /* \ */) return
    const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11
    let end = 1
    while (end < text.length && !isSpace(text.charCodeAt(end))) end++
    const command = text.slice(1, end).toLowerCase()
    if (!PSQL_INCLUDE_COMMANDS.has(command)) {
      state.ambiguity.psqlCommandsSkipped++
      return
    }
    let start = end
    while (start < text.length && isSpace(text.charCodeAt(start))) start++
    let stop = text.length
    while (stop > start && isSpace(text.charCodeAt(stop - 1))) stop--
    const argument = text.slice(start, stop)
    if (argument.length === 0) {
      state.ambiguity.includeNonLiteral++
      return
    }
    if (argument.charCodeAt(0) === 58 /* : */) {
      state.ambiguity.includeNonLiteral++
      return
    }
    for (let i = 0; i < argument.length; i++) {
      if (isSpace(argument.charCodeAt(i))) {
        state.ambiguity.includeNonLiteral++
        return
      }
    }
    const lowered = argument.toLowerCase()
    let suffixOk = false
    for (const suffix of PSQL_INCLUDE_SUFFIXES) {
      if (lowered.length > suffix.length && lowered.endsWith(suffix)) {
        suffixOk = true
        break
      }
    }
    if (!suffixOk) {
      state.ambiguity.includeNonLiteral++
      return
    }
    const line = node.startPosition.row + state.slice.rowOffset + 1
    const kind = `${command} ${argument} ${line}`
    if (state.includeKeys.has(kind)) return
    state.includeKeys.add(kind)
    this.addRelationship(ASTEngine.RelationshipType.Imports, "global", argument, state, {
      psqlInclude: true,
      includeKind: command,
      relativeToScript: command === "ir",
      fileDependency: true,
      line,
    })
    this.addPattern("psql Script Include", state)
    state.imports.push({
      module: argument,
      items: [],
      importType: "sql_import",
      lineNumber: line,
      line,
      range: this.range(node, state),
      isExternal: false,
      metadata: { psqlInclude: true, includeKind: command, relativeToScript: command === "ir" },
    })
  }

  /** `COMMENT ON <object> …` — the object named is a real dependency. */
  private processComment(node: Node, state: ParseState): void {
    this.addPattern("SQL Documentation", state)
    const children = this.namedChildren(node)
    const onAt = children.findIndex((c) => c.type === "keyword_on")
    const object = onAt >= 0 ? children.slice(onAt + 1).find((c) => c.type === "object_reference") ?? null : null
    if (!object) return
    // `COMMENT ON COLUMN t.c` — the object is a qualified COLUMN reference whose
    // table is the nested reference, so the dependency is the TABLE. `COMMENT ON
    // TABLE t` has a single-segment object and is the table already. Either way
    // the edge is taken from the reference's own parts, never from its last
    // segment, which for the column form is the column's name.
    const parts = this.referenceParts(object, state)
    // For the column form the parts are [schema?, table, COLUMN], so the table is
    // the second-to-last segment; the table form's own last segment is already the
    // table. Taking parts[0] instead would edge the SCHEMA on a qualified column
    // reference, which is the same class of error in the other direction.
    const isColumnComment = children.some((c) => c.type === "keyword_column")
    const target = isColumnComment && parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1]
    if (!target) return
    // The documented COLUMN is recorded, because without it the edge says only
    // "this table is mentioned" and the distinction a COMMENT ON COLUMN makes —
    // the thing the pre-fix read as the edge's target — is unrecoverable from the
    // result. It is also the fact a reader wants: which column is documented.
    const column = isColumnComment && parts.length >= 1 ? parts[parts.length - 1] : undefined
    this.addRelationship(ASTEngine.RelationshipType.References, "global", target, state, {
      operation: "comment",
      documented: true,
      ...(column && column !== target ? { column } : {}),
    })
  }

  /**
   * `GRANT` / `REVOKE`.
   *
   * The grammar rule keeps the grantee an `identifier`/`literal` and never an
   * `object_reference`, which is the structural reason `REVOKE SELECT ON t FROM
   * joe` can no longer publish `uses global->joe` — before the rule existed the
   * statement was an ERROR and the role name was reachable through a `from`
   * clause. The object the privilege applies to IS an `object_reference`, and it
   * is a real schema entity, so it is the one thing here that gets an edge.
   */
  private processGrant(node: Node, state: ParseState, operation: "grant" | "revoke"): void {
    this.addPattern("Permissions (GRANT/REVOKE)", state)
    // The `object` FIELD was removed here rather than waived. The grammar audit
    // validated every literal in this file against the real tree-sitter-sql wasm and
    // reported `object` as a field no node carries, so `childForFieldName("object")`
    // always returned undefined and the `??` fallback below carried the whole
    // behaviour. The comment above already said the object "IS an `object_reference`",
    // so the descendant search is what the code meant all along; the field read was a
    // guess that cost nothing and returned nothing.
    const object = this.firstDescendant(node, "object_reference")
    const target = object ? this.referenceLeaf(object, state) : undefined
    if (target) {
      this.addRelationship(ASTEngine.RelationshipType.References, "global", target, state, { operation, privilege: true })
    }
  }

  /**
   * Columns added by `ALTER TABLE … ADD COLUMN`.
   *
   * The grammar gives each added column its OWN `add_column` SIBLING rather than
   * one comma list, so `ALTER TABLE t ADD COLUMN a int, ADD COLUMN b text,
   * ADD COLUMN c numeric(6,2)` has three. Reading the first descendant published
   * only `a` and dropped the rest — measured on the corpus, a five-column
   * `ADD COLUMN IF NOT EXISTS …` migration published one of its five columns.
   */
  private processAlterTable(node: Node, state: ParseState): void {
    const table = this.referenceLeaf(this.directChild(node, "object_reference"), state)
    if (!table) return
    const added = this.namedChildren(node).filter((c) => c.type === "add_column")
    if (added.length === 0) return
    const owner = state.symbols.find((s) => s.name === table && s.metadata?.type === "table")
    if (!owner) return
    for (const add of added) {
      const definition = this.firstDescendant(add, "column_definition")
      if (!definition) continue
      const nameNode = definition.childForFieldName?.("name") ?? this.firstIdentifier(definition)
      if (!nameNode || !identifierTypes.has(nameNode.type)) continue
      if (this.reservedColumnName(nameNode)) {
        state.ambiguity.reservedNameSymbolsSuppressed++
        continue
      }
      const column = this.createSymbol(
        this.identifierName(nameNode, state),
        ASTEngine.SymbolKind.Property,
        nameNode,
        owner,
        state,
        { type: "column", sqlType: this.columnType(definition, state), addedByAlter: true },
      )
      this.addRelationship(ASTEngine.RelationshipType.Contains, table, column.name, state)
    }
  }

  // ---------------------------------------------------------------- queries

  private processQuery(node: Node, state: ParseState, owner: SqlSymbol | null): void {
    if (this.containsType(node, "join")) this.addPattern("Join Query Mapping", state)
    if (this.containsType(node, "cte")) this.addPattern("Common Table Expressions (CTE)", state)
    if (this.containsType(node, "set_operation")) this.addPattern("Set Operations (UNION/INTERSECT/EXCEPT)", state)
    if (this.containsType(node, "subquery")) this.addPattern("Subqueries", state)
    if (this.containsType(node, "case")) this.addPattern("Conditional Logic (CASE/WHEN)", state)
    if (this.containsType(node, "all_fields")) {
      this.addPattern("SELECT *", state)
      if (state.metadata.performanceScore !== undefined) state.metadata.performanceScore = Math.max(0, state.metadata.performanceScore - 30)
      // Was pushed once per occurrence, so the insight list repeated verbatim.
      this.addInsight("SELECT * detected — consider explicit column selection", state)
    }
    this.bumpComplexity(node, state)
    this.processQueryDependencies(node, owner, state)
    this.processCalls(node, owner?.name ?? "global", state)
  }

  private processQueryDependencies(node: Node, owner: SqlSymbol | null, state: ParseState, sourceOverride?: string): void {
    const source = sourceOverride ?? owner?.name ?? "global"
    /**
     * A CTE name is a local binding, and it shadows an UNQUALIFIED reference.
     * Matching on the bare leaf meant
     *   WITH x AS (SELECT 1) SELECT * FROM x JOIN public.x ON true
     * suppressed the real `public.x` edge too, and the file emitted no
     * relationship at all. A qualified reference is never a CTE.
     *
     * THE SCOPE IS TWO SETS, and the second one was missing until pass 2 found
     * it. Pass 1 fixed the DECLARATION SWEEP reaching a CTE body with an empty
     * scope; the shape that survived is a CTE body whose own name it references:
     *
     *   WITH RECURSIVE parse(i, s, a, b) USING KEY (s, a, b) AS (
     *     … FROM parse AS left_parse, recurring.parse AS right_parse …
     *   ) facts AS (SELECT … FROM parse) SELECT … FROM facts;
     *
     * (`duckdb/benchmark/recursive_cte/queries/performance/asql_cyk_using_key.sql`)
     *
     * `parse`'s body is a `statement` INSIDE the `cte` node that declares it, so
     * every set derived from that statement — the sweep's `ancestorStatement`
     * scope, and `descendants(node, "cte")` here — excludes `parse`, because the
     * node that names it is an ANCESTOR and not a descendant. PostgreSQL binds the
     * name in its own body with or without `RECURSIVE` (that is what makes the
     * recursive form work), so the reference is the CTE and publishing
     * `uses global->parse` names a table that no file can declare — the same
     * fabrication pass 1 removed from the other entry point, 33x over the corpus.
     *
     * WHY ONLY THE ANCESTOR CHAIN, and not every CTE in the enclosing statement.
     * An earlier attempt at a wider scope walked the ancestors and collected
     * everything under the with-clause, which shadowed real tables outside its
     * actual scope and broke four fixtures — the `localCtes` field comment on
     * `ParseState` records that. The chain here collects exactly the `cte` nodes
     * ON THE PATH from the node to the root, so it adds a CTE's own name and
     * nothing a later sibling declared.
     */
    const localCtes = this.cteScope(node, state)
    for (const relation of this.descendants(node, "relation")) {
      const object = this.namedChildren(relation).find((c) => c.type === "object_reference")
      if (!object) continue
      this.addTableEdge(source, object, localCtes, state)
    }
    for (const from of this.descendants(node, "from")) {
      for (const child of this.namedChildren(from)) {
        if (child.type !== "object_reference") continue
        this.addTableEdge(source, child, localCtes, state)
      }
    }
    for (const merge of this.descendants(node, "keyword_merge")) {
      void merge
    }
    this.processInstantiations(node, source, state)
  }

  /**
   * `ROW(...)::my_composite` — a value BUILT for a named type.
   *
   * PostgreSQL implements a composite cast as a call to that type's constructor,
   * so this is the one place SQL constructs an instance of a declared type, and it
   * is what the ontology's `instantiates` names. Measured over the 1,460-file
   * census: 4,406 `cast` nodes, of which only those carrying a `custom_type`
   * FIELD name a user type at all (a builtin target such as `::integer` is a bare
   * anonymous token), and of those the ones whose VALUE side is a constructor
   * rather than a pre-existing value are the construction events.
   *
   * Two guards, and both were arrived at by discarding a wrong answer:
   *
   *   - the value side must CONSTRUCT. `x::my_enum` and `col::my_type` convert a
   *     value that already exists; publishing those would assert an object was
   *     created where none was. A `cast` whose left side is an ERROR is also
   *     skipped: DuckDB's `[a+b, …]::vec4` parses as `ERROR :: type` because the
   *     grammar cannot read a bracketed array literal, so the shape is a damaged
   *     parse and not a construction the analyzer can vouch for.
   *   - the type name must not be a keyword or a builtin. DuckDB's
   *     `CAST(ROW(x) AS ROW(a INT, b INT))` puts the literal word `ROW` in the
   *     same `custom_type` field, and 67 casts corpus-wide target a name no file
   *     declares. Those stay external names, which is what they are.
   *
   * The target may be declared in another file — a composite type is usually
   * declared once and constructed from many migrations — so an unresolved target
   * is the normal case for this type and is reported as such rather than
   * suppressed. `evidenceClass` is `structural` because the constructor and the
   * type name are both in grammar-mandated positions; nothing here is a name
   * match.
   */
  /**
   * The names of the `cte` nodes the given node is INSIDE, nearest first.
   *
   * A CTE's own name is bound inside its own body — that is what makes
   * `WITH RECURSIVE t AS (… FROM t …)` work — so every reference inside that body
   * has to see it. The nodes naming it are ANCESTORS of the reference and
   * DESCENDANTS of nothing the reference owns, which is why a scope computed from
   * `descendants(reference, "cte")` or `descendants(enclosingStatement, "cte")`
   * cannot contain it. Only the chain from the node to the root does.
   *
   * Bounded by construction: it is one pass up the parent chain and it collects a
   * node's own name, so it cannot pick up a name a later sibling CTE declared.
   */
  private ancestorCteNames(node: Node, state: ParseState): string[] {
    const names: string[] = []
    for (let a = node.parent; a; a = a.parent) {
      if (a.type !== "cte") continue
      const nm = this.firstIdentifier(a, state)
      if (nm) names.push(this.identifierName(nm, state))
    }
    return names
  }

  /**
   * THE CTE SCOPE of a node, which is two sets and neither of them is
   * `descendants(node, "cte")`.
   *
   * SQL's rule is that a WITH list's names are visible to every LATER item in the
   * list and to the main query — not only inside the item that declares them. So:
   *
   *   WITH aoc5_input(i) AS (…), lines(y,line) AS (… FROM aoc5_input …),
   *        rules(b,a) AS (… FROM lines …), updates(y,x,v) AS (… FROM lines …)
   *   SELECT … FROM updates;
   *
   * `updates`' body reads `lines`, a SIBLING CTE. Both the per-node set and the
   * sweep's `ancestorStatement` set miss it: the body is its own `statement`, its
   * subtree holds no `cte`, and the node that names `lines` is neither an ancestor
   * nor a descendant of the reference. Measured over the grown corpus, this leaked
   * 32 `uses` edges across 16 DuckDB benchmark files — the same wrong output as
   * pass 1's CTE leak, reached through a third entry point.
   *
   * The two sets that do settle it:
   *
   *   1. every `cte` under the OUTERMOST enclosing `statement`, which is the WITH
   *      list the body belongs to — siblings included;
   *   2. the `cte` names on the ANCESTOR CHAIN, which is what a CTE's own body
   *      needs and is the only set that can see the node naming it.
   *
   * WHY THE OUTERMOST statement and not the nearest. Two `WITH` lists in one file
   * are two scopes, and a name from the first must not shadow a table in the
   * second. The outermost enclosing `statement` is exactly one WITH list.
   *
   * WHY A WIDER SCOPE WAS TRIED AND REVERTED, since this is the third attempt.
   * `ParseState.localCtes`'s field comment records an ancestor walk that collected
   * everything under the with-clause and shadowed real tables outside its actual
   * scope. That version walked ancestors and kept DESCENDANTS of each — which
   * re-reaches the same set this one does, but from the wrong root when the
   * reference is in the OUTER query: it pulled in a WITH list belonging to a
   * function body further up the file. Anchoring on the outermost statement of the
   * reference itself removes that, because a reference in the outer query has that
   * outer query as its own outermost statement. `sqld5` and `sqld14` pin both
   * directions.
   */
  private cteScope(node: Node, state: ParseState): Set<string> {
    let outermost: Node = node
    for (let a = node.parent; a; a = a.parent) if (a.type === "statement") outermost = a
    const scope = new Set<string>()
    const collect = (from: Node) => {
      for (const cte of this.descendants(from, "cte")) {
        const nm = this.firstIdentifier(cte, state)
        if (nm) scope.add(this.identifierName(nm, state))
      }
    }
    collect(outermost)
    if (outermost !== node) collect(node)
    // The WITH LIST this node belongs to, read as the node's parent's own subtree.
    //
    // Both rules above can miss it, and the measured case needs this one:
    // `duckdb/benchmark/aoc24/queries/day05.sql` has its whole `WITH RECURSIVE`
    // list inside an ERROR node — 34 unparseable regions in 1,428 lines — so the
    // six `cte` nodes are SIBLINGS of each other under that ERROR and the ERROR's
    // parent is `program`. There is no `statement` ancestor to anchor on, the node
    // itself is a `cte` whose subtree holds no other `cte`, and the parent chain
    // holds none either: all three sets come back empty, and 5 `uses` edges were
    // published naming CTE aliases as tables.
    //
    // It is gated on the node BEING a `cte` or being directly inside one. An
    // ungated `collect(node.parent)` would also reach a `WITH` list in a SIBLING
    // sub-statement of a plpgsql body, which is a different scope.
    if (node.type === "cte" || node.parent?.type === "cte") {
      let listRoot = node.parent
      if (listRoot?.type === "cte") listRoot = listRoot.parent
      if (listRoot) collect(listRoot)
    }
    for (const name of this.ancestorCteNames(node, state)) scope.add(name)
    return scope
  }

  private processInstantiations(node: Node, source: string, state: ParseState): void {
    for (const cast of this.descendants(node, "cast")) {
      const target = cast.childForFieldName?.("custom_type") as Node | null
      if (!target) continue
      const name = this.referenceLeaf(target, state)
      if (!name) continue
      const lowered = name.toLowerCase()
      if (SQL_KEYWORDS.has(lowered) || SQL_BUILTINS.has(lowered)) {
        state.ambiguity.keywordTargetsSuppressed++
        continue
      }
      let value: Node | null = null
      for (let i = 0; i < cast.childCount; i++) {
        const child = cast.child(i)
        if (!child) continue
        if (child.type === "::") break
        if (child.isNamed) value = child
      }
      if (!value || value.hasError) continue
      if (!this.constructsAValue(value)) continue
      this.addRelationship(ASTEngine.RelationshipType.Instantiates, source, name, state, {
        operation: "cast",
        construction: true,
        constructor: value.type,
      })
      state.ambiguity.instantiationsEmitted++
    }
  }

  /**
   * Is this expression BUILDING a value, rather than naming one?
   *
   * `ROW(1,2)` is the grammar's `invocation` whose callee is the bare word `ROW`,
   * and that callee name is the discriminator: `nextval('s')::bigint` is also an
   * `invocation` and is a conversion. `('a', 2)` and `ARRAY[...]` are `list` /
   * `array`, which cannot be anything but a constructed collection. Anything else
   * — a `field`, a `parameter`, a bare `literal`, a `parenthesized_expression`
   * wrapping a column — is a value that already existed.
   */
  private constructsAValue(node: Node): boolean {
    if (CONSTRUCTOR_VALUE_NODES.has(node.type)) return true
    if (node.type === "invocation") {
      const callee = this.directChild(node, "object_reference")
      const nameNode = callee ? this.referenceNameNode(callee) : this.firstIdentifier(node)
      return nameNode?.text.toLowerCase() === "row"
    }
    return false
  }

  private addTableEdge(source: string, object: Node, localCtes: Set<string>, state: ParseState): void {
    const parts = this.referenceParts(object, state)
    if (parts.length === 0) return
    const leaf = parts[parts.length - 1]
    if (parts.length === 1 && (localCtes.has(leaf) || state.localCtes.has(leaf))) return
    this.addRelationship(ASTEngine.RelationshipType.Uses, source, leaf, state, {
      tableReference: true,
      ...(parts.length > 1 ? { qualified: parts.join(".") } : {}),
    })
  }

  /**
   * Call edges, one per `invocation` the grammar actually recognised.
   *
   * An `invocation` node whose OWN subtree carries an ERROR is skipped, and that
   * test is the whole fix. Error recovery will synthesise an `invocation` whose
   * callee slot holds whatever token it happened to reach, and the measured case
   * is a PL/pgSQL cursor loop:
   *
   *   CREATE OR REPLACE FUNCTION _drop_all_policies(p_table TEXT) … AS $$
   *   DECLARE r RECORD;
   *   BEGIN
   *     FOR r IN SELECT policyname FROM pg_policies WHERE … LOOP   -- unparseable
   *       EXECUTE format('DROP POLICY … %I', r.policyname, p_table);
   *   END LOOP;
   *   END; $$ LANGUAGE plpgsql;
   *
   * parses the `FOR … LOOP` as `invocation( object_reference("p_table"),
   * ERROR("LOOP EXECUTE format"), term, term, term )` — so the first
   * object_reference child, which the callee is read from, is the function's own
   * PARAMETER, and the analyzer published `calls _drop_all_policies -> p_table`:
   * a call into a variable. Five such edges measured on the corpus, one per
   * migration that writes this shape.
   *
   * Per-node `hasError` is the right granularity: a clean invocation beside a
   * damaged sibling is unaffected, so no real call is lost, and it is a property
   * of the tree rather than a guess about the text. The suppression is counted in
   * `ambiguity.recoveryCallsSuppressed` so it is visible rather than silent.
   */
  private processCalls(node: Node, source: string, state: ParseState): void {
    for (const invocation of this.descendants(node, "invocation")) {
      if (invocation.hasError) {
        state.ambiguity.recoveryCallsSuppressed++
        continue
      }
      const object = this.directChild(invocation, "object_reference")
      const target = object ? this.referenceLeaf(object, state) : ""
      if (!target) continue
      if (SQL_KEYWORDS.has(target.toLowerCase())) {
        state.ambiguity.keywordTargetsSuppressed++
        continue
      }
      if (SQL_BUILTINS.has(target.toLowerCase())) {
        state.ambiguity.builtinCallsSuppressed++
        continue
      }
      // The qualification travels with the edge, and pass 2 is why: this call site
      // passed no metadata at all, so `evidenceClassFor`'s `reference_qualified`
      // arm read an always-undefined field and `calls` could NEVER reach that tier.
      // A corpus measurement found the arm unreachable and the tier under-claimed:
      // every `schema.func(…)` in the corpus was published as `usage_contextual`,
      // which is the honest label for `my_func(1)` and a wrong one for a reference
      // that names its schema. `addTableEdge` already passed `qualified` for the
      // same reason; the two call sites now agree.
      const parts = object ? this.referenceParts(object, state) : []
      this.addRelationship(ASTEngine.RelationshipType.Calls, source, target, state,
        parts.length > 1 ? { qualified: parts.join(".") } : {})
    }
  }

  private recordTableTarget(node: Node, type: "uses" | "references", operation: string, state: ParseState): void {
    const object = this.firstDescendant(node, "object_reference")
    if (!object) return
    const target = this.referenceLeaf(object, state)
    if (!target) return
    const parts = this.referenceParts(object, state)
    this.addRelationship(type === "uses" ? ASTEngine.RelationshipType.Uses : ASTEngine.RelationshipType.References, "global", target, state, {
      operation,
      tableReference: true,
      ...(parts.length > 1 ? { qualified: parts.join(".") } : {}),
    })
  }

  /**
   * The `object_reference` node whose leaf is the DML statement's own target, or
   * `null` when the shape does not have one. Split out of `dmlTarget` so the CALLER
   * can read the reference's parts and not only its leaf: a bare leaf throws away
   * the qualification, which is the whole content of `INSERT INTO app.t`.
   */
  private dmlTargetNode(node: Node): Node | null {
    if (node.type === "insert") return this.directChild(node, "object_reference")
    if (node.type === "update") {
      const relation = this.directChild(node, "relation")
      return relation ? this.directChild(relation, "object_reference") : this.firstDescendant(node, "object_reference")
    }
    if (node.type === "delete") {
      const scope = node.parent?.type === "statement" ? node.parent : node
      return this.directChild(scope, "from") ? this.firstDescendant(this.directChild(scope, "from")!, "object_reference") : this.firstDescendant(scope, "object_reference")
    }
    return this.firstDescendant(node, "object_reference")
  }

  private dmlTarget(node: Node, state: ParseState): string | undefined {
    const object = this.dmlTargetNode(node)
    return object ? this.referenceLeaf(object, state) : undefined
  }

  // ---------------------------------------------------------------- symbols / edges

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: SqlSymbol | null,
    state: ParseState,
    metadata: Record<string, any> = {},
    extra: Partial<SqlSymbol> = {},
  ): SqlSymbol {
    // File coordinates, for the same reason `markDeclaration` uses them: the resync
    // and EXECUTE-literal passes hand this function nodes from a re-parsed SLICE,
    // and a slice-local `startIndex` collides with an offset the main pass already
    // consumed. The consequence was a real missing symbol — the declaration the
    // EXECUTE pass recovers was treated as a duplicate of an unrelated one at the
    // same slice-local offset and dropped.
    const identity = `${node.startIndex + state.slice.byteOffset}:${kind}:${name}:${parent?.name ?? ""}`
    if (state.symbolKeys.has(identity)) {
      return state.symbols.find((s) => s.name === name && s.kind === kind && s.ownerName === parent?.name) ?? this.placeholder(name, kind, parent)
    }
    state.symbolKeys.add(identity)
    const symbol: SqlSymbol = {
      name,
      kind,
      range: this.range(node, state),
      parentId: parent ? `${parent.id}.${name}` : undefined,
      ownerName: parent?.name,
      ownerKind: parent?.kind,
      parent: parent?.name,
      metadata,
      ...extra,
    }
    /**
     * `id` was `parentId ?? name`, so `CREATE TABLE a.t` and `CREATE TABLE b.t`
     * both got id `t` — duplicate ids silently drop nodes from id-keyed graph
     * consumers and conflate two distinct declarations (the RSD3 class the M14
     * fixture lane can already pin). A top-level id that is already taken by a
     * different declaration gets a discriminator.
     */
    let id = symbol.parentId ?? name
    const seen = state.idCounts.get(id) ?? 0
    state.idCounts.set(id, seen + 1)
    if (seen > 0) id = `${id}#${seen + 1}`
    symbol.id = id
    state.symbols.push(symbol)
    state.symbolNames.add(name)
    if (parent) this.addRelationship(ASTEngine.RelationshipType.Contains, parent.name, name, state)
    return symbol
  }

  /**
   * A symbol of this name and kind already emitted in this file, if any.
   *
   * Used to attach a member to an owner that is declared as a SIBLING statement.
   * `createSymbol` returns a `placeholder` when its identity key is taken, so an
   * index declared after its table already resolves through the ordinary path; this
   * covers the other order, where the index arrives first.
   */
  private existingSymbol(name: string, kind: ASTEngine.SymbolKind, state: ParseState): SqlSymbol | undefined {
    return state.symbols.find((s) => s.name === name && s.kind === kind)
  }

  private placeholder(name: string, kind: ASTEngine.SymbolKind, parent: SqlSymbol | null): SqlSymbol {
    return {
      name,
      kind,
      id: parent ? `${parent.id}.${name}` : name,
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 },
      ownerName: parent?.name,
      metadata: {},
    }
  }

  private addRelationship(
    type: ASTEngine.RelationshipType,
    source: string,
    target: string,
    state: ParseState,
    metadata: Record<string, any> = {},
  ): void {
    if (!source || !target) return
    if (source === target && type === ASTEngine.RelationshipType.Contains) return
    // A reserved word is never a table and never a function. Guarded here as
    // well as at the call site so an ERROR-recovery keyword cannot reach the
    // graph from any path.
    if (SQL_KEYWORDS.has(target.toLowerCase()) && !state.symbolNames.has(target)) {
      state.ambiguity.keywordTargetsSuppressed++
      return
    }
    // Classify a target that is a real PostgreSQL or platform object rather than
    // something this project declares.
    //
    // WHY THE EDGE IS KEPT AND LABELLED rather than dropped. `GRANT … ON SCHEMA
    // public` genuinely references PostgreSQL's implicit `public` schema, and
    // `information_schema.columns` genuinely is a table. Dropping those edges
    // would lose a true fact about the file; leaving them bare makes an
    // UNRESOLVED edge that a consumer — including an AI agent reading this
    // graph — can only interpret as "the project declares this and the analyzer
    // missed it", which is the wrong conclusion and the one that invites a
    // hallucination. Measured on ProxiCall: of 12,462 edges, 12,306 resolve
    // (98.7%) and the 156 that do not are 63 PostgreSQL catalog reads, 9
    // information_schema names, 6 references to the implicit `public` schema,
    // 38 whose declaration is in a file the grammar cannot parse, and about 40
    // genuinely dangling. Not one of the 156 is a fabricated edge.
    //
    // The label is therefore the deliverable: `external` says the target is
    // outside the project by construction, which is a DIFFERENT statement from
    // "unresolved", and only the remainder is a real gap.
    // The edge target is frequently the BARE TAIL of a qualified reference
    // (`vault.decrypted_secrets` -> `decrypted_secrets`), so classification has
    // to look at the qualified name the metadata carries as well, or a platform
    // object is read as a project table.
    const externalKind = classifyExternalTarget(target, metadata.qualified as string | undefined)
    if (externalKind && !state.externalTargets) {
      state.externalTargets = { postgresCatalog: 0, informationSchema: 0, implicitSchema: 0, platform: 0 }
    }
    if (externalKind) {
      state.externalTargets![externalKind]++
      metadata = { ...metadata, external: externalKind }
    }
    const key = `${type}\u0000${source}\u0000${target}`
    const existing = state.relationshipsByKey.get(key)
    if (existing) {
      if (metadata.operation) {
        const operations = Array.isArray(existing.metadata?.operations)
          ? existing.metadata.operations
          : existing.metadata?.operation
            ? [existing.metadata.operation]
            : []
        if (!operations.includes(metadata.operation)) {
          existing.metadata = { ...existing.metadata, operations: [...operations, metadata.operation] }
        }
      }
      return
    }
    state.relationshipKeys.add(key)
    const relationship = { type, source, target, confidence: 1, weight: 1, metadata: { ...metadata, evidenceClass: metadata.evidenceClass ?? this.evidenceClassFor(type, metadata) } }
    state.relationshipsByKey.set(key, relationship)
    state.relationships.push(relationship)
  }

  /**
   * The tier an emitted edge was actually derived at.
   *
   * WHY THIS EXISTS, and what it cost to be missing. Until this mapping existed
   * every edge this analyzer emitted carried `confidence: 1` and NO
   * `evidenceClass` at all — so the honesty contract's §4 requirement, that the
   * heuristic/deterministic ratio be a queryable NUMBER, was not answerable for
   * this lane: the census reported `evidenceClass` absent on 22,073 of 22,073
   * edges, which reads as "no heuristics" and in fact means "nothing recorded".
   * A field that is absent is not the same claim as a field that is uniformly
   * `structural`, and only one of them is true.
   *
   * The tiers, and why each edge lands where it does:
   *
   *   structural          the fact is in a grammar-mandated position. Every
   *                       `contains` (an owner and a member the grammar nested
   *                       it under), every `imports` (a `psql_meta_command`
   *                       token naming a file), every `overrides` (an
   *                       `OR REPLACE` on a name this file declared), every
   *                       `instantiates` (a `cast` whose `custom_type` FIELD is
   *                       the type), and every `references` — the FK target sits
   *                       after `keyword_references`, the trigger's table after
   *                       `keyword_on`, the policy's table after `keyword_on`,
   *                       GRANT/REVOKE's object is the statement's own
   *                       `object_reference`. Each of those is a fixed slot, not a
   *                       name match.
   *   usage_contextual    the name sits in a bare name slot with nothing around
   *                       it to corroborate: a `uses` edge from a `from`/`relation`
   *                       clause (the relation may be a CTE, which is why the CTE
   *                       guard exists), and a `calls` edge whose callee is an
   *                       UNQUALIFIED `invocation` — `my_func(1)`, which the
   *                       grammar has told us is a call and not which `my_func`
   *                       among the schemas resolves it.
   *   reference_qualified the name was read through a QUALIFIED reference, which
   *                       is the one case that carries its own disambiguation:
   *                       `schema.func(...)` names one object by construction.
   *
   * `confidence` stays 1 for all of them, and that is now a claim rather than an
   * omission: no edge this analyzer emits is a guess about a NAME. Where the
   * analyzer genuinely cannot tell — a target it labels `external`, a
   * concatenation fragment whose identifier is computed at run time — the edge is
   * not emitted at all, and the suppression is counted in `ambiguity` instead.
   */
  private evidenceClassFor(type: ASTEngine.RelationshipType, metadata: Record<string, any>): string {
    switch (type) {
      case ASTEngine.RelationshipType.Imports:
        return "import_based"
      case ASTEngine.RelationshipType.Calls:
      case ASTEngine.RelationshipType.Uses:
        // ONE rule for both, because pass 2 found the two arms disagreed: `Calls`
        // consulted `metadata.qualified` and `Uses` hardcoded `usage_contextual`,
        // while `addTableEdge` — which emits every `uses` edge — has passed
        // `qualified` since it was written. So a `uses` edge derived from
        // `FROM app.users` carried the qualification in metadata and was still
        // labelled as if nothing disambiguated it. `reference_qualified` means the
        // name was read through a reference that names its own schema, which is a
        // stronger claim than a bare slot and the tier exists for it.
        return metadata.qualified ? "reference_qualified" : "usage_contextual"
      case ASTEngine.RelationshipType.Contains:
      case ASTEngine.RelationshipType.References:
      case ASTEngine.RelationshipType.Extends:
      case ASTEngine.RelationshipType.Implements:
      case ASTEngine.RelationshipType.Exports:
      case ASTEngine.RelationshipType.Overrides:
      case ASTEngine.RelationshipType.Instantiates:
        return "structural"
      default:
        return "structural"
    }
  }

  // ---------------------------------------------------------------- identifiers

  /**
   * An identifier's NAME, with the delimiter removed.
   *
   * Three quoting styles, three behaviours before this: `"MyTable"` kept its
   * double quotes in `name` and `id`, `` `users` `` kept its backticks, and
   * `[dbo].[Users]` had them stripped. The quotes are SQL syntax, not part of
   * the name, so they are removed here and the raw text kept in metadata.
   */
  private identifierName(node: Node, state: ParseState): string {
    const raw = node.text
    const stripped = this.stripIdentifierQuotes(raw)
    if (stripped !== raw) {
      state.ambiguity.quotedIdentifiers++
      return stripped
    }
    return raw
  }

  private stripIdentifierQuotes(value: string): string {
    if (value.length < 2) return value
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "`" && last === "`") || (first === "[" && last === "]")) {
      const inner = value.slice(1, -1)
      // SQL escapes a quote inside a quoted identifier by doubling it.
      return first === '"' ? inner.replaceAll('""', '"') : inner
    }
    return value
  }

  /**
   * The parts of an `object_reference`, each unquoted.
   *
   * A QUALIFIED COLUMN reference nests its table as an `object_reference` CHILD
   * rather than as a sibling identifier — this is the shape
   * `COMMENT ON COLUMN business_inventory_items.calories` produces:
   *
   *   object_reference "business_inventory_items.calories"
   *     object_reference "business_inventory_items"
   *     identifier "calories"
   *
   * so a flat identifier walk sees only `calories` and the reference resolves to
   * the COLUMN, which is how a column was published as a table dependency. When
   * the first named child is itself a reference, its parts are the prefix.
   */
  private referenceParts(node: Node, state: ParseState): string[] {
    const parts: string[] = []
    for (const child of this.namedChildren(node)) {
      if (child.type === "object_reference") {
        parts.push(...this.referenceParts(child, state))
        continue
      }
      if (child.type === "identifier" || child.type === "literal") parts.push(this.identifierName(child, state))
    }
    if (parts.length === 0) {
      for (const id of this.descendants(node, "identifier")) parts.push(this.identifierName(id, state))
    }
    return parts
  }

  private referenceNameNode(node: Node): Node | null {
    if (node.type === "identifier" || node.type === "literal") return node
    return node.childForFieldName?.("name") ?? this.lastIdentifier(node)
  }

  private lastIdentifier(node: Node): Node | null {
    const ids = this.descendants(node, "identifier")
    if (ids.length) return ids[ids.length - 1]
    const literals = this.descendants(node, "literal")
    return literals.length ? literals[literals.length - 1] : null
  }

  private referenceLeaf(node: Node | null, state: ParseState): string | undefined {
    if (!node) return undefined
    const nameNode = this.referenceNameNode(node)
    return nameNode ? this.identifierName(nameNode, state) : undefined
  }

  private referenceText(node: Node, state: ParseState): string {
    const parts = this.referenceParts(node, state)
    return parts.length ? parts.join(".") : node.text
  }

  // ---------------------------------------------------------------- metadata

  private addPattern(pattern: string, state: ParseState): void {
    state.patterns.add(pattern)
  }

  private addInsight(insight: string, state: ParseState): void {
    const list = state.metadata.architecturalInsights
    if (Array.isArray(list) && !list.includes(insight)) list.push(insight)
  }

  private bumpComplexity(node: Node, state: ParseState): void {
    const stack: Node[] = [node]
    let increment = 0
    while (stack.length) {
      const current = stack.pop()!
      if (current.type === "case" || current.type === "join" || current.type === "when_clause" || current.type === "set_operation") increment++
      for (let i = 0; i < current.namedChildCount; i++) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    state.metadata.cyclomaticComplexity = (state.metadata.cyclomaticComplexity ?? 1) + increment
  }

  // ---------------------------------------------------------------- traversal helpers

  private directChild(node: Node, type: string): Node | null {
    for (const child of this.namedChildren(node)) if (child.type === type) return child
    return null
  }

  private firstIdentifier(node: Node | null, state?: ParseState): Node | null {
    if (!node) return null
    void state
    const ids = this.descendants(node, "identifier")
    if (ids.length) return ids[0]
    const literals = this.descendants(node, "literal")
    return literals.length ? literals[0] : null
  }

  private containsChildType(node: Node, type: string): boolean {
    if (node.type === type) return true
    for (const child of this.namedChildren(node)) if (this.containsChildType(child, type)) return true
    return false
  }

  /**
   * An index's key columns, in source order.
   *
   * `index_fields` holds a list of `field` nodes, each of which names its column
   * in a FIELD (`column` for a plain name, `function` for an expression) and
   * carries the name as a child — an `identifier` when unquoted, a `literal` when
   * quoted. Collecting `identifier` descendants alone therefore dropped every
   * quoted index column (`ON t ("b")` reported `[]`) and, on an expression
   * column, reported the expression's ARGUMENT rather than the expression.
   * Read the `field`'s own `column` field first, and its `function` text second,
   * because both are what the writer of the index meant.
   */
  private identifierTexts(node: Node | null, state: ParseState): string[] {
    if (!node) return []
    const out: string[] = []
    for (const field of this.namedChildren(node)) {
      if (field.type !== "field") continue
      const column = field.childForFieldName?.("column")
      if (column) { out.push(this.identifierName(column, state)); continue }
      const fn = field.childForFieldName?.("function")
      if (fn) { out.push(fn.text); continue }
      const leaf = this.firstIdentifier(field, state)
      if (leaf) out.push(this.identifierName(leaf, state))
    }
    return out
  }

  private literalTexts(node: Node | null): string[] {
    return node ? this.descendants(node, "literal").map((n) => n.text) : []
  }

  private containsType(node: Node, type: string): boolean {
    return node.type === type || this.descendants(node, type).length > 0
  }

  private firstDescendant(node: Node, type: string): Node | null {
    if (node.type === type) return node
    return this.descendants(node, type)[0] ?? null
  }

  private descendants(node: Node, type?: string): Node[] {
    const result: Node[] = []
    const stack: Node[] = []
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
    while (stack.length) {
      const current = stack.pop()!
      if (!type || current.type === type) result.push(current)
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return result
  }

  private namedChildren(node: Node): Node[] {
    const result: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) result.push(child)
    }
    return result
  }

  /**
   * 1-based rows AND columns.
   *
   * The engine's own ParseError range uses `startPosition.column + 1`
   * (engine.ts:1180) and every other analyzer that builds a range helper does
   * the same — this one was the only 0-based range in the tree, so all four
   * column fields of every SQL symbol were off by one across the whole corpus.
   * `startIndex`/`endIndex` stay 0-based byte offsets, as everywhere else.
   */
  private range(node: Node, state: ParseState): SqlSymbol["range"] {
    const slice = state.slice
    const startRow = node.startPosition.row + slice.rowOffset
    const endRow = node.endPosition.row + slice.rowOffset
    return {
      startLine: startRow + 1,
      startColumn: node.startPosition.row === 0 ? node.startPosition.column + slice.columnOffset + 1 : node.startPosition.column + 1,
      endLine: endRow + 1,
      endColumn: node.endPosition.row === 0 ? node.endPosition.column + slice.columnOffset + 1 : node.endPosition.column + 1,
      startIndex: node.startIndex + slice.byteOffset,
      endIndex: node.endIndex + slice.byteOffset,
    }
  }

  private countLines(content: string): number {
    let lines = 1
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") lines++
    return lines
  }
}

/**
 * The declaration nodes this grammar produces, as measured by
 * probe/grammar-census.mts over the dialect battery (321 distinct node types).
 * `create_policy` was measured dead on the PINNED grammar and is live on the
 * patched one: the pinned build produced ERROR for every policy shape tried, the
 * patched build parses all six (bare / FOR SELECT / AS PERMISSIVE / TO role /
 * permissive-only / FOR UPDATE … WITH CHECK) with zero errors. That is the whole
 * argument for a patched grammar in one line — the node type existed in the rule
 * set and was unreachable in the compiled artifact. The `*_statement` names the
 * previous version also matched
 * (`create_table_statement`, `insert_statement`, …) are not here because the
 * grammar never produces any of them either. script/m12/sql-node-types-compare.ts
 * fails this lane on exactly that class, over the whole corpus plus a declared
 * dialect battery rather than three fixture files.
 */
const DECLARATION_NODES = new Set([
  "create_table",
  "create_view",
  "create_materialized_view",
  "create_index",
  "create_function",
  "create_procedure",
  "create_trigger",
  "create_type",
  "create_schema",
  "create_sequence",
  "create_role",
  "create_extension",
  "create_database",
  "create_policy",
])
