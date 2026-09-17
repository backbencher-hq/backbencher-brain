import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BrainDatabase } from "../../brain/database"
import { checkSymbolFreshness, fileUnchangedSince } from "../../brain/freshness"
import { ASTEngine } from "../../ast/engine"
import { BrainSurgicalPatcher } from "../../ast/brain-surgical-patcher"
import { ImportPruner } from "../../ast/import-pruner"
import { reindexFilesParallel } from "../../ast/parallel-indexer"
import { parseForSafety, assertFreshFiles, type IdentifierOccurrence, type SafetyParse, type BodyRange } from "../../ast/safety-primitives"

export type EditMode = "write" | "update" | "insert" | "delete" | "refactor"
export type InsertPosition = "before" | "after" | "inside-top" | "inside-bottom"

export type EditRequest = {
  mode: EditMode
  dryRun?: boolean
  filePath?: string
  symbolName?: string
  lineStart?: number
  content?: string
  newContent?: string
  targetSymbolName?: string
  position?: InsertPosition
  newName?: string
  force?: boolean
  format?: boolean
  /** Legacy adapter compatibility only; never exposed by bb_edit. */
  allowStaleIndex?: boolean
}

export interface EditPlanChange { path: string; before: string; after: string }
export interface EditResult {
  mode: EditMode
  dryRun: boolean
  changes: EditPlanChange[]
  formatted: boolean
  validated: boolean
  reindexed: boolean
  /**
   * M40.A3: derived-data outcome of the post-edit reindex — pass used
   * (full/bounded/deferred), per-phase timings, repaired caller edges.
   * Visible in tool output so "queryable with resolved relationships" is a
   * claim the caller can verify, not a silent assumption.
   */
  derived?: { pass: string; phases: Array<{ name: string; ms: number; outcome: string }>; repairedInEdges: number; touchedSymbols: number }
  /** Human-owned audit trail: leftover references on forced delete, shadowed
   *  sites on refactor, stale-index surprises. Never silent — surfaced to CLI/MCP. */
  warnings?: string[]
  /** Refactor audit: how many files/sites were renamed on this run. */
  summary?: { renamedFiles: number; renamedSites: number }
}

type SymbolMatch = { id: string; fileId: string; byteStart: number; byteEnd: number; lineStart?: number; name: string }

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
}

function nearestExisting(candidate: string): string {
  let cursor = candidate
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return cursor
}

export function resolveSafeEditPath(projectPath: string, requested: string): string {
  const root = realpathSync(projectPath)
  const candidate = path.resolve(root, requested)
  if (!inside(root, candidate)) throw new Error(`path escapes project root: ${requested}`)
  const existing = nearestExisting(candidate)
  const realExisting = realpathSync(existing)
  if (!inside(root, realExisting)) throw new Error(`path escapes project root through symlink: ${requested}`)
  if (existsSync(candidate)) {
    const realCandidate = realpathSync(candidate)
    if (!inside(root, realCandidate)) throw new Error(`path escapes project root through symlink: ${requested}`)
    return realCandidate
  }
  return candidate
}

function replaceRange(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) throw new Error(`invalid edit bounds: ${start}-${end}`)
  return text.slice(0, start) + replacement + text.slice(end)
}

// ── M13.09 (E4): language-aware insert body detection ──────────────────────
// The body region comes from tree-sitter body nodes (block / compound_statement
// / statement_block / function_body / body_statement / do_block / …), never a
// raw `{ }` character scan, so brace, indented (Python), and keyword-terminated
// (Ruby/Lua) bodies all resolve. Unsupported bodies fail loud.

/** Find the symbol's body block: the outermost body node fully inside [start, end). */
function findSymbolBody(parsed: SafetyParse, start: number, end: number): BodyRange | null {
  const candidates = parsed.bodyRanges.filter((b) => b.startIndex >= start && b.endIndex <= end)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)
  return candidates[0]
}

