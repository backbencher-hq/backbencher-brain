import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, statSync, chmodSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BrainDatabase } from "../../brain/database"
import { checkSymbolFreshness, fileUnchangedSince } from "../../brain/freshness"
import { ASTEngine } from "../../ast/engine"
import { BrainSurgicalPatcher } from "../../ast/brain-surgical-patcher"
import { ImportPruner } from "../../ast/import-pruner"
import { reindexFilesParallel } from "../../ast/parallel-indexer"
import { parseForSafety, assertFreshFiles, type IdentifierOccurrence, type SafetyParse, type BodyRange } from "../../ast/safety-primitives"
import { EXTENSION_LANGUAGE } from "../../ast/language-detection"

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

/**
 * Resolve an edit target to a real, inside-the-project absolute path, or throw.
 *
 * WHY THIS IS REWRITTEN. The previous version realpath'd the project ROOT and
 * then compared it against the requested path AS GIVEN:
 *
 *   if (!inside(root, candidate)) throw new Error(`path escapes project root`)
 *
 * The requested path here is a symbol's `fileId` — the path the INDEXER was
 * handed, not a realpath. On macOS `/var` and `/tmp` are symlinks into
 * `/private`, so a project created at `/var/folders/.../bb-edit-XYZ` has a real
 * root of `/private/var/folders/.../bb-edit-XYZ` while every indexed fileId is
 * spelled `/var/folders/.../bb-edit-XYZ/src/mod.ts`. `path.relative` between the
 * two is `../../../var/folders/...`, so a path that is plainly inside the
 * project read as an escape and the edit was REFUSED.
 *
 * bb_edit was therefore non-functional on macOS for any project under /var or
 * /tmp — which is all eighteen of its own gates, every scratch project, and most
 * CI. On Linux /tmp is a real directory, realpathSync(tmpdir()) === tmpdir(),
 * the comparison succeeds, and the bug is invisible. Measured on macOS: 11 of the
 * 18 gates cannot run, 8 of them crashing on exactly this refusal.
 *
 * THE FIX is to compare real paths with real paths. The request is resolved to a
 * real path FIRST — walking up to the nearest existing ancestor, because the leaf
 * of a file being created does not exist yet — and containment is then judged on
 * the resolved result.
 *
 * The containment guarantee is unchanged and in one place tightened. The
 * non-existent-leaf case used to return `candidate`, the UNRESOLVED spelling, with
 * no realpath check on the final component at all: writing `link-to-outside/
 * newfile.ts` was never checked. It is now checked like every other case.
 */
export function resolveSafeEditPath(projectPath: string, requested: string): string {
  const root = realpathSync(projectPath)
  // `requested` is sometimes an absolute fileId from the index and sometimes a
  // caller-supplied relative path. Both must land on the same footing.
  const raw = path.isAbsolute(requested) ? requested : path.resolve(root, requested)
  const existing = nearestExisting(raw)
  // The nearest EXISTING ancestor's realpath is what containment is judged on.
  // For an existing file that is the file itself; for a file about to be created
  // it is the nearest existing directory that will hold it.
  const realExisting = realpathSync(existing)
  if (!inside(root, realExisting)) {
    // TWO DISTINCT REFUSALS, and the wording is load-bearing rather than
    // cosmetic. script/m13/verify-edit-unit asserts the exact phrase "through
    // symlink" for a symlink pointing outside the project and a plain escape for
    // `../`, and it is right to: they are different failures with different
    // causes. A `../` is a caller who built a bad path; a symlink escape is a
    // link inside the project pointing at something outside it, which is a
    // property of the PROJECT and not of the request. A caller told only
    // "escapes project root" cannot tell whether to fix their path or go and look
    // at the tree.
    //
    // The first version of this rewrite collapsed both into one message and the
    // gate failed on the wording — correctly. The refusal was still safe; only
    // the diagnosis had been lost.
    const viaSymlink = realExisting !== existing
    throw new Error(
      `path escapes project root${viaSymlink ? " through symlink" : ""}: ${requested}${raw === existing ? "" : ` (via ${existing})`}`,
    )
  }
  if (raw !== existing) {
    // Creating a new file, possibly in directories that do not exist yet. The
    // whole relative REMAINDER below `existing` has to be re-attached, not just
    // the leaf: the first version of this fix appended only
    // `path.basename(raw)`, so `a/b/c.ts` with neither `a` nor `b` present
    // resolved to `<project>/c.ts` — the intermediate directories were silently
    // dropped and the edit landed at the wrong path. `relative(existing, raw)`
    // is exactly the missing tail.
    const tail = path.relative(existing, raw)
    const target = tail ? path.join(realExisting, tail) : realExisting
    // Containment is re-checked on the reassembled path: a symlinked directory
    // that points outside the project must still be refused even though
    // `existing` itself resolved cleanly.
    if (!inside(root, target)) throw new Error(`path escapes project root through symlink: ${requested}`)
    return target
  }
  return realExisting
}

