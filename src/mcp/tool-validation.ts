import type { ToolDescriptor, JsonSchemaProperty } from "./tool-registry"

/**
 * M50.A2 (#764): accepted parameter aliases.
 *
 * A1 measured agents failing on vocabulary, not on capability: bb_graph / bb_impact /
 * bb_cross_language take `symbol` while bb_analyze / bb_doc / bb_visualize take
 * `target`, so a model that learned one family's spelling gets an error
 * round-trip on the other (`unknown or irrelevant options: target` — recorded
 * verbatim in validation/m50/results/A1.json). The alias table removes that
 * round-trip without changing any canonical name, schema, or default: the
 * canonical spelling stays the documented one, the other family's spelling is
 * forgiven, and a request that supplies BOTH with different values is rejected
 * loudly instead of silently picking one.
 *
 * Aliases are resolved before the unknown-option and required checks, so an
 * alias satisfies a required field — and passing nothing still fails exactly as
 * before (the "missing symbol rejected" contract is unchanged).
 *
 * NOT the same concept as `ToolDescriptor.aliases`, which is about TOOL names
 * and is deliberately empty everywhere (M48 unification). This table is about
 * PARAMETER spelling inside one tool.
 */
// `query` is in the table on purpose: bb_search and bb_ask — the two tools an
// agent reaches for first — spell their subject `query`, so `query` is the
// single most likely wrong guess on every other tool (recorded verbatim: 
// "bb_cross_language: unknown or irrelevant options: query"). Tools that DO
// define `query` (bb_search, bb_ask) are absent from this table by design.
export const PARAMETER_ALIASES: Record<string, Record<string, string>> = {
  bb_graph: { target: "symbol", symbolName: "symbol", query: "symbol" },
  bb_impact: { target: "symbol", symbolName: "symbol", query: "symbol" },
  bb_cross_language: { target: "symbol", symbolName: "symbol", query: "symbol" },
  bb_annotate: { target: "symbol", query: "symbol" },
  bb_annotations: { target: "symbol", query: "symbol" },
  bb_analyze: { symbol: "target", symbolName: "target", query: "target" },
  bb_doc: { symbol: "target", symbolName: "target", query: "target" },
  bb_visualize: { symbol: "target", query: "target" },
}

/** Rewrite alias keys to their canonical names (exported for the M50 gate). */
export function resolveParameterAliases(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const map = PARAMETER_ALIASES[tool]
  if (!map) return args
  const out: Record<string, unknown> = { ...args }
  for (const [alias, canonical] of Object.entries(map)) {
    if (!(alias in out)) continue
    const aliasValue = out[alias]
    delete out[alias]
    // Blank aliases are treated as absent (not as a satisfies-required value):
    // `target: "   "` on bb_graph must fail exactly like no target at all.
    if (aliasValue === undefined || aliasValue === null || (typeof aliasValue === "string" && aliasValue.trim() === "")) continue
    const canonicalValue = out[canonical]
    if (canonicalValue === undefined || canonicalValue === null || canonicalValue === "") {
      out[canonical] = aliasValue
      continue
    }
    if (String(canonicalValue) !== String(aliasValue)) {
      throw new Error(
        `${tool}: ${canonical} and ${alias} are aliases with different values ("${canonicalValue}" vs "${aliasValue}") — pass one`,
      )
    }
  }
  return out
}

export function validateToolArguments(descriptor: ToolDescriptor, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`${descriptor.name}: arguments must be a JSON object`)
  const object = resolveParameterAliases(descriptor.name, args as Record<string, unknown>)
  const properties = descriptor.inputSchema.properties ?? {}
  const unknown = Object.keys(object).filter((key) => !(key in properties))
  if (unknown.length) {
    // M50.A2 (#764): a rejection must TEACH, not dead-end. A1 recorded agents
    // burning a round-trip per wrong guess and then giving up on the tool;
    // naming the accepted options (plus the aliases this tool forgives) turns
    // the failure into the next correct call. The rejection itself is
    // unchanged — an unknown option is still an error, never ignored.
    const aliases = Object.keys(PARAMETER_ALIASES[descriptor.name] ?? {})
    const accepted = Object.keys(properties)
    throw new Error(
      `${descriptor.name}: unknown or irrelevant options: ${unknown.join(", ")} — accepted options: ${accepted.join(", ")}` +
        (aliases.length ? ` (aliases accepted: ${aliases.join(", ")})` : ""),
    )
  }
  for (const required of descriptor.inputSchema.required ?? []) {
    if (!(required in object) || object[required] === undefined || object[required] === null) throw new Error(`${descriptor.name}: missing required option: ${required}`)
  }
  for (const [name, value] of Object.entries(object)) validateProperty(descriptor.name, name, value, properties[name]!)
  validateModeSpecificArguments(descriptor.name, object)
  return object
}

/**
 * Options each bb_search mode can actually honor.
 *
 * `bb_search` is the only mode-discriminated tool in the registry that accepted
 * an option it never read: 33 of 48 mode×option cells validated cleanly and
 * then did nothing. `mode:"symbols"` with `filePath` returned matches from the
 * whole project; `mode:"content"` with `regex:true` ran a literal substring
 * search for the pattern TEXT; `mode:"symbol"` ignored `limit` entirely. A
 * filter the caller believes is scoping results, and which does not, is worse
 * than a rejection — the caller has evidence the option was accepted.
 *
 * So an option that is known to the schema but irrelevant to the chosen mode is
 * rejected here, by the same rule bb_edit already uses, with the accepted set
 * named so the rejection teaches the next correct call.
 */