/** The whitespace indentation prefix of the line that `pos` sits on. */
function lineIndent(text: string, pos: number): string {
  let lineStart = pos
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--
  return text.slice(lineStart, pos)
}

/** Prefix each line with `indent`; `includeFirst` controls the first line. */
function indentLines(text: string, indent: string, includeFirst: boolean): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 && !includeFirst) || line.length === 0 ? line : indent + line)
    .join("\n")
}

/** The leading whitespace of the LINE that `pos` sits on (not the full prefix). */
function lineLeadingWhitespace(text: string, pos: number): string {
  let lineStart = pos
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--
  let i = lineStart
  while (i < pos && (text[i] === " " || text[i] === "\t")) i++
  return text.slice(lineStart, i)
}

/** The file's indentation unit: tab, 4-space, or 2-space (default). */
function indentUnit(text: string): string {
  const lines = text.split("\n").slice(0, 200)
  let min = ""
  for (const line of lines) {
    const m = /^[\t ]+/.exec(line)
    if (!m) continue
    if (m[0].includes("\t") && !m[0].includes(" ")) return "\t"
    if (min === "" || m[0].length < min.length) min = m[0]
  }
  if (min.length >= 4) return "    "
  return "  "
}

/** Indentation of the first statement inside a body block (for brace bodies). */
function computeInnerIndent(text: string, body: BodyRange): string {
  const open = body.startIndex
  const end = body.endIndex
  let i = open + 1
  while (i < end && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++
  if (i >= end) return lineLeadingWhitespace(text, open) + indentUnit(text)
  // First statement shares the `{` line (no newline between): its indent is
  // ambiguous, so derive from the brace line's indent + one unit.
  if (!text.slice(open, i).includes("\n")) return lineLeadingWhitespace(text, open) + indentUnit(text)
  return lineLeadingWhitespace(text, i)
}

// ── M13.07 (E2): AST reference-identity rename ──────────────────────────────
// The refactor path must rename only actual reference sites, never unrelated
// same-name bindings, member accesses, or property keys. Classification is
// derived from tree-sitter node types (via parseForSafety), not raw-text scans.

/** Parent types that BIND/declare the identifier (const x, function f(), param,
 *  field, object key). Conservative: ambiguous reassignments are treated as
 *  bindings so a rename never over-reaches and corrupts source.
 *
 *  Cross-language: every shipped grammar names its declaration containers
 *  differently, so this is a deliberate union of those conventions (verified
 *  by script/m13/verify-edit-xlang.ts across all languages). */

/** Tree-sitter node types whose names contain substrings ("field") that would
 *  otherwise falsely match the includes("field") rule below, causing the
 *  RECEIVER in obj.field to be classified as a binding and silently skipped
 *  during rename. Checked FIRST, before any substring rule.
 *
 *  Only field_expression (Rust, C/C++, Scala, Zig) and field_access (Java)
 *  are affected. Other access-expression types (member_expression, attribute,
 *  selector_expression, navigation_expression) are already correctly filtered
 *  by isMemberNameNode returning true for the member name before
 *  isBindingParentType is even called on the receiver.
 *
 *  Verified per-type against actual substring rules; every entry here is
 *  confirmed to produce a false positive. No cosmetic entries. */
const FALSE_POSITIVE_BINDING_TYPES = new Set([
  "field_expression",  // Rust, C/C++, Scala, Zig — t.includes("field") matches
  "field_access",       // Java — t.includes("field") matches
])

export function isBindingParentType(type: string): boolean {
  const t = type.toLowerCase()
  // Access expressions are uses, never declaration bindings — checked
  // before substring rules so "field_expression" doesn't match includes("field").
  if (FALSE_POSITIVE_BINDING_TYPES.has(t)) return false
  return (
    t.includes("declarator") || // variable_declarator, function_declarator (C/C++)
    t.includes("declaration") || // function/class/method/variable/field_declaration
    t.includes("definition") || // function/class/method/field_definition
    t.includes("parameter") || // formal/required/typed/default parameter
    t.includes("field") || // field_declaration / field_definition / record_field
    t.includes("property") || // property_signature / property_declaration
    t.includes("signature") || // function_signature (Dart), method/property_signature (TS)
    t === "method" || // Ruby def name
    t === "class" || // Ruby class/module name (bare 'class' node)
    t === "bind" || // Haskell top-level binding (function/pattern)
    t.endsWith("_item") || // Rust function/struct/enum/trait/impl/mod/type/const/static_item
    t.endsWith("specifier") || // C/C++ class/struct/union/enum_specifier
    t.endsWith("_spec") || // Go type_spec / import_spec
    t === "type_name" || // F# type name container
    t === "assignment" || // Python `x = …`
    t === "pair" || // JS/TS object key { target: … }
    t.includes("import") || // import_specifier
    t === "catch_clause" || // catch (target)
    t.includes("for_in") || // for (target in …)
    t.includes("for_of") || // for (target of …)
    t.includes("shorthand") // shorthand_property_identifier / destructuring
  )
}

/** Assignment-like parents where the VALUE/right side is a use, not a binding.
 *  Verified grammars (children carry `left`/`right` or `name`/`value` fields):
 *  Ruby/Python assignment, TS/JS variable_declarator, JS object pair, Go
 *  var_spec, C/C++ init_declarator. If the grammar names the value field
 *  differently, the occurrence keeps the conservative binding verdict — a
 *  missed reference is safer than a corrupted binding. */
const VALUE_SIDE_BINDING_PARENTS = new Set([
  "assignment",
  "augmented_assignment",
  "variable_declarator",
  "pair",
  "var_spec",
  "init_declarator",
  "field_declaration",
])

/** True when an identifier occurrence is a *reference* (usage) of the renamed
 *  symbol — not a binding, member access, or object literal key. `relType` is
 *  the index relationship type and is reserved for future precision; the
 *  identity filter is type-agnostic so callback and type references are not
 *  dropped.
 *
 *  M16.E1: classification is position-aware, not just parent-type substring
 *  matching. A parent bucket like "assignment" binds only its left/name side;
 *  the value/right side (`prereqs = prerequisite_tasks` in Ruby/Python,
 *  `const x = prerequisite_tasks` in TS) is a real reference and must be
 *  renameable — proven missing on rake without this. */
export function isReferenceSite(o: IdentifierOccurrence, _relType: string): boolean {
  if (o.isMemberName) return false
  if (isBindingParentType(o.parentType)) {
    if (VALUE_SIDE_BINDING_PARENTS.has(o.parentType) && (o.parentField === "value" || o.parentField === "right" || o.parentField === "initializer")) return true
    return false
  }
  return true
}

/** Find the declaration NAME within the symbol's byte range: the identifier
 *  occurrence whose parent is a binding node (the symbol's own name), taking the
 *  earliest match. Returns the byte start index, or undefined if not found. */
export function findDeclarationName(
  occurrences: IdentifierOccurrence[],
  symbolName: string,
  start: number,
  end: number,
): number | undefined {
  let best: IdentifierOccurrence | undefined
  for (const o of occurrences) {
    if (o.text !== symbolName) continue
    if (o.startIndex < start || o.endIndex > end) continue
    if (!isBindingParentType(o.parentType)) continue
    if (!best || o.startIndex < best.startIndex) best = o
  }
  return best ? best.startIndex : undefined
}

/**
 * M59.A11 (#889): the declaration file's indexed rows no longer match disk.
 * Returns the file path when the mismatch is real (the file changed since it
 * was indexed), null when the row is fresh or the hash still agrees.
 */
async function staleDeclarationFile(projectId: string, match: SymbolMatch): Promise<string | null> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const freshness = checkSymbolFreshness(raw, match.id)
  if (freshness?.status === "fresh") return null
  const row = raw.prepare("SELECT file_hash FROM brain_file WHERE path=? AND project_id=?").get(match.fileId, projectId) as { file_hash?: string } | undefined
  if (!row?.file_hash || !fileUnchangedSince(match.fileId, row.file_hash)) return match.fileId
  return null
}

