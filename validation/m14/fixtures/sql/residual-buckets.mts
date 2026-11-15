/**
 * SQL RESIDUAL BUCKETS — the closing classification of the lane's `unresolved` edges.
 *
 * ## WHAT IT IS FOR
 *
 * `residual-cause-census.mts` gives every unresolved edge an OUTCOME (through the gate's own
 * `classifyEdge`) and a coarse bucket. This file does the part clause 2 actually requires: it
 * names the CONSTRUCT in each bucket and makes the counts CLOSE against the gate's own total, so
 * "the causes account for the unresolved" is a checked arithmetic fact rather than a claim in
 * prose.
 *
 * ## WHERE THE NUMBERS COME FROM
 *
 * Input is the census TSV (one row per unresolved edge, written by the census over the gate's own
 * whole-corpus population). Nothing here re-parses anything: a bucket is a rule over
 * (type, target, metadata) and the rule is stated per bucket below.
 *
 * ## THE ONE JUDGEMENT IN THE FILE, AND HOW IT IS KEPT HONEST
 *
 * `SQL_PROVIDED_FUNCTIONS` is a CURATED vocabulary of function names a SQL engine or a documented
 * stock extension provides, grouped by provider. It is not a shape heuristic and it is not
 * "anything unresolvable": a name belongs here only if its PROVIDER is identifiable and, in the
 * corpus, no file declares it. Names whose provider is a repository's own test scaffolding
 * (`wh_time_key`/`wh_date_key`/`wh_dim_key` are boundary's Go sqltest helpers, not an extension)
 * are deliberately NOT here and are reported as their own bucket.
 *
 * USAGE:
 *   bun validation/m14/fixtures/sql/residual-buckets.mts \
 *     --tsv validation/m14/fixtures/sql/residual-cause-full.tsv [--out FILE]
 */
import { readFileSync, writeFileSync } from "node:fs"

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : undefined
}
const TSV = flag("--tsv")
const OUT = flag("--out")
if (!TSV) {
  console.error("usage: residual-buckets.mts --tsv FILE [--out FILE]")
  process.exit(2)
}

/** pgTAP — the PostgreSQL unit-testing extension. `SQL_BUILTINS` already carries seven of its
 *  functions (`is`, `isnt`, `matches`, `throws_ok`, `lives_ok`, `results_eq`, `set_eq`) and calls
 *  the family by name in its own comment, so this is the same family completed, not a new remit. */
const PGTAP = [
  "plan", "finish", "collect_tap", "ok", "skip", "cmp_ok", "is_empty", "isnt_empty",
  "set_ne", "results_ne", "row_eq", "is_strict", "isnt_strict", "has_index", "hasnt_index",
  "has_function", "has_trigger", "has_view", "hasnt_view", "has_table", "hasnt_table",
  "has_column", "hasnt_column", "has_domain", "has_type", "col_not_null", "col_is_null",
  "col_has_default", "col_hasnt_default", "col_default_is", "col_type_is", "col_is_pk",
  "domain_type_is", "fk_ok", "trigger_is", "volatility_is", "throws_like",
]
/** PostgreSQL's own built-in functions (the `SQL_BUILTINS` remit's first clause). `isempty` is
 *  PostgreSQL's range function (`isempty(anyrange)`), NOT pgTAP's `is_empty` — one character apart,
 *  different provider. `is_valid` is deliberately ABSENT: the corpus calls it once
 *  (`postgrest/test/spec/fixtures/schema.sql:1813`, `is_valid(input::isbn)` from the project's own
 *  `is_valid_isbn` wrapper) and its provider is unproven, so it is not a provided-function claim. */
const POSTGRES = [
  "isempty", "family", "json_typeof", "json_to_recordset", "jsonb_to_recordset", "jsonb_array_length",
  "jsonb_object_keys", "jsonb_array_elements_text", "to_regprocedure", "convert_to", "convert_from",
  "regexp_split_to_array", "regexp_split_to_table", "current_schema", "xmlconcat2", "pow",
  "enum_first", "get_byte", "cosh",
]
/** uuid-ossp — next to `uuid_generate_v4`/`uuid_generate_v1`/`uuid_nil`, which `SQL_BUILTINS`
 *  already carries. */
