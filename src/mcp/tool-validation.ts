import type { ToolDescriptor, JsonSchemaProperty } from "./tool-registry"

export function validateToolArguments(descriptor: ToolDescriptor, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`${descriptor.name}: arguments must be a JSON object`)
  const object = args as Record<string, unknown>
  const properties = descriptor.inputSchema.properties ?? {}
  const unknown = Object.keys(object).filter((key) => !(key in properties))
  if (unknown.length) throw new Error(`${descriptor.name}: unknown or irrelevant options: ${unknown.join(", ")}`)
  for (const required of descriptor.inputSchema.required ?? []) {
    if (!(required in object) || object[required] === undefined || object[required] === null) throw new Error(`${descriptor.name}: missing required option: ${required}`)
  }
  for (const [name, value] of Object.entries(object)) validateProperty(descriptor.name, name, value, properties[name]!)
  validateModeSpecificArguments(descriptor.name, object)
  return object
}

function validateModeSpecificArguments(tool: string, args: Record<string, unknown>): void {
  if (tool === "bb_search") {
    const mode = args.mode ?? "symbols"
    if (mode === "file") {
      if (typeof args.filePath !== "string" || args.filePath.trim().length === 0) {
        throw new Error("bb_search file mode requires filePath")
      }
      return
    }
    if (mode === "symbol") {
      if (typeof args.symbolName !== "string" && typeof args.query !== "string") {
        throw new Error("bb_search symbol mode requires symbolName or query")
      }
      if (typeof args.symbolName === "string" && args.symbolName.trim().length === 0 && typeof args.query !== "string") {
        throw new Error("bb_search symbol mode requires a non-empty symbolName or query")
      }
      return
    }
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      throw new Error(`bb_search ${String(mode)} mode requires a non-empty query`)
    }
  }
  if (tool === "bb_ask" && (typeof args.query !== "string" || args.query.trim().length === 0)) {
    throw new Error("bb_ask requires a non-empty query")
  }
  // M31.T1: scoped graphs require a target — the handler previously fell back
  // to a project graph for missing/blank targets, contradicting the documented
  // error "Missing target for a scoped graph" (docs/tools/bb_visualize.md).
  if (tool === "bb_visualize") {
    const scope = String(args.scope ?? "project")
    if (["file", "module", "symbol", "feature"].includes(scope) && (typeof args.target !== "string" || args.target.trim().length === 0)) {
      throw new Error(`bb_visualize ${scope} scope requires a non-empty target`)
    }
  }
  // M31.T1: confidenceThreshold is documented as valid 0..1; out-of-range values
  // were silently accepted and produced misleading findings.
  if (tool === "bb_patterns" && args.confidenceThreshold != null) {
    const c = Number(args.confidenceThreshold)
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new Error("bb_patterns confidenceThreshold must be between 0 and 1")
    }
  }
  if (tool === "bb_edit") {
    validateEditArguments(args)
  }
}

/**
 * bb_edit is discriminated by `mode`. Each mode has its own required fields and
 * its own set of relevant fields; a field that is known to the schema but
 * irrelevant to the current mode is rejected here (not silently ignored).
 * `mode` and `position` enum membership are already enforced by validateProperty
 * against the registry schema; this layer enforces the per-mode contract.
 */
function validateEditArguments(args: Record<string, unknown>): void {
  const mode = args.mode
  const relevantByMode: Record<string, readonly string[]> = {
    write: ["mode", "dryRun", "filePath", "content", "newContent", "format"],
    update: ["mode", "dryRun", "filePath", "symbolName", "lineStart", "content", "newContent", "format"],
    insert: ["mode", "dryRun", "filePath", "targetSymbolName", "position", "lineStart", "content", "newContent", "format"],
    delete: ["mode", "dryRun", "filePath", "symbolName", "lineStart", "force", "format"],
    refactor: ["mode", "dryRun", "filePath", "symbolName", "lineStart", "newName", "format"],
  }
  const allowed = relevantByMode[String(mode)]
  if (allowed) {
    const irrelevant = Object.keys(args).filter((key) => !allowed.includes(key))
    if (irrelevant.length > 0) throw new Error(`bb_edit ${String(mode)} mode does not accept: ${irrelevant.join(", ")}`)
  }

  if (mode === "write") {
    if (typeof args.filePath !== "string" || args.filePath.trim().length === 0) throw new Error("bb_edit write mode requires filePath")
    if (typeof args.content !== "string" && typeof args.newContent !== "string") throw new Error("bb_edit write mode requires content or newContent")
  } else if (mode === "update") {
    if (typeof args.symbolName !== "string" || args.symbolName.trim().length === 0) throw new Error("bb_edit update mode requires symbolName")
    if (typeof args.newContent !== "string" && typeof args.content !== "string") throw new Error("bb_edit update mode requires newContent or content")
  } else if (mode === "insert") {
    if (typeof args.targetSymbolName !== "string" || args.targetSymbolName.trim().length === 0) throw new Error("bb_edit insert mode requires targetSymbolName")
    if (typeof args.newContent !== "string" && typeof args.content !== "string") throw new Error("bb_edit insert mode requires newContent or content")
  } else if (mode === "delete") {
    if (typeof args.symbolName !== "string" || args.symbolName.trim().length === 0) throw new Error("bb_edit delete mode requires symbolName")
  } else if (mode === "refactor") {
    if (typeof args.symbolName !== "string" || args.symbolName.trim().length === 0) throw new Error("bb_edit refactor mode requires symbolName")
    if (typeof args.newName !== "string" || args.newName.trim().length === 0) throw new Error("bb_edit refactor mode requires newName")
  }
}

function validateProperty(tool: string, name: string, value: unknown, schema: JsonSchemaProperty): void {
  if (value === null) throw new Error(`${tool}: ${name} must not be null`)
  const valid = schema.type === "string" ? typeof value === "string"
    : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : schema.type === "boolean" ? typeof value === "boolean"
    : schema.type === "array" ? Array.isArray(value) && (!schema.items || value.every((item) => item !== null && typeof item === schema.items!.type))
    : typeof value === "object" && !Array.isArray(value)
  if (!valid) throw new Error(`${tool}: ${name} must be ${schema.type}`)
  if (schema.enum && !schema.enum.includes(value as string)) throw new Error(`${tool}: ${name} must be one of: ${schema.enum.join(", ")}`)
  if (schema.type === "number" && (name === "limit" || name === "offset" || name === "sampleSize" || name === "maxFiles" || name === "maxNodes" || name === "maxLinks" || name === "maxTokens" || name === "lineStart") && (value as number) < 0) throw new Error(`${tool}: ${name} must be non-negative`)
  if (name === "confidenceThreshold" && ((value as number) < 0 || (value as number) > 1)) throw new Error(`${tool}: confidenceThreshold must be between 0 and 1`)
}