function matchesOf(found: any): SymbolMatch[] {
  return (found?.matches ?? []).filter((m: any) => m.byteStart != null && m.byteEnd != null)
}

async function uniqueSymbol(
  projectId: string,
  name: string,
  filePath?: string,
  lineStart?: number,
  allowStaleIndex = false,
  projectPath?: string,
  warnings?: string[],
): Promise<SymbolMatch> {
  const found: any = await ASTEngine.findSymbol(projectId, name, filePath, lineStart)
  let matches = matchesOf(found)
  if (matches.length === 0) throw new Error(`symbol ${name} not found or has no byte bounds`)
  if (matches.length > 1) throw new Error(`symbol ${name} is ambiguous; provide filePath and lineStart`)
  let match = matches[0] as SymbolMatch
  if (allowStaleIndex) return match

  const staleFile = await staleDeclarationFile(projectId, match)
  if (!staleFile) return match

  // M59.A11 (#889): agent-real. Every other read tool refreshes a stale file
  // within budget (BB_NO_AUTO_REFRESH) — editing refused instead, so the first
  // symbol edit after ANY external change (another tool, a git pull, the human)
  // was a hard stop, and the symbol's own bounds were never the problem when
  // the change did not touch it. Refreshing just this ONE file makes the bounds
  // CURRENT rather than stale, so the edit is applied to the bytes on disk with
  // bounds derived from them. `allowStaleIndex` (which would trust the old
  // bounds) stays unreachable from the wire — correctness first, convenience
  // second.
  if (!projectPath) throw new Error(`stale index bounds for ${name}; reindex before editing`)
  try {
    await reindexFilesParallel(projectId as any, realpathSync(projectPath), [{ path: staleFile, type: "modified" }])
  } catch (e: any) {
    throw new Error(
      `stale index bounds for ${name}: ${staleFile} changed after indexing and refreshing it failed (${e?.message ?? String(e)}); run bb_index for that file, then retry`,
    )
  }

  // Re-resolve AFTER the refresh: the symbol may have moved, been renamed, been
  // removed, or become ambiguous. Reporting the fresh truth beats editing a
  // stale span.
  const reFound: any = await ASTEngine.findSymbol(projectId, name, filePath, lineStart)
  matches = matchesOf(reFound)
  if (matches.length === 0) throw new Error(`symbol ${name} not found after refreshing ${staleFile} — it was renamed or removed since it was indexed`)
  if (matches.length > 1) throw new Error(`symbol ${name} is ambiguous; provide filePath and lineStart`)
  match = matches[0] as SymbolMatch
  if (await staleDeclarationFile(projectId, match)) {
    throw new Error(`stale index bounds for ${name} persist after refreshing ${staleFile}; reindex before editing`)
  }
  warnings?.push(`refreshed stale index rows for ${path.basename(match.fileId)} before editing (the file changed after it was indexed)`)
  return match
}

