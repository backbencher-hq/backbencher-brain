// Drizzle ORM table definitions — matches backbencher's brain.sql.ts
// Each column is a proxy that returns { _colName, _tableName } for eq()/like()/etc.

function col(tableName: string, colName: string) {
  return new Proxy({} as any, {
    get(_target, prop) {
      if (prop === "_colName") return colName
      if (prop === "_tableName") return tableName
      return col(`${tableName}.${colName}`, prop as string)
    }
  })
}

function table(name: string): any {
  const cols: Record<string, any> = {}
  const known = [
    "id", "project_id", "path", "relative_path", "file_hash",
    "size_bytes", "line_count", "language", "framework", "framework_type",
    "layer", "system", "content", "is_test", "is_test_file", "is_config",
    "is_documentation", "has_syntax_errors", "error_report", "last_modified",
    "indexed_at", "time_created", "time_updated",
    // brain_symbol
    "file_id", "name", "qualified_name", "symbol_type", "line_start", "line_end",
    "byte_start", "byte_end", "signature", "return_type", "parameters", "docstring",
    "body_preview", "body_hash", "visibility", "is_async", "is_static", "is_abstract",
    "is_override", "is_getter", "is_setter", "complexity", "owner_symbol_id",
    "scope_kind", "annotations", "generic_parameters", "throws", "qualified_calls",
    "gravity_score", "api_contract_path",
    // brain_relationship
    "source_symbol_id", "target_symbol_id", "target_external", "source_external",
    "relationship_type", "confidence", "context", "line_number", "is_cross_file",
    "is_cross_language", "bridge_mechanism", "call_frequency",
    "is_breaking_change_risk", "metadata",
    // brain_import
    "imported_name", "import_path", "import_type", "is_external", "line_number",
    // brain_taint_flow
    "source_type", "sink_type", "vulnerability_type", "severity", "flow_path",
    "is_mitigated", "cross_language_boundaries",
  ]

  for (const c of known) {
    Object.defineProperty(cols, c, {
      get() { return { _colName: `${name}.${c}`, _tableName: name } },
      enumerable: true,
      configurable: true,
    })
  }

  return new Proxy(cols, {
    get(target, prop) {
      if (prop === "_tableName") return name
      if (typeof prop === "string" && prop in target) return (target as any)[prop]
      return { _colName: `${name}.${String(prop)}`, _tableName: name }
    }
  })
}

export const BrainFileTable = table("brain_file")
export const BrainSymbolTable = table("brain_symbol")
export const BrainRelationshipTable = table("brain_relationship")
export const BrainImportTable = table("brain_import")
export const BrainTaintFlowTable = table("brain_taint_flow")
export const BrainProjectHealthTable = table("brain_project_health")