function replaceRange(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) throw new Error(`invalid edit bounds: ${start}-${end}`)
  return text.slice(0, start) + replacement + text.slice(end)
}

// ── File-fidelity primitives (M66) ──────────────────────────────────────────
//
// A tool that writes source must not change anything the caller did not ask it to
// change. Three things it WAS changing, each measured rather than assumed (see
// fixtures/bb_edit/probe-e2-file-fidelity.ts):
//
//   * a 0755 file came back 0644, because the commit path is
//     writeFileSync(temp) + renameSync and the temp inherits the process umask;
//   * a rolled-back file containing any invalid UTF-8 byte was CORRUPTED, because
//     the snapshot was a `readFileSync(path, "utf8")` STRING — that re-encodes bad
//     bytes as U+FFFD, so "restore" wrote back a second, different corruption;
//   * a CRLF file was left with MIXED line endings, because every splice in this
//     file concatenates a literal "\n" and nothing ever looks at what the file
//     already uses.
//
// The fix is one discipline applied at the I/O boundary: read the file's BYTES
// once, decide its line ending from those bytes, keep the exact mode, and commit
// and roll back in bytes. The splice still happens in a string, because the byte
// offsets the indexer hands are code-unit offsets into the decoded text (verified
// in probe-e1 — the indexer's "byteStart" is in fact a UTF-16 code-unit index, and
// treating it as bytes would corrupt every non-ASCII file, a separate bug this
// pass does NOT introduce or fix).

/** The line ending a file already uses, judged from its bytes. Defaults to "\n". */
function dominantNewline(text: string): "\n" | "\r\n" {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue
    if (i > 0 && text[i - 1] === "\r") crlf++
    else lf++
  }
  return crlf > lf ? "\r\n" : "\n"
}

/** Rewrite a spliced string so every newline matches the file's own ending. */
function withNewline(text: string, nl: string): string {
  return nl === "\n" ? text : text.replace(/\r?\n/g, nl)
}

/**
 * A byte-exact snapshot of a file's pre-edit state: the raw bytes, the mode, and
 * whether it existed. `readFileSync(path, "utf8")` is NOT a snapshot — it decodes,
 * and decoding is lossy for anything that is not valid UTF-8.
 */
function snapshotOf(file: string): { existed: boolean; bytes: Buffer | null; mode: number | null } {
  if (!existsSync(file)) return { existed: false, bytes: null, mode: null }
  const bytes = readFileSync(file)
  let mode: number | null = null
  try { mode = statSync(file).mode & 0o777 } catch { mode = null }
  return { existed: true, bytes, mode }
}