async function validateFile(filePath: string, content: string): Promise<void> {
  const result = await ASTEngine.parseFile(filePath, content)
  const errors = (result.errors ?? []).filter((error: any) => /syntax error/i.test(error.message ?? ""))
  if (errors.length > 0) throw new Error(`validation failed for ${filePath}: ${errors[0].message}`)
}

/**
 * M16.E1: scopes that re-declare `symbolName` inside the file (shadowing).
 * An occurrence of `symbolName` inside one of these byte ranges belongs to the
 * inner binding (a nested def/class of the same name, or a local variable), NOT
 * to the symbol being renamed — renaming it would corrupt a different symbol.
 *
 * The renamed declaration itself is excluded (its enclosing scope is the room
 * the symbol lives in, not a shadow), and body ranges come from tree-sitter
 * body nodes (block / body_statement / class_body …) via parseForSafety, so
 * this is AST-derived, never a text scan.
 */
function collectShadowScopes(parsed: SafetyParse, symbolName: string, declStart: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const o of parsed.occurrences) {
    if (o.text !== symbolName) continue
    if (!isBindingParentType(o.parentType)) continue
    if (o.startIndex === declStart) continue
    // A shadow binding's scope is its smallest enclosing body block.
    const body = parsed.bodyRanges
      .filter((b) => b.startIndex <= o.startIndex && o.endIndex <= b.endIndex)
      .sort((a, b) => (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex))[0]
    if (!body) continue
    // The declaration lives inside this same body → it IS the symbol's own
    // scope, not a shadow of the same name elsewhere.
    if (body.startIndex <= declStart && declStart <= body.endIndex) continue
    out.push({ start: body.startIndex, end: body.endIndex })
  }
  return out
}

