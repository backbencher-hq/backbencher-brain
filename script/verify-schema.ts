// verify-schema.ts — fresh-DB schema verification: run ensureSchema on a new
// temp DB and confirm every drizzle-declared table + index is created.
//   bun run script/verify-schema.ts   (or npx tsx script/verify-schema.ts)
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

const { BrainDatabase } = await import("../src/brain/database")
const { ensureSchema } = await import("../src/brain/schema-ddl")

// fresh DB
const root = mkdtempSync(path.join(tmpdir(), "bb-schema-verify-"))
const dbPath = path.join(root, "fresh.db")
const raw = BrainDatabase.openByPath(dbPath)

// run the DDL explicitly (ensureSchemaIfNew would do the same)
ensureSchema(raw)

// inspect what exists
const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((t: any) => t.name)
const indexes = (raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'brain_%'").all() as any[]).map((t: any) => t.name)

// drizzle-declared tables
const EXPECTED_TABLES = [
  "brain_file", "brain_symbol", "brain_relationship", "brain_import",
  "brain_taint_flow", "brain_query_cache",
  "brain_project_health", "brain_index_status", "brain_semantic_embedding",
  "brain_analysis_run", "brain_analysis_finding", "brain_analysis_occurrence",
]
for (const t of EXPECTED_TABLES) check(`table ${t}`, tables.includes(t))

// no dead git/pattern tables
check("no brain_git_cooccurrence table", !tables.includes("brain_git_cooccurrence"))
check("no brain_pattern table (dead: nothing wrote it; SR detection is live)", !tables.includes("brain_pattern"))

// drizzle-declared indexes (from brain.sql.ts)
const EXPECTED_INDEXES = [
  "brain_file_project_idx", "brain_file_path_idx", "brain_file_language_idx",
  "brain_file_hash_idx", "brain_file_proj_path_idx", "brain_file_proj_hash_idx",
  "brain_file_syntax_errors_idx",
  "brain_symbol_project_idx", "brain_symbol_file_idx", "brain_symbol_name_idx",
  "brain_symbol_type_idx", "brain_symbol_qualified_idx", "brain_symbol_owner_idx",
  "brain_sym_proj_file_idx", "brain_sym_proj_name_idx", "brain_sym_proj_type_idx",
  "brain_sym_proj_name_type_idx",
  "brain_rel_project_idx", "brain_rel_source_idx", "brain_rel_target_idx",
  "brain_rel_proj_target_idx", "brain_rel_type_idx", "brain_rel_confidence_idx",
  "brain_rel_cross_lang_idx", "brain_rel_cross_file_idx",
  "brain_rel_proj_source_idx", "brain_rel_proj_type_idx", "brain_rel_target_type_idx",
  "brain_import_project_idx", "brain_import_file_idx", "brain_import_path_idx",
  "brain_import_name_idx", "brain_import_external_idx",
  "brain_taint_project_idx", "brain_taint_source_idx", "brain_taint_sink_idx",
  "brain_taint_vuln_idx", "brain_taint_severity_idx",
  "brain_cache_project_idx", "brain_cache_query_type_idx", "brain_cache_hash_idx",
  "brain_embed_project_idx", "brain_embed_entity_idx", "brain_embed_type_idx",
  "brain_embed_model_idx", "brain_embed_hash_idx",
  "brain_analysis_finding_identity_idx", "brain_analysis_run_project_idx",
  "brain_analysis_run_kind_idx", "brain_analysis_run_started_idx",
  "brain_analysis_finding_project_idx", "brain_analysis_finding_state_idx",
  "brain_analysis_occurrence_finding_idx", "brain_analysis_occurrence_run_idx",
]
const missing = EXPECTED_INDEXES.filter((i) => !indexes.includes(i))
check("all drizzle indexes created", missing.length === 0, `missing: ${missing.join(", ")}`)

raw.close()
rmSync(root, { recursive: true, force: true })
console.log(failures === 0 ? "\nSCHEMA VERIFY: ALL PASS" : `\nSCHEMA VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
