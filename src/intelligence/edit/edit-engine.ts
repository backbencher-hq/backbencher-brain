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

/** Tree-sitter node types that are member-access expressions (obj.x), NOT
 *  declaration bindings. Several grammars name these with "field" or "property"
 *  substrings (field_expression, field_access), which would otherwise falsely
 *  match the substring rules below and classify the RECEIVER as a binding,
 *  causing silent under-rename in refactor. Checked FIRST and unconditionally. */
const ACCESS_EXPRESSION_TYPES = new Set([
  "field_expression",       // Rust, C/C++, Scala, Groovy, C#, Zig
  "field_access",            // Java, Dart
  "member_expression",       // JS/TS, Ruby (call)
  "attribute",               // Python
  "selector_expression",     // Go
  "member_access_expression", // C#
  "navigation_expression",   // Swift, Kotlin
  "dot_qualified_expression", // Kotlin
  "qualified_expression",    // C#
  "scoped_type_identifier",  // Groovy (qualified type reference, not a binding)
])

export function isBindingParentType(type: string): boolean {
  const t = type.toLowerCase()
  // Access expressions are uses, never declaration bindings — checked
  // before substring rules so "field_expression" doesn't match includes("field").
  if (ACCESS_EXPRESSION_TYPES.has(t)) return false
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

/** True when an identifier occurrence is a *reference* (usage) of the renamed
 *  symbol — not a binding, member access, or property key. `relType` is the
 *  index relationship type and is reserved for future precision; the identity
 *  filter is type-agnostic so callback and type references are not dropped. */
export function isReferenceSite(o: IdentifierOccurrence, _relType: string): boolean {
  if (o.isMemberName) return false
  if (isBindingParentType(o.parentType)) return false
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

async function uniqueSymbol(projectId: string, name: string, filePath?: string, lineStart?: number, allowStaleIndex = false): Promise<SymbolMatch> {
  const found: any = await ASTEngine.findSymbol(projectId, name, filePath, lineStart)
  const matches = (found?.matches ?? []).filter((m: any) => m.byteStart != null && m.byteEnd != null)
  if (matches.length === 0) throw new Error(`symbol ${name} not found or has no byte bounds`)
  if (matches.length > 1) throw new Error(`symbol ${name} is ambiguous; provide filePath and lineStart`)
  const match = matches[0] as SymbolMatch
  if (allowStaleIndex) return match
  const raw = await BrainDatabase.getRawInstance(projectId)
  const freshness = checkSymbolFreshness(raw, match.id)
  if (freshness?.status === "fresh") return match
  const row = raw.prepare("SELECT file_hash FROM brain_file WHERE path=? AND project_id=?").get(match.fileId, projectId) as { file_hash?: string } | undefined
  if (!row?.file_hash || !fileUnchangedSince(match.fileId, row.file_hash)) throw new Error(`stale index bounds for ${name}; reindex before editing`)
  return match
}

async function validateFile(filePath: string, content: string): Promise<void> {
  const result = await ASTEngine.parseFile(filePath, content)
  const errors = (result.errors ?? []).filter((error: any) => /syntax error/i.test(error.message ?? ""))
  if (errors.length > 0) throw new Error(`validation failed for ${filePath}: ${errors[0].message}`)
}

async function planEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditPlanChange[]> {
  if (request.mode === "write") {
    if (!request.filePath) throw new Error("write requires filePath")
    const target = resolveSafeEditPath(projectPath, request.filePath)
    return [{ path: target, before: existsSync(target) ? readFileSync(target, "utf8") : "", after: String(request.content ?? request.newContent ?? "") }]
  }

  const symbolName = request.mode === "insert" ? request.targetSymbolName : request.symbolName
  if (!symbolName) throw new Error(`${request.mode} requires ${request.mode === "insert" ? "targetSymbolName" : "symbolName"}`)
  const match = await uniqueSymbol(projectId, symbolName, request.filePath, request.lineStart, request.allowStaleIndex === true)
  resolveSafeEditPath(projectPath, match.fileId)
  const original = readFileSync(match.fileId, "utf8")

  if (request.mode === "update") return [{ path: match.fileId, before: original, after: replaceRange(original, match.byteStart, match.byteEnd, String(request.newContent ?? request.content ?? "")) }]
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
    return [{ path: match.fileId, before: original, after: replaceRange(original, start, end, replacement) }]
  }
  if (request.mode === "delete") {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const callers = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id=? AND relationship_type IN ('calls','instantiates','references','uses')").get(match.id) as any)?.c ?? 0
    if (callers > 0 && request.force !== true) throw new Error(`cannot delete ${symbolName}: ${callers} active references; pass force=true after reviewing impact`)
    const deleted = replaceRange(original, match.byteStart, match.byteEnd, "")
    const pruned = await ImportPruner.prune(deleted, match.fileId)
    return [{ path: match.fileId, before: original, after: pruned }]
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
  for (const [file, ranges] of fileRanges) {
    resolveSafeEditPath(projectPath, file)
    const before = readFileSync(file, "utf8")
    const parsed = await parseForSafety(file, before)
    const sites = new Set<number>()

    // 1. Declaration: rename the symbol's own name identifier exactly once.
    if (ranges.declaration) {
      const name = findDeclarationName(parsed.occurrences, symbolName, ranges.declaration.start, ranges.declaration.end)
      if (name != null) sites.add(name)
    }

    // 2. Caller references: rename only AST reference sites within each caller span.
    for (const span of ranges.callers) {
      // Defense-in-depth: a caller span must lie inside the current file. The
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
  }
  return changes
}

export async function executeEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditResult> {
  const changes = await planEdit(projectPath, projectId, request)
  if (request.dryRun === true) return { mode: request.mode, dryRun: true, changes, formatted: false, validated: false, reindexed: false }
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
    await reindexFilesParallel(projectId as any, realpathSync(projectPath), changes.map((change) => ({ path: change.path, type: snapshots.get(change.path)!.existed ? "modified" as const : "added" as const })))
    return { mode: request.mode, dryRun: false, changes: changes.map((change) => ({ ...change, after: readFileSync(change.path, "utf8") })), formatted: request.format !== false, validated: true, reindexed: true }
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