type EditPlan = { changes: EditPlanChange[]; warnings: string[]; summary?: { renamedFiles: number; renamedSites: number } }

async function planEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditPlan> {
  const warnings: string[] = []
  if (request.mode === "write") {
    if (!request.filePath) throw new Error("write requires filePath")
    const target = resolveSafeEditPath(projectPath, request.filePath)
    return { changes: [{ path: target, before: existsSync(target) ? readFileSync(target, "utf8") : "", after: String(request.content ?? request.newContent ?? "") }], warnings }
  }

  const symbolName = request.mode === "insert" ? request.targetSymbolName : request.symbolName
  if (!symbolName) throw new Error(`${request.mode} requires ${request.mode === "insert" ? "targetSymbolName" : "symbolName"}`)
  const match = await uniqueSymbol(projectId, symbolName, request.filePath, request.lineStart, request.allowStaleIndex === true, projectPath, warnings)
  resolveSafeEditPath(projectPath, match.fileId)
  const original = readFileSync(match.fileId, "utf8")

  if (request.mode === "update") {
    const newContent = String(request.newContent ?? request.content ?? "")
    // M48.C2 (#700): fragment-safe update. The documented contract (registry
    // example) is full-declaration replacement, but a BODY FRAGMENT
    // ("return 42") used to replace the ENTIRE declaration span — silently
    // destroying the function while reporting validated:true. If newContent
    // does not declare the symbol itself, it is treated as the new body:
    // the declaration and signature are kept, only the body block changes.
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // A class METHOD declares itself without `function`/`def`/etc. — TS/Java-style
    // `private annotationLine(...)`. If only the bare keyword list is tested,
    // a full-declaration method replacement is misread as a body FRAGMENT and
    // nested inside the old declaration (illegal). A qualifier immediately
    // before the name is the self-declaration shape for those languages.
    const declaresSelf =
      new RegExp(`(?:function|class|interface|type|enum|struct|impl|def|fn|func|method|const|let|var|val)\\s+${escaped}\\b`).test(newContent) ||
      new RegExp(`\\b(?:public|private|protected|internal|static|abstract|override|readonly|final|sealed|export|declare|async)\\s+(?:async\\s+)?${escaped}\\b`).test(newContent)
    if (declaresSelf) return { changes: [{ path: match.fileId, before: original, after: replaceRange(original, match.byteStart, match.byteEnd, newContent) }], warnings }
    const parsed = await parseForSafety(match.fileId, original)
    const body = findSymbolBody(parsed, match.byteStart, match.byteEnd)
    if (body && original[body.startIndex] === "{") {
      const open = body.startIndex
      const close = body.endIndex - 1
      const inner = original.slice(open + 1, close)
      const innerIndent = inner.includes("\n") ? computeInnerIndent(original, body) : lineLeadingWhitespace(original, open) + indentUnit(original)
      const after = replaceRange(original, open + 1, close, "\n" + indentLines(newContent, innerIndent, true) + "\n" + lineLeadingWhitespace(original, open))
      return { changes: [{ path: match.fileId, before: original, after }], warnings }
    }
    // No recognizable brace body (expression-bodied / one-line decls in
    // languages without braces): refuse rather than guess — a caller wanting
    // a structural change passes the full declaration.
    throw new Error(`update ${symbolName}: newContent does not declare the symbol and no replaceable body block was found; pass the full declaration to replace it`)
  }
  if (request.mode === "insert") {
    const position = request.position ?? "after"
    const content = String(request.newContent ?? request.content ?? "")
    let start = position === "before" ? match.byteStart : match.byteEnd
    let end = start
    let replacement = `\n${content}\n`
    if (position === "inside-top" || position === "inside-bottom") {
      const parsed = await parseForSafety(match.fileId, original)
      const body = findSymbolBody(parsed, match.byteStart, match.byteEnd)
      if (!body) throw new Error(`cannot insert inside ${symbolName}: no recognizable body block (unsupported language or syntax)`)
      if (original[body.startIndex] === "{") {
        // ── Brace body ────────────────────────────────────────────────
        const open = body.startIndex
        const close = body.endIndex - 1
        const inner = original.slice(open + 1, close)
        const isMultiLine = inner.includes("\n")
        const braceLineIndent = lineLeadingWhitespace(original, open)
        const innerIndent = isMultiLine ? computeInnerIndent(original, body) : braceLineIndent + indentUnit(original)
        if (isMultiLine) {
          if (position === "inside-top") {
            start = end = open + 1
            replacement = "\n" + indentLines(content, innerIndent, true)
          } else {
            start = end = close
            replacement = indentLines(content, innerIndent, true) + "\n"
          }
        } else if (inner.trim() === "") {
          // empty single-line body `{}` → expand
          start = end = open + 1
          replacement = "\n" + indentLines(content, innerIndent, true) + "\n" + braceLineIndent
        } else {
          // single-line body → explode to multi-line, then insert
          const stmt = inner.trim()
          const contentLines = indentLines(content, innerIndent, true)
          start = open + 1
          end = close
          replacement = position === "inside-top"
            ? "\n" + contentLines + "\n" + innerIndent + stmt + "\n" + braceLineIndent
            : "\n" + innerIndent + stmt + "\n" + contentLines + "\n" + braceLineIndent
        }
      } else {
        // ── Soft body (indentation or keyword-terminated) ──────────────
        const indent = lineIndent(original, body.startIndex)
        if (!/^[\t ]*$/.test(indent)) {
          throw new Error(`cannot insert inside ${symbolName}: body is not line-aligned (unsupported body form such as Elixir do/end)`)
        }
        if (position === "inside-top") {
          start = end = body.startIndex
          replacement = indentLines(content, indent, false) + "\n" + indent
        } else {
          start = end = body.endIndex
          replacement = "\n" + indentLines(content, indent, true)
        }
      }
    }
    return { changes: [{ path: match.fileId, before: original, after: replaceRange(original, start, end, replacement) }], warnings }
  }
  if (request.mode === "delete") {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const callers = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id=? AND relationship_type IN ('calls','instantiates','references','uses')").get(match.id) as any)?.c ?? 0
    const deleted = replaceRange(original, match.byteStart, match.byteEnd, "")
    // M16.E3: dangling-reference guard. Relationship edges alone are not
    // trustworthy (proven on rake: symbol had zero edges while real call sites
    // existed). Scan the post-delete content for remaining AST reference sites
    // of the deleted name — a forced delete must never be silent about them.
    const parsedAfter = await parseForSafety(match.fileId, deleted)
    const leftovers = parsedAfter.occurrences
      .filter((o) => o.text === symbolName && isReferenceSite(o, ""))
      .map((o) => `line ${o.startLine}: ${o.parentType || "reference"}`)
    const indexedCallers = callers > 0 ? `${callers} indexed caller(s)` : null
    if ((callers > 0 || leftovers.length > 0) && request.force !== true) {
      const detail = [indexedCallers, leftovers.length > 0 ? `${leftovers.length} live reference(s) surviving deletion (${leftovers.slice(0, 5).join(", ")}${leftovers.length > 5 ? ", …" : ""})` : null].filter(Boolean).join("; ")
      throw new Error(`cannot delete ${symbolName}: ${detail}; pass force=true after reviewing impact`)
    }
    if (leftovers.length > 0) {
      warnings.push(`delete ${symbolName} (forced): ${leftovers.length} reference(s) remain in ${match.fileId}: ${leftovers.slice(0, 10).join("; ")}${leftovers.length > 10 ? "; …" : ""}`)
    }
    const pruned = await ImportPruner.prune(deleted, match.fileId)
    return { changes: [{ path: match.fileId, before: original, after: pruned }], warnings }
  }

  const newName = String(request.newName ?? "")
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) throw new Error("refactor requires a valid identifier newName")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const callerRows = raw.prepare("SELECT DISTINCT f.id AS fileId, f.path AS path, s.byte_start AS byteStart, s.byte_end AS byteEnd, r.relationship_type AS relType FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id WHERE r.target_symbol_id=? AND r.relationship_type IN ('calls','instantiates','references','uses')").all(match.id) as any[]

  // Fail loud on any stale caller file BEFORE renaming anything (no silent
  // partial rename). The declaration file was already freshness-checked by
  // uniqueSymbol(). fileId here is brain_file.id (what checkFileFreshness
  // expects); path is the on-disk location used to read + rewrite the file.
  const callerFileIds = [...new Set(callerRows.map((r) => r.fileId).filter(Boolean))] as string[]
  if (callerFileIds.length > 0) assertFreshFiles(raw, callerFileIds, `refactor ${symbolName}`)

  // path -> { declaration?: {start,end}; callers: Array<{start,end,relType}> }
  const fileRanges = new Map<string, { declaration?: { start: number; end: number }; callers: Array<{ start: number; end: number; relType: string }> }>()
  const declEntry = fileRanges.get(match.fileId) ?? { callers: [] }
  declEntry.declaration = { start: match.byteStart, end: match.byteEnd }
  fileRanges.set(match.fileId, declEntry)
  for (const row of callerRows) {
    if (!row.path || row.byteStart == null) continue
    const entry = fileRanges.get(row.path) ?? { callers: [] }
    entry.callers.push({ start: row.byteStart, end: row.byteEnd ?? Number.MAX_SAFE_INTEGER, relType: row.relType || "" })
    fileRanges.set(row.path, entry)
  }

  const changes: EditPlanChange[] = []
  let renamedFiles = 0
  let renamedSites = 0
  for (const [file, ranges] of fileRanges) {
    resolveSafeEditPath(projectPath, file)
    const before = readFileSync(file, "utf8")
    const parsed = await parseForSafety(file, before)
    const sites = new Set<number>()

    const declStart = ranges.declaration
      ? findDeclarationName(parsed.occurrences, symbolName, ranges.declaration.start, ranges.declaration.end)
      : undefined

    // 1. Declaration: rename the symbol's own name identifier exactly once.
    if (declStart != null) sites.add(declStart)

    // 2. M16.E1: COMPLETE reference rename in the declaration file. The old
    // implementation renamed only sites inside index caller spans — when the
    // index had no edge (proven on rake: prerequisite_tasks had zero), real
    // call sites in the SAME file stayed at the old name while the tool
    // reported success. Now every AST-classified reference site of the name in
    // the declaration file is renamed, unless a nested scope shadows the name
    // (those sites belong to the inner symbol). Cross-file callers are still
    // applied on top via index caller spans (step 3).
    if (ranges.declaration && declStart != null) {
      const shadows = collectShadowScopes(parsed, symbolName, declStart)
      for (const o of parsed.occurrences) {
        if (o.text !== symbolName) continue
        if (!isReferenceSite(o, "")) continue
        if (shadows.some((s) => o.startIndex >= s.start && o.endIndex <= s.end)) continue
        sites.add(o.startIndex)
      }
    }

    // 3. Cross-file caller references: rename only AST reference sites within
    // each caller span (index-derived; declaration file already fully covered).
    for (const span of ranges.callers) {
      // Defense-in-depth: a caller span must lie strictly inside the current file. The
      // hash freshness gate above already rejects any shrunk/changed caller, but
      // a corrupt indexer offset must never be silently clamped or skipped.
      const spanEnd = span.end === Number.MAX_SAFE_INTEGER ? before.length : span.end
      if (span.start < 0 || span.start >= before.length || spanEnd < span.start || spanEnd > before.length) {
        throw new Error(`refactor ${symbolName}: caller span out of bounds in ${file} (start=${span.start}, end=${span.end}, length=${before.length}); reindex before editing`)
      }
      for (const o of parsed.occurrences) {
        if (o.text !== symbolName) continue
        if (o.startIndex < span.start || o.endIndex > spanEnd) continue
        if (isReferenceSite(o, span.relType)) sites.add(o.startIndex)
      }
    }

    if (sites.size === 0) continue
    let after = before
    for (const offset of [...sites].sort((a, b) => b - a)) after = replaceRange(after, offset, offset + symbolName.length, newName)
    changes.push({ path: file, before, after })
    renamedFiles++
    renamedSites += sites.size
  }
  if (request.mode === "refactor") {
    warnings.push(`refactor ${symbolName} → ${newName}: ${renamedSites} site(s) across ${renamedFiles} file(s)`)
  }
  return { changes, warnings, summary: request.mode === "refactor" ? { renamedFiles, renamedSites } : undefined }
}