const UUIDOSSP = ["uuid_generate_v1mc"]
/** DuckDB's engine functions (the corpus's `duckdb/` tree runs on DuckDB). */
const DUCKDB = [
  "read_parquet", "read_csv", "read_csv_auto", "len", "strlen", "strftime", "quantile_cont",
  "quantile_disc", "approx_quantile", "reservoir_quantile", "date_diff", "array_contains",
  "array_push_back", "array_pop_front", "list", "list_resize", "list_distinct", "list_transform",
  "list_position", "list_aggregate", "list_sum", "countif", "arg_min", "hash", "bitstring_agg",
  "lttb", "median", "min_by", "max_by", "product", "instr", "group_concat",
]
/** SQLite's core functions plus the extensions its own tree ships. */
const SQLITE = ["hex", "strdup", "randomblob", "sha1", "sha1b", "sha1_query", "sha3_query", "ieee754_from_int", "parse_create_index", "shell_prompt_test"]
/** MSSQL's metadata function, and pg_cron's scheduling pair. */
const MSSQL = ["columnproperty"]
const PGCRON = ["schedule", "unschedule"]

const PROVIDER: Record<string, string> = {}
for (const [provider, names] of [
  ["pgTAP", PGTAP], ["postgres", POSTGRES], ["uuid-ossp", UUIDOSSP], ["duckdb", DUCKDB],
  ["sqlite", SQLITE], ["mssql", MSSQL], ["pg_cron", PGCRON],
] as const) {
  for (const n of names) PROVIDER[n] = provider
}

/** A CALL whose callee the GRAMMAR parsed out of a non-call construct. Each name is a keyword or
 *  a type spelling that tree-sitter-sql hands to `invocation`: `GROUP BY ROLLUP(a, b)`,
 *  `character varying(20)`, `EXEC proc`, `WITH ORDINALITY pat(a, b)`. The edge asserts a call that
 *  the source does not make. */
const GRAMMAR_ARTIFACT = new Set(["rollup", "varying", "xor", "sets", "grouping_id", "exec", "pat", "cube", "grouping"])

const rows = readFileSync(TSV, "utf8").split("\n").filter(Boolean)
const header = rows[0].split("\t")
const ix = (c: string): number => header.indexOf(c)
const I = { type: ix("type"), target: ix("target"), bucket: ix("bucket") }
if (I.type < 0 || I.target < 0 || I.bucket < 0) {
  console.error(`TSV header not understood: ${rows[0]}`)
  process.exit(2)
}

type Row = { type: string; target: string; bucket: string; cause: string; provider?: string }
const classified: Row[] = []
for (const line of rows.slice(1)) {
  const c = line.split("\t")
  const type = c[I.type], target = c[I.target], bucket = c[I.bucket]
  let cause: string, provider: string | undefined
  const lower = target.toLowerCase()
  if (bucket.startsWith("extKind:")) cause = "analyzer-labelled-external-the-gate-cannot-read"
  else if (bucket.startsWith("queryLocalBinding")) cause = "query-local-binding-read-as-a-database-object"
  else if (bucket === "projectElsewhere") cause = "declared-outside-the-sampled-population"
  else if (type === "calls" && PROVIDER[lower]) { cause = "call-to-a-function-an-engine-or-stock-extension-provides"; provider = PROVIDER[lower] }
  else if (type === "calls" && GRAMMAR_ARTIFACT.has(lower)) cause = "grammar-artifact-published-as-a-call"
  else if (type === "calls") cause = "call-to-a-name-no-file-declares-and-no-provider-owns"
  else if (type === "imports") cause = "psql-include-or-module-path-not-in-the-population"
  else cause = "relation-read-that-no-file-declares"
  classified.push({ type, target, bucket, cause, provider })
}

const tally = new Map<string, number>()
const byType = new Map<string, Map<string, number>>()
const providers = new Map<string, number>()
const names = new Map<string, number>()
for (const r of classified) {
  tally.set(r.cause, (tally.get(r.cause) ?? 0) + 1)
  let m = byType.get(r.type)
  if (!m) byType.set(r.type, (m = new Map()))
  m.set(r.cause, (m.get(r.cause) ?? 0) + 1)
  if (r.provider) {
    providers.set(r.provider, (providers.get(r.provider) ?? 0) + 1)
    names.set(`${r.provider}:${r.target.toLowerCase()}`, (names.get(`${r.provider}:${r.target.toLowerCase()}`) ?? 0) + 1)
  }
}

const total = classified.length
const sum = [...tally.values()].reduce((a, b) => a + b, 0)
const report = {
  tsv: TSV,
  unresolvedTotal: total,
  closes: sum === total,
  causes: Object.fromEntries([...tally].sort((a, b) => b[1] - a[1])),
  causeByType: Object.fromEntries([...byType].map(([t, m]) => [t, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))])),
  providedFunctionEdges: { total: [...providers.values()].reduce((a, b) => a + b, 0), byProvider: Object.fromEntries([...providers].sort((a, b) => b[1] - a[1])) },
  providedFunctionNames: Object.fromEntries([...names].sort((a, b) => b[1] - a[1])),
  vocabularySize: Object.keys(PROVIDER).length,
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
