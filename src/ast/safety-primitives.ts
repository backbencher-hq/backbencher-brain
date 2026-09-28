// safety-primitives.ts — M13.04 (B4): shared safety primitives for the edit
// tool and any read path that must distinguish live code from comments/strings.
//
// Why this exists: the edit engine previously used a hand-rolled, JS/C-only
// character scanner (codeMask) and a raw-text substring scan (identifierOffsets)
// to decide what to rename. That is text substitution, not AST identity. These
// primitives replace both with tree-sitter-derived structures:
//
//   1. extractIdentifierOccurrences — identity-tagged reference sites (each
//      carries its grammar node type, parent type, and exact byte range), never
//      a raw-text substring match.
//   2. buildSyntaxMask / collectMaskedRanges — per-language comment/string
//      masking derived from the grammar's own comment/string nodes, with
//      interpolation code (${...}, #{...}, f-strings, $var) correctly re-exposed
//      as live code.
//   3. assertFreshFiles / assertFreshSymbols — freshness assertions reusable on
//      every symbol/relationship/file read path (not just the target symbol).
//
// No regex is used to classify code vs comment/string: the tree-sitter grammar
// is the sole source of truth. The only regex in this file is inside
// ASTEngine.parseTree's C/C++ compiler-extension normalization, which is shared
// with parseFile so byte offsets always agree.

import { ASTEngine } from "./engine"
import { checkFileFreshness, checkSymbolFreshness } from "../brain/freshness"

// ============================================================================
// TYPES
// ============================================================================