/** Write bytes and, when the target already existed, restore its mode. */
function writeBytesPreservingMode(file: string, bytes: Buffer | string, mode: number | null): void {
  writeFileSync(file, bytes)
  if (mode !== null) {
    try { chmodSync(file, mode) } catch { /* best effort: content is the contract, mode is not */ }
  }
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

/** A file's base name with no extension — how brain_import spells a relative
 *  module specifier (`./target` for `src/target.ts`). */
function basenameNoExt(fileId: string): string {
  return path.basename(fileId, path.extname(fileId))
}

/** Occurrence parents that are an import or re-export SPECIFIER — the one place a
 *  deleted name makes a module edge dangle.
 *
 *  MEASURED, not guessed. parseForSafety was run over twelve import shapes and the
 *  parentType each one reports:
 *
 *    import { target as aliased } from './target'   import_specifier    <- caught
 *    import target from './target'                  import_clause       <- caught
 *    export { target } from './target'              export_specifier    <- caught
 *    from .target import target                     dotted_name         <- caught
 *    from .target import target as aliased         dotted_name         <- caught
 *    import m.target.Target;                        scoped_identifier   <- caught
 *    use crate::target::target;                    scoped_identifier   <- caught
 *    import * as m from './target'                 (no occurrence)      correct
 *    const { target } = require('./target')         (no occurrence)
 *    require_relative 'target'                     (no occurrence)
 *    import "example.com/m/target"                 (no occurrence)
 *    alias M.Target, as: :target                   (no occurrence)
 *
 *  The five "(no occurrence)" rows are not gaps to paper over. In each, the module
 *  path is a string literal or a scoped path and the deleted name is not a separate
 *  identifier — Go's `import "m/target"` names no symbol at all, so deleting one of
 *  that module's exports is not a dangling reference to the symbol. They are
 *  correctly out of scope for a per-symbol check, and "fixing" them would mean
 *  matching substrings of a path, which is how a guard starts refusing deletes it
 *  should allow. */
const IMPORT_SPECIFIER_PARENTS = new Set([
  "import_specifier",
  "import_clause",
  "export_specifier",
  "dotted_name",
  "scoped_identifier",
])

/** Extensions a module specifier may be resolving to, derived from the product's
 *  OWN language table rather than a second hand-written list. A hard-coded list
 *  here would drift the moment a language is added, and it would drift silently:
 *  a missing extension means a real import stops resolving, which makes the delete
 *  guard permissive — the dangerous direction. */
const MODULE_EXTENSIONS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.keys(EXTENSION_LANGUAGE).filter((k) => k !== k.toUpperCase()).map((k) => `.${k}`))),
)

/** Resolve a recorded import specifier to the file it names, or null when it does
 *  not name `declRelPath`.
 *
 *  Pure path arithmetic on POSIX-style project-relative paths — no regex, no
 *  filesystem probing, so the answer is a fact about the recorded specifier rather
 *  than about which files happen to exist right now.
 *
 *  `import_path` is the specifier AS WRITTEN (`./user`, `../models/user`,
 *  `@/models/user`), never a resolved path, so the importer's own directory has to
 *  be joined on before the comparison. Getting that wrong is not theoretical: the
 *  first version of this guard compared the specifier to the bare stem, so
 *  `../models/user` matched nothing and an aliased cross-directory import deleted
 *  silently.
 *
 *  A NON-RELATIVE specifier is left unresolved rather than guessed, and that covers
 *  two different situations which must not be conflated:
 *
 *    bare package   `react`, `lodash/fp` — names a package, not a project file.
 *      Cannot be shown to refer to this file, so it does not block. Correct.
 *
 *    path ALIAS     `@/models/user`, `~/models/user` — names a project file, and
 *      resolving it needs the tsconfig/jsconfig `paths` map, which this function
 *      does not have. MEASURED: the indexer does not record these in brain_import
 *      at all, so there is no row to resolve FROM. An earlier version of this
 *      function did handle `@/` and `~/` by assuming `src/`, and it was dead code
 *      — the delete still proceeded, because the absence of the row, not the
 *      arithmetic, was the reason. Assuming `src/` would also be wrong outright in
 *      any project whose alias points elsewhere, so the branch is gone rather than
 *      left to look like coverage.
 *
 *  This is a real blind spot and it is recorded as one in script/m70 rather than
 *  papered over: a project using path aliases gets no importer-based protection
 *  from this guard, and its only remaining signal is the indexed `calls` edge. */