const SEARCH_OPTIONS_BY_MODE: Record<string, readonly string[]> = {
  symbols: ["mode", "query", "limit", "offset", "language", "symbolKind", "includeContent", "exact", "caseSensitive", "regex", "refresh"],
  content: ["mode", "query", "limit", "offset", "language", "symbolKind", "refresh"],
  symbol: ["mode", "query", "symbolName", "filePath", "refresh"],
  file: ["mode", "filePath"],
}

/**
 * Page-size parameters that are also "how much work do I do" parameters must
 * not accept 0.
 *
 * M64.H2: `bb_health sampleSize` accepted 0 (the generic rule only rejects
 * negatives), and the provider then ran `Math.max(1, sampleSize)` — so
 * `bb_health({sampleSize: 0})` answered `freshness: 1 fresh / 0 stale / 0
 * missing (1/8, sampled)`. The caller asked to check no files and was told one
 * file was checked and clean. This is the rule bb_analyze's `limit: 0` already
 * follows for the same reason — "an empty page is indistinguishable from a real
 * answer" — and a 0 that silently becomes a 1 is the same confusion wearing a
 * different hat. Refused with the rule named, not clamped.
 */
function validateModeSpecificArguments(tool: string, args: Record<string, unknown>): void {
  if (tool === "bb_health" && args.sampleSize !== undefined) {
    const n = Number(args.sampleSize)
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("bb_health sampleSize must be a whole number >= 1 — 0 would mean checking no files, which this tool reports as a clean result; use freshness=\"complete\" to check every indexed file")
    }
  }
  if (tool === "bb_search") {
    const mode = String(args.mode ?? "symbols")
    const accepted = SEARCH_OPTIONS_BY_MODE[mode]
    if (accepted) {
      const irrelevant = Object.keys(args).filter((key) => !accepted.includes(key))
      if (irrelevant.length > 0) {
        throw new Error(`bb_search ${mode} mode does not accept: ${irrelevant.join(", ")} — accepted for ${mode}: ${accepted.join(", ")}`)
      }
    }
    if (mode === "file") {
      if (typeof args.filePath !== "string" || args.filePath.trim().length === 0) {
        throw new Error("bb_search file mode requires filePath")
      }
      return
    }
    if (mode === "symbol") {
      const name = typeof args.symbolName === "string" ? args.symbolName : ""
      const query = typeof args.query === "string" ? args.query : ""
      const hasName = name.trim().length > 0
      const hasQuery = query.trim().length > 0
      if (!hasName && !hasQuery) throw new Error("bb_search symbol mode requires a non-empty symbolName or query")
      if (typeof args.symbolName === "string" && !hasName) {
        // A supplied-but-blank symbolName used to fall through the `??` at the
        // call site and answer with `""` — an empty, freshness-annotated
        // SUCCESS for a symbol that exists. Rejecting the blank is the honest
        // outcome; the caller's `query` is still usable, so the message says so.
        throw new Error(
          hasQuery
            ? `bb_search: symbolName must not be blank when query is given — drop symbolName, or pass a non-empty one`
            : "bb_search: symbolName must not be blank",
        )
      }
      if (hasName && hasQuery && name.trim() !== query.trim()) {
        // `??` at the call site made symbolName silently win, so the caller's
        // query was never looked up and the answer was an empty success.
        throw new Error(`bb_search: symbolName ("${name.trim()}") and query ("${query.trim()}") disagree — pass one`)
      }
      return
    }
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      throw new Error(`bb_search ${mode} mode requires a non-empty query`)
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

/**
 * Page-size parameters must be whole numbers.
 *
 * A fractional `limit` reached SQLite as a float bound and surfaced as a raw
 * `datatype mismatch` from the driver, because `slice()` truncates a fractional
 * page silently while the SQL bound does not accept one at all. Rejecting the
 * value at the boundary names the rule instead of leaking a driver message.
 */
const INTEGER_PARAMETERS = new Set([
  "limit", "offset", "sampleSize", "maxFiles", "maxNodes", "maxLinks", "maxTokens", "lineStart", "edgeLimit",
])

function validateProperty(tool: string, name: string, value: unknown, schema: JsonSchemaProperty): void {
  if (value === null) throw new Error(`${tool}: ${name} must not be null`)
  const valid = schema.type === "string" ? typeof value === "string"
    : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : schema.type === "boolean" ? typeof value === "boolean"
    : schema.type === "array" ? Array.isArray(value) && (!schema.items || value.every((item) => item !== null && typeof item === schema.items!.type))
    : typeof value === "object" && !Array.isArray(value)
  if (!valid) throw new Error(`${tool}: ${name} must be ${schema.type}`)
  if (schema.enum && !schema.enum.includes(value as string)) throw new Error(`${tool}: ${name} must be one of: ${schema.enum.join(", ")}`)
  if (schema.type === "number") {
    if (INTEGER_PARAMETERS.has(name) && !Number.isInteger(value)) {
      throw new Error(`${tool}: ${name} must be a whole number (got ${String(value)})`)
    }
    if (INTEGER_PARAMETERS.has(name) && (value as number) < 0) throw new Error(`${tool}: ${name} must be non-negative`)
  }
  if (name === "confidenceThreshold" && ((value as number) < 0 || (value as number) > 1)) throw new Error(`${tool}: confidenceThreshold must be between 0 and 1`)
}