export async function executeEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditResult> {
  const { changes, warnings, summary } = await planEdit(projectPath, projectId, request)
  if (request.dryRun === true) return { mode: request.mode, dryRun: true, changes, formatted: false, validated: false, reindexed: false, warnings: warnings.length > 0 ? warnings : undefined, summary }
  const snapshots = new Map(changes.map((change) => [change.path, { existed: existsSync(change.path), content: change.before }]))
  // Track every temp file created during the write loop so the catch block can
  // scrub orphans (a renameSync failure after writeFileSync leaves a temp).
  const temps: string[] = []
  try {
    for (const change of changes) {
      mkdirSync(path.dirname(change.path), { recursive: true })
      const temporary = `${change.path}.bb-edit-${randomUUID()}`
      temps.push(temporary)
      writeFileSync(temporary, change.after, "utf8")
      renameSync(temporary, change.path)
    }
    if (request.format !== false) for (const change of changes) await BrainSurgicalPatcher.tryAutoFormat(change.path)
    for (const change of changes) await validateFile(change.path, readFileSync(change.path, "utf8"))
    // M40.A3: the reindex call now applies the bounded post-pass internally
    // (snapshot + repair + scoped enrichment/gravity), so "AI edits a function
    // → seconds later the DB has it with resolved relationships" holds here.
    const reindexResult = await reindexFilesParallel(projectId as any, realpathSync(projectPath), changes.map((change) => ({ path: change.path, type: snapshots.get(change.path)!.existed ? "modified" as const : "added" as const })))
    return {
      mode: request.mode,
      dryRun: false,
      changes: changes.map((change) => ({ ...change, after: readFileSync(change.path, "utf8") })),
      formatted: request.format !== false,
      validated: true,
      reindexed: true,
      // M40.A3: visible derived-data outcome — never a silent deferral.
      derived: reindexResult.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 },
      warnings: warnings.length > 0 ? warnings : undefined,
      summary,
    }
  } catch (error) {
    // Roll back every file to its pre-edit snapshot, then scrub any orphaned
    // .bb-edit-* temp files so a mid-loop failure never leaks temp artifacts.
    for (const [file, snapshot] of snapshots) {
      if (snapshot.existed) writeFileSync(file, snapshot.content, "utf8")
      else rmSync(file, { force: true })
    }
    for (const t of temps) { try { rmSync(t, { force: true }) } catch {} }
    throw error
  }
}