function resolveImportToFile(importerRelPath: string, spec: string, declRelPath: string): boolean {
  if (!spec) return false
  const importerDir = path.posix.dirname(importerRelPath.replace(/\\/g, "/"))
  let base: string
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    base = path.posix.normalize(path.posix.join(importerDir, spec))
  } else if (spec.startsWith("/")) {
    base = path.posix.normalize(spec.slice(1))
  } else return false

  const declExt = path.posix.extname(declRelPath)
  const declStem = declRelPath.slice(0, declRelPath.length - declExt.length)
  // `path.posix.normalize` has already collapsed `.` and `..`, so the comparisons
  // below need no further cleanup.
  //
  // 1. Written with the extension, or extensionless (Node ESM and bundlers, Go,
  //    Java, Rust all write `pkg/mod` for `pkg/mod.go`).
  if (base === declRelPath || base === declStem) return true
  // 2. The specifier names a DIRECTORY whose index file is the declaration:
  //    `import { x } from './target'` for `target/index.ts`. The direction of this
  //    test is the part I got wrong first. Asking "is the declaration's stem
  //    inside the specifier's directory" (dirname(declStem) startsWith base)
  //    is far too loose — it would also match `target/deep/thing.ts`, a file three
  //    levels below a module the specifier never named. The only true statement
  //    here is that the declaration IS that directory's index, so the directory
  //    and the file's own name are compared together.
  if (path.posix.dirname(declStem) === base) {
    const asIndex = path.posix.basename(declStem)
    if (asIndex === "index" || MODULE_EXTENSIONS.some((e) => asIndex === `index${e}`)) return true
  }
  return false
}

/** The project-relative path of the file a mutation targets.
 *
 *  `match.fileId` is NOT always the index's `<projectId>:<relativePath>` key.
 *  MEASURED: on the wire path (which is what bb_edit's caller supplies and what
 *  the engine receives) it is the ABSOLUTE path,
 *
 *    /var/folders/…/bb-tr-iBZK19/src/target.ts
 *
 *  while the row's own id is
 *
 *    863a3af6…:src/target.ts
 *
 *  so looking the file up by id returned undefined and every cross-directory
 *  importer check silently found zero candidates. The guard reported nothing, and
 *  a guard that reports nothing when the evidence is present is worse than one
 *  that is absent, because it looks like a clean bill of health.
 *
 *  Resolved by `path`, not by parsing the key: a `<projectId>:<path>` id is split
 *  on the FIRST colon only after confirming the prefix is this project's hex id,
 *  and the absolute path is handled by relativizing against the project root.
 *  Both forms are accepted because the indexer and the wire use different ones. */
function projectRelativePath(raw: any, projectId: string, fileId: string, projectRoot?: string): string | null {
  const row = raw
    .prepare("SELECT relative_path AS relPath FROM brain_file WHERE project_id = ? AND (id = ? OR path = ?)")
    .get(projectId, fileId, fileId) as { relPath?: string } | undefined
  if (row?.relPath) return row.relPath.replace(/\\/g, "/")
  if (projectRoot && path.isAbsolute(fileId)) {
    const rel = path.relative(projectRoot, fileId)
    if (rel && !rel.startsWith("..")) return rel.split(path.sep).join("/")
  }
  return null
}