/** A single identifier-like reference site extracted from the syntax tree. */
export interface IdentifierOccurrence {
  /** The exact source text of this occurrence (unchanged bytes). */
  text: string
  /** Byte offsets into the original file content (0-indexed, [start, end)). */
  startIndex: number
  endIndex: number
  /** Grammar node type: "identifier", "type_identifier", "field_identifier", … */
  nodeType: string
  /** Parent node type: "call_expression", "variable_declarator", … */
  parentType: string
  /** True when this occurrence is the member name of a dotted access or a
   *  property key (obj.name / obj.name() / { name }), not a standalone
   *  reference. Rename engines must never treat these as reference sites. */
  isMemberName: boolean
  /** The tree-sitter field this occurrence fills in its parent node
   *  ("name", "value", "left", "right", "object", "key", …) or null when it
   *  fills no named field. Lets classification distinguish `x = <ref>` (right
   *  side is a use) from `x = <binding>` (left side binds) without text scans. */
  parentField: string | null
  /** 1-indexed line/column (column is 1-indexed to match tree-sitter display). */
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** A byte range that is comment/string literal (masked) or re-exposed code. */
export interface MaskedRange {
  startIndex: number
  endIndex: number
  kind: "comment" | "string"
  nodeType: string
}

export interface BodyRange {
  startIndex: number
  endIndex: number
  nodeType: string
}

export interface SafetyParse {
  language: string
  content: string
  /** Byte mask: 1 = live code, 0 = comment/string-literal byte. */
  mask: Uint8Array
  /** Identifier-like reference sites (AST identity, not text scan). */
  occurrences: IdentifierOccurrence[]
  /** Comment + string-literal ranges (what buildSyntaxMask masks out). */
  maskedRanges: MaskedRange[]
  /** Code ranges re-exposed inside strings (interpolation), kept live. */
  codeRanges: MaskedRange[]
  /** Byte ranges of body blocks ({ }, indented block, do/end) in source order. */
  bodyRanges: BodyRange[]
}

export interface StaleEntry {
  fileId: string
  path: string
  status: "stale" | "missing"
}

// ============================================================================
// NODE-TYPE CLASSIFICATION
// ============================================================================

/** Identifier-like container nodes that wrap sub-identifiers (not leaf sites). */
const NON_LEAF_IDENTIFIER_TYPES = new Set([
  "scoped_identifier",
  "scoped_type_identifier",
  "qualified_identifier",
  "aliased_identifier",
  "qualified_name",
])

/** Reference sites that do not use an "*identifier" node type in their grammar. */
const EXTRA_REFERENCE_TYPES = new Set([
  "variable_name", // PHP $var, Bash $var
  "simple_variable", // PowerShell $var
  "variable", // Haskell function/pattern var, PowerShell $var (named node)
  "constructor", // Haskell data constructor
  "type", // Haskell type name (named node; anonymous `type` keywords are excluded by isNamed)
  "module", // Haskell module name (named node)
  "constant", // Ruby CONST
])

/** True when a node type is an identifier-like reference site. */
export function isIdentifierNodeType(type: string): boolean {
  if (!type || NON_LEAF_IDENTIFIER_TYPES.has(type)) return false
  return type === "identifier" || type.endsWith("identifier") || EXTRA_REFERENCE_TYPES.has(type)
}

/** True when a node type is a comment in any shipped grammar. */
export function isCommentNodeType(type: string): boolean {
  const t = type.toLowerCase()
  return (
    t === "comment" ||
    t.endsWith("comment") || // line_comment, block_comment, doc_comment, container_doc_comment, documentation_comment
    t === "shebang" ||
    t === "haddock" || // Haskell doc comments
    t === "marginalia" // SQL /* ... */ block comments (tree-sitter-sql)
  )
}

/** True when a node type is a string literal in any shipped grammar. */
export function isStringNodeType(type: string): boolean {
  const t = type.toLowerCase()
  return (
    t.includes("string") || // string, string_content, string_fragment, string_literal, raw_string, template_string, string_value, string_scalar, interpolated_string, here_string, triple_quoted_string, verbatim_string_literal, multiline_string_literal, string_start/end, line_string_literal, …
    t.includes("heredoc") || // heredoc, heredoc_body, heredoc_beginning, heredoc_end, heredoc_template
    t === "charlist" || // Elixir '...'
    t === "str_lit" || // Clojure "..."
    t === "char_lit" || // Clojure \a character literal
    t === "literal" || // SQL string/numeric literal; Haskell literal container (string/integer/char — all non-reference bytes)
    t === "double_quote_scalar" || // YAML "..."
    t === "single_quote_scalar" || // YAML '...'
    t.startsWith("block_scalar") // YAML | / > multiline scalars
  )
}

/** Grammar node types that are inherently member/property identifiers (the
 *  field/property/method name in a dotted access or object literal — never a
 *  standalone reference to the renamed symbol). */
export const MEMBER_NODE_TYPES = new Set([
  "property_identifier",
  "field_identifier",
  "shorthand_property_identifier",
  "statement_identifier",
  "label_name",
])

/** Field names that hold the receiver/access of a dotted access. */
const MEMBER_ACCESS_OBJECT_FIELDS = ["object", "receiver"]
/** Field names that hold the member/name/field/property of a dotted access. */
const MEMBER_ACCESS_NAME_FIELDS = ["name", "property", "field", "attribute", "member"]

/** Field names scanned to tag each occurrence with its parent-field role.
 *  Positional identity (same byte range as the field's child) is checked, so
 *  this is AST structure, never text. */
const PARENT_FIELD_CANDIDATES = [
  "name", "value", "left", "right", "key", "target", "pattern", "object",
  "receiver", "property", "field", "attribute", "member", "alias", "operator",
  "type", "body", "expression", "arguments", "initializer", "declarator",
]

/** Which field of the parent this occurrence fills (byte-identity match). */
export function parentFieldOf(node: any): string | null {
  const parent = node?.parent
  if (!parent || typeof parent.childForFieldName !== "function") return null
  for (const f of PARENT_FIELD_CANDIDATES) {
    const child = parent.childForFieldName(f)
    if (child && child.startIndex === node.startIndex && child.endIndex === node.endIndex) return f
  }
  return null
}

/**
 * True when a leaf identifier node is the member name of a dotted access
 * (`obj.name`, `obj.name()`, `self.name`) or an object-literal property key —
 * never a standalone reference to a symbol of the same name. Uses grammar node
 * types plus tree-sitter field names (object/receiver vs name/field), not text.
 */
export function isMemberNameNode(node: any): boolean {
  if (MEMBER_NODE_TYPES.has(node.type)) return true
  const parent = node.parent
  if (!parent) return false
  const objNode = MEMBER_ACCESS_OBJECT_FIELDS
    .map((f) => (typeof parent.childForFieldName === "function" ? parent.childForFieldName(f) : null))
    .find((n) => n != null)
  if (!objNode) return false
  // The receiver itself is not a member name (renaming `obj` must rename `obj.name`).
  if (objNode.startIndex === node.startIndex && objNode.endIndex === node.endIndex) return false
  // This node must be the access's name/field/property (not an argument or subexpr).
  const isName = MEMBER_ACCESS_NAME_FIELDS
    .map((f) => (typeof parent.childForFieldName === "function" ? parent.childForFieldName(f) : null))
    .some((n) => n != null && n.startIndex === node.startIndex && n.endIndex === node.endIndex)
  return isName
}

/**
 * True when a node type is a function/type BODY container across grammars:
 * brace bodies ({ }), indented blocks (Python), and keyword-terminated bodies
 * (Ruby body_statement, Elixir do_block, Lua block … end). Used by bb_edit
 * inside-top/inside-bottom to find the insertion region without a { } scan.
 */
export function isBodyNodeType(type: string): boolean {
  const t = type.toLowerCase()
  return (
    t.endsWith("body") || // function_body, class_body, interface_body, enum_body, method_body, constructor_body, accessor_body, object_body, impl_body, script_block_body, enum_class_body
    t === "block" || // Rust, Go, Java, C#, Python, Lua, Dart
    t === "compound_statement" || // C/C++, Bash
    t === "statement_block" || // TypeScript/JavaScript
    t === "body_statement" || // Ruby
    t === "do_block" || // Elixir
    t === "script_block" || // PowerShell
    t === "declaration_list" || // C# class/interface/enum body
    t === "field_declaration_list" || // Rust struct / Go struct body
    t === "enum_variant_list" // Rust enum body
  )
}

/**
 * Node types that carry live code INSIDE a string literal and must be
 * re-exposed as code when masking (interpolation/substitution/expansion).
 */
const INTERPOLATION_NODE_TYPES = new Set([
  "template_substitution", // JS/TS `${...}`
  "interpolation", // Ruby #{...}, Python f-string {...}
  "interpolation_expression", // Swift \(...)
  "string_interpolation", // Scala s"...${...}", Dart $expr / ${expr}
  "expansion", // Bash $var / $(...) / ${...}
  "simple_expansion", // Bash $var
  "command_substitution", // Bash $(...)
  "arithmetic_expansion", // Bash $((...))
  "process_substitution", // Bash <(...)
  "subshell", // Bash (...)
  "variable_name", // PHP $var / Bash $var (live code reference)
  "interpolated_expression", // PHP {$var}
])

// ============================================================================
// AST WALKING
// ============================================================================

/** Iterative DFS over all nodes (children array includes named + anonymous). */
function walkNodes(rootNode: any): Generator<any> {
  const stack: any[] = [rootNode]
  return (function* () {
    while (stack.length > 0) {
      const node = stack.pop()
      yield node
      const children = node.children
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
    }
  })()
}

// ============================================================================
// COMMENT/STRING MASKING
// ============================================================================

/**
 * Collect the ranges to mask (comment + string literals) and the ranges to
 * re-expose (interpolation code nested inside those strings). Derived entirely
 * from tree-sitter node types — no character scanning.
 */
export function collectMaskedRanges(tree: any): { masked: MaskedRange[]; code: MaskedRange[] } {
  const masked: MaskedRange[] = []
  const code: MaskedRange[] = []
  for (const node of walkNodes(tree.rootNode)) {
    const type = node.type
    if (isCommentNodeType(type)) {
      masked.push({ startIndex: node.startIndex, endIndex: node.endIndex, kind: "comment", nodeType: type })
      continue // comments are opaque — no nested code
    }
    if (isStringNodeType(type)) {
      masked.push({ startIndex: node.startIndex, endIndex: node.endIndex, kind: "string", nodeType: type })
    }
    if (INTERPOLATION_NODE_TYPES.has(type)) {
      code.push({ startIndex: node.startIndex, endIndex: node.endIndex, kind: "string", nodeType: type })
    }
  }
  return { masked, code }
}

/** Paint masked ranges to 0, then re-expose code ranges to 1. */
export function buildMaskFromRanges(
  masked: MaskedRange[],
  code: MaskedRange[],
  contentLength: number,
): Uint8Array {
  const len = Math.max(0, contentLength)
  const mask = new Uint8Array(len)
  mask.fill(1)
  for (const r of masked) {
    const end = Math.min(r.endIndex, len)
    for (let i = r.startIndex; i < end; i++) mask[i] = 0
  }
  for (const r of code) {
    const end = Math.min(r.endIndex, len)
    for (let i = r.startIndex; i < end; i++) mask[i] = 1
  }
  return mask
}

/** Convenience: build a per-language comment/string mask from a parsed tree. */
export function buildSyntaxMask(tree: any, contentLength: number): Uint8Array {
  const { masked, code } = collectMaskedRanges(tree)
  return buildMaskFromRanges(masked, code, contentLength)
}

/** Collect every body-block byte range (see isBodyNodeType) in source order. */
export function collectBodyRanges(tree: any): BodyRange[] {
  const out: BodyRange[] = []
  for (const node of walkNodes(tree.rootNode)) {
    if (!node.isNamed) continue
    if (!isBodyNodeType(node.type)) continue
    out.push({ startIndex: node.startIndex, endIndex: node.endIndex, nodeType: node.type })
  }
  return out
}

/** True when the byte at `index` is live code (not inside a comment/string). */
export function isCodeAt(mask: Uint8Array, index: number): boolean {
  return index < 0 || index >= mask.length || mask[index] === 1
}

// ============================================================================
// REFERENCE-OCCURRENCE EXTRACTION
// ============================================================================

/**
 * Extract identifier-like reference sites from the syntax tree. Each site is an
 * actual grammar node (leaf identifier) with its exact byte range and node type
 * — never a raw-text substring match. Comments are skipped entirely, and string
 * literal content is not an identifier node, so neither produces a site. Code
 * inside interpolation (${...}, #{...}, f-strings) IS parsed as real identifier
 * nodes and is correctly included.
 */
export function extractIdentifierOccurrences(tree: any, content: string): IdentifierOccurrence[] {
  const out: IdentifierOccurrence[] = []
  for (const node of walkNodes(tree.rootNode)) {
    const type = node.type
    if (isCommentNodeType(type)) continue // opaque — never a reference site
    if (!node.isNamed) continue // anonymous tokens (keywords/operators) are never reference sites
    if (!isIdentifierNodeType(type)) continue
    if (node.namedChildCount !== 0) continue // container (scoped/qualified) — descend, not a site
    const text = content.substring(node.startIndex, node.endIndex)
    if (text.length === 0) continue
    out.push({
      text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      nodeType: type,
      parentType: node.parent ? node.parent.type : "",
      isMemberName: isMemberNameNode(node),
      parentField: parentFieldOf(node),
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
    })
  }
  return out
}

/** Filter occurrences to those matching `name` within a byte range [start, end). */
export function occurrencesMatching(
  occurrences: IdentifierOccurrence[],
  name: string,
  start = 0,
  end = Number.MAX_SAFE_INTEGER,
): IdentifierOccurrence[] {
  return occurrences.filter((o) => o.text === name && o.startIndex >= start && o.endIndex <= end)
}

// ============================================================================
// ONE-SHOT PARSE (tree is deleted before returning)
// ============================================================================

/**
 * Parse a file with tree-sitter (shared preprocessing with parseFile), build the
 * syntax mask and identifier occurrences, then delete the tree. The tree is
 * never exposed to the caller, so callers cannot leak WASM memory.
 */
export async function parseForSafety(filePath: string, content: string): Promise<SafetyParse> {
  const { language, tree, parser, transientLuaGrammar } = await ASTEngine.parseTree(filePath, content)
  try {
    const { masked, code } = collectMaskedRanges(tree)
    return {
      language,
      content,
      mask: buildMaskFromRanges(masked, code, content.length),
      occurrences: extractIdentifierOccurrences(tree, content),
      maskedRanges: masked,
      codeRanges: code,
      bodyRanges: collectBodyRanges(tree),
    }
  } finally {
    try {
      if (tree && typeof tree.delete === "function") tree.delete()
    } catch {}
    if (language === "lua") {
      try {
        if (parser && typeof parser.delete === "function") parser.delete()
      } catch {}
      try {
        if (transientLuaGrammar && typeof transientLuaGrammar.delete === "function") transientLuaGrammar.delete()
      } catch {}
    }
  }
}

// ============================================================================
// FRESHNESS ASSERTIONS (reusable on every read path)
// ============================================================================

/** Collect every fileId whose on-disk content no longer matches the index. */
export function collectStaleFiles(raw: any, fileIds: string[]): StaleEntry[] {
  const out: StaleEntry[] = []
  const seen = new Set<string>()
  for (const fileId of fileIds) {
    if (!fileId || seen.has(fileId)) continue
    seen.add(fileId)
    const f = checkFileFreshness(raw, fileId)
    if (f && f.status !== "fresh") out.push({ fileId, path: f.path, status: f.status })
  }
  return out
}

/** Throw if any file is stale/missing — never silently proceed on stale rows. */
export function assertFreshFiles(raw: any, fileIds: string[], context: string): void {
  const stale = collectStaleFiles(raw, fileIds)
  if (stale.length > 0) {
    const detail = stale.map((s) => `${s.path} (${s.status})`).join(", ")
    throw new Error(`${context}: ${stale.length} file(s) are not fresh — ${detail}`)
  }
}

/** Collect every symbolId whose backing file is stale/missing. */
export function collectStaleSymbols(raw: any, symbolIds: string[]): StaleEntry[] {
  const out: StaleEntry[] = []
  const seen = new Set<string>()
  for (const symbolId of symbolIds) {
    if (!symbolId || seen.has(symbolId)) continue
    seen.add(symbolId)
    const f = checkSymbolFreshness(raw, symbolId)
    if (f && f.status !== "fresh") out.push({ fileId: f.fileId, path: f.path, status: f.status })
  }
  return out
}

/** Throw if any symbol's backing file is stale/missing. */
export function assertFreshSymbols(raw: any, symbolIds: string[], context: string): void {
  const stale = collectStaleSymbols(raw, symbolIds)
  if (stale.length > 0) {
    const detail = stale.map((s) => `${s.path} (${s.status})`).join(", ")
    throw new Error(`${context}: ${stale.length} symbol file(s) are not fresh — ${detail}`)
  }
}