/** Best-effort project-relative path, for a message a human has to act on. */
function relativeTo(root: string, file: string): string {
  const rel = path.relative(root, file)
  return rel && !rel.startsWith("..") ? rel : path.basename(file)
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
    if (declaresSelf) return { changes: [{ path: match.fileId, before: original, after: replaceRange(original, match.byteStart, match.byteEnd, withNewline(newContent, dominantNewline(original))) }], warnings }
    const parsed = await parseForSafety(match.fileId, original)
    const body = findSymbolBody(parsed, match.byteStart, match.byteEnd)
    if (body && original[body.startIndex] === "{") {
      const open = body.startIndex
      const close = body.endIndex - 1
      const inner = original.slice(open + 1, close)
      const innerIndent = inner.includes("\n") ? computeInnerIndent(original, body) : lineLeadingWhitespace(original, open) + indentUnit(original)
      // M66: splice with the FILE's line ending. This concatenated a literal "\n",
      // so a CRLF file came back with the new body on "\n" and the untouched tail
      // still on "\r\n" — a file with MIXED line endings, silently, on a
      // successful edit. `newContent` arrives from an MCP client as a JSON string
      // and carries "\n" regardless of what the file uses, so the fix belongs here
      // at the splice, not at the parameter boundary.
      const nl = dominantNewline(original)
      const spliced = withNewline("\n" + indentLines(newContent, innerIndent, true) + "\n" + lineLeadingWhitespace(original, open), nl)
      const after = replaceRange(original, open + 1, close, spliced)
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
    // M66: `replacement` is assembled from literal "\n" in every branch above, so
    // rather than thread the file's line ending through nine construction sites
    // (each easy to miss in a later edit), the spliced RESULT is normalized once
    // here. `replaceRange` returns the whole new file text; a CRLF file must not
    // gain LF-terminated lines from an insert, and normalizing the result is
    // exactly equivalent to having built it right.
    const nl = dominantNewline(original)
    const after = withNewline(replaceRange(original, start, end, replacement), nl)
    return { changes: [{ path: match.fileId, before: original, after }], warnings }
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

    // M68: check the files that IMPORT this module, not only this one.
    //
    // MEASURED, three call shapes, same declaration, same index:
    //
    //   import { target } from './target'          2 edges -> 'calls'    GUARDED
    //   import { target as aliased } from './...'  1 edge  -> 'exports' ONLY
    //
    // So in the aliased shape the analyzer never resolved the call site to the
    // imported symbol, the `calls` edge does not exist, and the guard's two inputs
    // were both empty: zero indexed callers, and zero occurrences of the name in
    // the DECLARATION file. The delete proceeded, and the result was
    // caller.ts still calling a function that no longer exists — a build break
    // reported as SUCCESS.
    //
    // The fix is not to trust the edges more (they are what failed here) but to
    // consult the one index table that DID record the dependency: brain_import,
    // and to look for the dependency where it is unambiguous.
    //
    // THE PRECISE EVIDENCE IS THE SPECIFIER, NOT THE NAME. An aliased import
    // still spells the original name in its specifier — `import { target as
    // aliased }` contains `target` with parent=import_specifier — and that
    // specifier is broken the moment the declaration is deleted, regardless of
    // anything else in the file. It needs no scope analysis and no alias
    // resolution.
    //
    // I first scanned each importing file for every *reference* to the name and
    // that was wrong twice over, both measured:
    //
    //   import { user as modelUser } from '../models/user'   -> DELETED (BUG)
    //     The specifier is '../models/user'. The guard compared the specifier to
    //     the bare stem and to './'+stem, so a cross-directory import matched
    //     nothing and the aliased delete went through silently — the original
    //     defect, still present, just narrowed to any import that is not in the
    //     same directory as the declaration. My own m68 gate used './target' for
    //     every case, so it was green throughout while this shape was broken.
    //
    //   const user = { n: 1 }; String(user.n)               -> REFUSED (BUG)
    //     in a file importing an UNRELATED './user'. The occurrence is a genuine
    //     reference — to the file's own local `user`. A name scan cannot tell
    //     "the imported symbol is used here" from "something else with this name
    //     is used here", and no amount of care in the scan fixes that; it needs
    //     scope resolution, which is not what this guard should be.
    //
    // So: resolve the specifier to a real path, and count only specifiers. Both
    // bugs are structural consequences of the scan, and both disappear with it.
    //
    // WHY IT STILL DOES NOT OVER-REFUSE, the design risk that made the first
    // version unacceptable. Refusing on any unresolved edge would make `delete`
    // unusable on any project with imperfect edges, which is most of them. Three
    // properties keep it honest:
    //
    //   * a specifier is required — an importing file that never names the
    //     deleted symbol is not a reference, so `import './target'` for its side
    //     effects, which is extremely common, never blocks a delete;
    //   * the specifier must RESOLVE to this file — a same-stem module in another
    //     directory (`src/types/user.ts` beside `src/models/user.ts`, a layout
    //     found in most real projects) is a different module and never matches;
    //   * a namespace import (`import * as m`) names no symbol, and deleting one
    //     export from a module that still exists does not dangle, so it correctly
    //     does not block.
    const declRelPath = projectRelativePath(raw, projectId, match.fileId, projectPath)
    const importerRows = declRelPath === null
      ? []
      : (raw.prepare(
        // The LIKE is a PREFILTER on the specifier's last segment, nothing more.
        // It bounds the candidate set without deciding anything: the decision is
        // made by resolveImportToFile below, which walks the real path.
        "SELECT DISTINCT i.file_id AS fileId, f.path AS path, f.relative_path AS relPath, i.import_path AS spec " +
        "FROM brain_import i JOIN brain_file f ON f.id = i.file_id " +
        "WHERE i.project_id = ? AND i.is_external = 0 AND i.file_id <> ? AND i.import_path IS NOT NULL " +
        "AND (i.import_path = ? OR i.import_path LIKE ? OR i.import_path LIKE ?)",
      ).all(
        projectId,
        match.fileId,
        basenameNoExt(match.fileId),
        `%/${basenameNoExt(match.fileId)}`,
        `./${basenameNoExt(match.fileId)}`,
      ) as Array<{ fileId: string; path: string; relPath: string; spec: string }>)

    // One parse per candidate file, not one per row: several specifiers in the
    // same file can match the prefilter.
    const parsedByFile = new Map<string, Awaited<ReturnType<typeof parseForSafety>> | null>()
    const importerLeftovers: string[] = []
    for (const importer of importerRows) {
      if (!resolveImportToFile(importer.relPath, importer.spec, declRelPath as string)) continue
      let parsed = parsedByFile.get(importer.fileId)
      if (parsed === undefined) {
        try { parsed = await parseForSafety(importer.path, readFileSync(importer.path, "utf8")) }
        catch { parsed = null }
        parsedByFile.set(importer.fileId, parsed)
      }
      if (!parsed) continue
      for (const o of parsed.occurrences) {
        if (o.text !== symbolName) continue
        if (!IMPORT_SPECIFIER_PARENTS.has(o.parentType)) continue
        importerLeftovers.push(`${relativeTo(projectPath, importer.path)}:${o.startLine} (${o.parentType})`)
      }
    }

    const indexedCallers = callers > 0 ? `${callers} indexed caller(s)` : null
    const totalLeftovers = leftovers.length + importerLeftovers.length
    if ((callers > 0 || totalLeftovers > 0) && request.force !== true) {
      const parts = [
        indexedCallers,
        // The phrase "surviving deletion" is kept because script/m13/verify-edit-unit
        // asserts on it, and a gate that greps for it is checking that the
        // refusal SAYS what survives — which is right. The WHERE is new
        // information layered on top, not a replacement: the declaring file and
        // the importing files are different risks and the message distinguishes
        // them.
        leftovers.length > 0
          ? `${leftovers.length} live reference(s) surviving deletion in the declaring file (${leftovers.slice(0, 5).join(", ")}${leftovers.length > 5 ? ", …" : ""})`
          : null,
        importerLeftovers.length > 0
          ? `${importerLeftovers.length} reference(s) surviving deletion in importing file(s) — ${[...new Set(importerLeftovers.map((l) => l.split(":")[0]))].slice(0, 4).join(", ")}`
          : null,
      ].filter(Boolean).join("; ")
      throw new Error(`cannot delete ${symbolName}: ${parts}; pass force=true after reviewing impact`)
    }
    if (totalLeftovers > 0) {
      const where = [...leftovers.map((l) => `${path.basename(match.fileId)} ${l}`), ...importerLeftovers]
      warnings.push(`delete ${symbolName} (forced): ${totalLeftovers} reference(s) remain — ${where.slice(0, 10).join("; ")}${where.length > 10 ? "; …" : ""}`)
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
  // M66: the snapshot is BYTES, not a decoded string. The previous snapshot was
  // `content: change.before` — the plan's `before` field, which came from
  // `readFileSync(path, "utf8")`. For a file containing any byte sequence that is
  // not valid UTF-8, that read does not fail, it silently substitutes U+FFFD, so
  // the "snapshot" already differed from disk and a rollback wrote back the
  // substitution characters: a rollback that corrupts the file it is restoring.
  // One latin-1 comment anywhere in the repo turns any failed edit into silent
  // data loss. Reading the bytes once, here, at the last moment before the first
  // write, closes that — `change.before` remains what the PLAN saw (a lossy
  // string, which is fine for a diff preview) while the bytes are what ROLLBACK
  // restores.
  const snapshots = new Map(changes.map((change) => [change.path, snapshotOf(change.path)]))
  // M66: which files were ACTUALLY replaced on disk, as opposed to merely
  // planned. A file whose write never happened needs no restore, and trying to
  // restore one is actively harmful: if the write failed because the directory is
  // read-only, the restore into that same directory fails too, and the rollback
  // then reports a file as "NOT restored" that was never modified in the first
  // place. The engine did that until script/m67 made the failure real with a
  // read-only directory: the commit failed on `writeFileSync(temp)` with EACCES,
  // nothing had been written, and the answer came back "ROLLBACK INCOMPLETE" for
  // a file that was never at risk. A false alarm in a safety mechanism is how you
  // train people to ignore it.
  const committed: string[] = []
  // Track every temp file created during the write loop so the catch block can
  // scrub orphans (a renameSync failure after writeFileSync leaves a temp).
  const temps: string[] = []
  try {
    for (const change of changes) {
      mkdirSync(path.dirname(change.path), { recursive: true })
      const temporary = `${change.path}.bb-edit-${randomUUID()}`
      temps.push(temporary)
      writeFileSync(temporary, change.after, "utf8")
      // M66: carry the mode across the rename. renameSync REPLACES the inode, so
      // a 0755 script or a 0600 secret the tool edited came back 0644 — the temp
      // inherits the process umask and nothing preserved the original. An edit
      // that quietly drops a file's permissions is a change the caller never
      // asked for and cannot see in a diff.
      const originalMode = snapshots.get(change.path)!.mode
      renameSync(temporary, change.path)
      // Past this point the file on disk is NOT the pre-edit file, so putting it
      // back is the engine's responsibility.
      committed.push(change.path)
      if (originalMode !== null) {
        try { chmodSync(change.path, originalMode) } catch { /* best effort: content is the contract */ }
      }
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
    //
    // M66: each restore is its own try/catch and the loop does NOT stop on the
    // first failure. A bare `writeFileSync(file, snapshot.content)` meant one
    // unwritable file (read-only, vanished directory, permission) threw out of
    // the catch block: the remaining files were never restored, the
    // orphaned-temp scrub after it never ran, and the original error was REPLACED
    // by the rollback's — the caller saw "EPERM" instead of the validation failure
    // that caused the rollback, with a half-reverted working tree. Now every
    // COMMITTED file is attempted, failures are collected, temps are always
    // scrubbed, and the ORIGINAL error still propagates — annotated, because a
    // partial rollback is the most important thing a caller can be told.
    //
    // Only `committed` paths are restored. A path that was planned but never
    // replaced on disk is already correct, and attempting a restore of it can only
    // fail and raise a false alarm — which is exactly what happened: a write that
    // failed because its directory was read-only produced "ROLLBACK INCOMPLETE"
    // for a file nothing had been written to.
    const rollbackFailures: string[] = []
    for (const file of committed) {
      const snapshot = snapshots.get(file)!
      try {
        if (snapshot.existed) writeBytesPreservingMode(file, snapshot.bytes!, snapshot.mode)
        else rmSync(file, { force: true })
      } catch (e: any) {
        rollbackFailures.push(`${file}: ${e?.message ?? String(e)}`)
      }
    }
    for (const t of temps) { try { rmSync(t, { force: true }) } catch {} }
    if (rollbackFailures.length > 0) {
      ;(error as any).rollbackFailures = rollbackFailures
      ;(error as any).message = `${(error as any).message} — ROLLBACK INCOMPLETE, these files were NOT restored: ${rollbackFailures.join("; ")}`
    }
    throw error
  }
}
