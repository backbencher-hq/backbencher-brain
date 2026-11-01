// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_edit engine: plan → validate → commit → roll back the
//   one source-mutating surface, for every mode and every option.
// WHICH TOOL IT SERVES — bb_edit (mutability write, requiresIndex true, modes:
//   write, update, insert, delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — a write tool is judged by what it does when it
//   fails, so the plan records each target's exact pre-image bytes, the commit
//   re-checks them immediately before the first write, and every committed file is
//   restored byte-for-byte (mode included) if any later step fails. Byte bounds
//   are UTF-16 code-unit offsets into the decoded text (the indexer's spelling),
//   never raw bytes; every splice carries the file's own line ending; Windows
//   path separators are normalised before comparisons. Planning never writes.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_edit.md (generated),
//   docs/BB_EDIT.md (curated), validation/tools/bb_edit/**, gates:
//   script/m13/verify-edit-*.ts, script/m15/verify-edit-*.ts,
//   script/verify-edit.ts, script/m16/verify-edit-real-repo.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_edit/descriptor.ts,
//   src/mcp/tools/bb_edit/handler.ts, src/ast/import-pruner.ts,
//   src/ast/brain-surgical-patcher.ts, src/ast/safety-primitives.ts,
//   script/tool-docs/curation/bb_edit.ts, docs/BB_EDIT.md, the edit gates.
// CONTRACTS IT MUST NOT BREAK — plan never writes; pre-image re-check before the
//   first write; byte-identical rollback; declared envelope per file; path
//   containment; per-mode option acceptance; no regex may rewrite source.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, statSync, chmodSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BrainDatabase } from "../../brain/database"
import { checkSymbolFreshness, fileUnchangedSince } from "../../brain/freshness"
import { ASTEngine } from "../../ast/engine"
import { BrainSurgicalPatcher, type FormatOutcome } from "../../ast/brain-surgical-patcher"
import { ImportPruner, type ImportPruneReport } from "../../ast/import-pruner"
import { reindexFilesParallel } from "../../ast/parallel-indexer"
import { parseForSafety, assertFreshFiles, type DeclaredName, type IdentifierOccurrence, type SafetyParse, type BodyRange } from "../../ast/safety-primitives"
import { EXTENSION_LANGUAGE } from "../../ast/language-detection"
import { bbDataDir } from "../../util/bb-data-dir"

export type EditMode = "write" | "update" | "insert" | "delete" | "refactor" | "batch"
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
  /**
   * `write` only. Three states, each honored rather than inferred:
   *   undefined (default) — replace, but a replacement that removes more than
   *     half of a file (and more than WRITE_GUARD.minRemovedLines lines) is
   *     refused as a probable mistake;
   *   true — replace whatever is there, no size question asked;
   *   false — create-only: an existing file is refused instead of replaced.
   * Accepted by `write` and by no other mode (EDIT_OPTIONS_BY_MODE).
   */
  overwrite?: boolean
  /** Legacy adapter compatibility only; never exposed by bb_edit. */
  allowStaleIndex?: boolean
  /**
   * `batch` only. The edits to apply, each a complete request in one of
   * the five single-file modes. Planned first, in order, as ONE plan; then
   * written, formatted, validated and reindexed as ONE cycle; and rolled back as
   * one envelope if any step of that cycle fails. A batch is all-or-nothing.
   *
   * `files` is the fan-out form: when present it SUPPLIES `filePath` to every
   * entry, so a caller writes one edit once and lists the files it applies to
   * (and an entry must then not name its own `filePath`). Entries may not carry
   * `dryRun` or `format`: those belong to the batch, because a batch with a
   * per-entry dry run would plan one edit and apply another, and the whole point
   * of this mode is that the cycle happens exactly once.
   *
   * Two entries may not resolve to the SAME file. Each entry is planned from the
   * file's pre-edit bytes, so a second entry on the same file would be planned
   * against content the first entry is about to replace — a silent lost update.
   * That is refused by name and by entry index rather than composed; sequential
   * `bb_edit` calls are how two edits to one file compose.
   */
  edits?: EditRequest[]
  files?: string[]
}

export interface EditPlanChange { path: string; before: string; after: string }

/**
 * the per-change rollback envelope.
 *
 * A batch touches many files at once, and "did my working tree survive?" is a
 * per-file question. A single boolean over the whole call cannot answer it: the
 * ordinary refusal (`ok: false`) leaves every file untouched, while a failure
 * AFTER some writes leaves those files restored and reports which ones. So the
 * state of every planned target is reported — planned, committed, restored — and
 * a restore that itself failed is named with its reason instead of being folded
 * into a count.
 */
export interface EditEnvelopeEntry {
  /** Project-relative path, the spelling every other field uses. */
  path: string
  /** Batch entry that planned this file (0 for a single-mode call). */
  entry: number
  /** The mode that planned it (`batch` never appears — this is the entry's own). */
  mode: Exclude<EditMode, "batch">
  /** The plan produced a change for this file. */
  planned: boolean
  /** The file on disk was REPLACED by this call (past the point of no return). */
  committed: boolean
  /** After a failure: the pre-edit bytes are back on disk. On success: false,
   *  because there was nothing to restore. */
  restored: boolean
  /** Pre-edit size in bytes, or null when the plan intended to create the file. */
  bytesBefore: number | null
  /** Size on disk after the call, or null when the call refused and wrote nothing. */
  bytesAfter: number | null
}
export interface EditEnvelope {
  /** Always true: a batch is planned in full before the first byte is written. */
  atomic: true
  entries: EditEnvelopeEntry[]
  committed: number
  restored: number
  /** Restores that FAILED, each named with its reason. Empty is the ordinary case. */
  failed: Array<{ path: string; reason: string }>
}

export interface EditResult {
  mode: EditMode
  dryRun: boolean
  changes: EditPlanChange[]
  /** D5: true ONLY when every changed file was processed by the formatter that its
   *  extension maps to and that process exited 0. Measured, never inferred from
   *  `request.format` — a `.rb` file (no mapping), a machine with no prettier, and a
   *  formatter that exited 3 all leave this false, where the request flag said true. */
  formatted: boolean
  /** D5: per-file formatter outcomes — the measured basis of `formatted`. Present
   *  whenever formatting was requested (`format !== false`); each entry names the
   *  formatter, whether it ran, whether it exited 0, and why not when it did not. */
  formatting?: Array<{ path: string } & FormatOutcome & {
    /** The formatter rewrote the file with LF newlines and the engine restored
     *  the file's own CRLF ending afterwards. Declared, never silent. */
    lineEndingRestored?: boolean
  }>
  validated: boolean
  reindexed: boolean
  /**
   * derived-data outcome of the post-edit reindex — pass used
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
  /** batch only — which entry touched which files, in plan order. */
  batch?: Array<{ entry: number; mode: Exclude<EditMode, "batch">; files: string[]; importPruning?: ImportPruneReport }>
  /** the per-file outcome of this call, present for every mode. */
  envelope?: EditEnvelope
  /**
   * `delete` only: what the import cleanup DID and — when it did nothing — why.
   * Import pruning is implemented for TypeScript/JavaScript only; every other
   * language is left byte-for-byte unchanged and says so here, because "cleaned
   * up" and "not attempted" are different facts and only one of them is true.
   */
  importPruning?: ImportPruneReport
}

type SymbolMatch = { id: string; fileId: string; byteStart: number; byteEnd: number; lineStart?: number; name: string; symbolType?: string }

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
 * The containment guarantee is one check for every case, including a leaf that
 * does not exist yet: the resolved parent is realpath'd and the remainder is
 * re-attached to it, so `link-to-outside/newfile.ts` is refused like any other
 * escape rather than written through the link.
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
    assertWritableTarget(root, target, requested)
    return target
  }
  assertWritableTarget(root, realExisting, requested)
  return realExisting
}

/**
 * Directories under the project that bb_edit does not write, whatever the caller's
 * `filePath` says: version-control state, dependency trees, and the index's own
 * data directory. Containment in the project is the security boundary; this list
 * is the SAFETY one — a typo'd path must not be able to rewrite a git object or
 * the database the tool's answers come from. Measured before this guard: a `write`
 * to `.git/hooks/pre-commit.ts` committed and reindexed, and a path under
 * `.bb-data/` was created and indexed.
 */
const PROTECTED_SEGMENTS: ReadonlySet<string> = new Set([".git", ".hg", ".svn", "node_modules", ".bb-data"])

function assertWritableTarget(root: string, target: string, requested: string): void {
  const relative = path.relative(root, target)
  const protectedSegment = relative.split(path.sep).find((segment) => PROTECTED_SEGMENTS.has(segment))
  if (protectedSegment) {
    throw new Error(
      `refused: ${requested} is inside a protected path (${protectedSegment}/) — bb_edit does not write version-control, dependency, or tool-state directories; choose a source path instead`,
    )
  }
  let dataDir: string | null = null
  try { dataDir = bbDataDir() } catch { dataDir = null }
  if (dataDir && inside(dataDir, target)) {
    throw new Error(
      `refused: ${requested} is inside the index data directory (${dataDir}) — bb_edit never edits index state as source; choose a source path instead`,
    )
  }
}

function replaceRange(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) throw new Error(`invalid edit bounds: ${start}-${end}`)
  return text.slice(0, start) + replacement + text.slice(end)
}

// ── File-fidelity primitives () ──────────────────────────────────────────
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

/** True when the text contains at least one newline that is not preceded by CR. */
function hasLoneLf(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue
    if (i === 0 || text[i - 1] !== "\r") return true
  }
  return false
}

/**
 * A byte-exact snapshot of a file's pre-edit state: the raw bytes, the mode, and
 * whether it existed. `readFileSync(path, "utf8")` is NOT a snapshot — it decodes,
 * and decoding is lossy for anything that is not valid UTF-8.
 */
function snapshotOf(file: string): { existed: boolean; bytes: Buffer | null; mode: number | null; hash: string | null } {
  if (!existsSync(file)) return { existed: false, bytes: null, mode: null, hash: null }
  const bytes = readFileSync(file)
  let mode: number | null = null
  try { mode = statSync(file).mode & 0o777 } catch { mode = null }
  // the hash is taken from the SAME bytes the rollback would restore, so
  // the pre-flight check below compares the plan's pre-image with the bytes this
  // commit is about to replace — not with a second, later read of the file.
  return { existed: true, bytes, mode, hash: createHash("sha256").update(bytes).digest("hex") }
}

/** sha256 of a path's current bytes, or null when there is no readable file there. */
export function fileHash(file: string): string | null {
  try {
    if (!existsSync(file)) return null
    return createHash("sha256").update(readFileSync(file)).digest("hex")
  } catch {
    return null
  }
}

/**
 * the pre-flight check between plan and commit.
 *
 * The plan reads each target's bytes, resolves spans from them, and returns an
 * `after` text; the commit writes from that plan. Nothing held a project lock or
 * re-read the file in between, so a file that changed in the window was partly
 * overwritten from a plan computed against its previous contents — silently,
 * because the committed bytes come from the plan, not from disk.
 *
 * The window is real and not only theoretical: planning a cross-file `refactor`
 * walks many files, each step awaiting, and an editor saving the declaration file
 * mid-walk is an ordinary event on a developer's machine. The check is cheap
 * because the plan already hashed each target as it read it (readPreImage) and the
 * commit already has the bytes in hand (snapshotOf) — so the comparison costs
 * nothing but the map lookups.
 *
 * Returns one human line per mismatch; an empty array means the plan's pre-images
 * are exactly the bytes on disk NOW. A target the plan intended to CREATE (no
 * hash recorded) must still not exist: a file that appeared at that path in the
 * window is the same class of surprise in the opposite direction.
 */
export function preImageMismatches(
  projectPath: string,
  planned: Record<string, string | null>,
  current: Map<string, string | null>,
): string[] {
  const moved: string[] = []
  for (const path0 of Object.keys(planned)) {
    const want = planned[path0]
    const got = current.get(path0) ?? null
    if (want === got) continue
    const label = relativeTo(projectPath, path0)
    moved.push(`${label} (planned ${want ? want.slice(0, 12) : "no file at that path"}, now ${got ? got.slice(0, 12) : "gone"})`)
  }
  return moved
}

/** Write bytes and, when the target already existed, restore its mode. */
function writeBytesPreservingMode(file: string, bytes: Buffer | string, mode: number | null): void {
  writeFileSync(file, bytes)
  if (mode !== null) {
    try { chmodSync(file, mode) } catch { /* best effort: content is the contract, mode is not */ }
  }
}

// ── the overwrite guard ────────────────────────────────────────────
//
// MEASURED before this guard existed (script/m71/probe-edit-review.ts, case H4):
// a 41-line file replaced by a single line, reported `ok`. The documented contract
// is "existing files are replaced atomically", so this was not a contract breach —
// but `write` is the one capability of this tool where a single wrong parameter
// destroys content, and the case it destroys is the common mistake: a caller who
// meant `update`/`insert` and passed a fragment, or who targetted the wrong path.
// Nothing in the result distinguished that from an intentional whole-file rewrite.
//
// Two thresholds, both stated in the refusal so the caller can act on it: at
// least half the file's lines gone AND at least a handful of lines gone. A
// replacement that keeps most of the file is an ordinary edit and is not
// questioned; `overwrite: true` is the one-word acknowledgement for the rest.
//
// Deliberately NOT a heuristic about the content: it never guesses whether the
// rewrite was intended — it reports the numbers and asks, which is the difference
// between a guard and a gatekeeper.
export const WRITE_GUARD = {
  /** A replacement that removes fewer lines than this is never questioned. */
  minRemovedLines: 5,
  /** …and it must also leave no more than this share of the pre-image's lines. */
  maxRemainingRatio: 0.5,
} as const

/** Lines in a text, with a single trailing newline not counted as an extra line. */
export function lineCount(text: string): number {
  if (text.length === 0) return 0
  const end = text.endsWith("\n") ? text.length - 1 : text.length
  return text.slice(0, end).split("\n").length
}

/**
 * The refusal `write` owes a caller whose replacement would drop most of a file,
 * or null when the write may proceed. Pure and exported so the contract is stated
 * once, for the engine, the gates and the stress matrix alike
 * (script/m71/probe-edit-overwrite-guard.ts).
 */
export function writeGuardMessage(
  relPath: string,
  target: { existed: boolean; before: string; after: string },
  overwrite?: boolean,
): string | null {
  if (!target.existed) return null
  if (overwrite === false) {
    return `write refused: ${relPath} already exists and overwrite is false (create-only) — pass overwrite: true to replace it, or use update/insert to change it in place.`
  }
  if (overwrite === true) return null
  const beforeLines = lineCount(target.before)
  const afterLines = lineCount(target.after)
  const removed = beforeLines - afterLines
  if (removed < WRITE_GUARD.minRemovedLines) return null
  if (afterLines > beforeLines * WRITE_GUARD.maxRemainingRatio) return null
  const percent = Math.round((removed / beforeLines) * 100)
  return `write refused: it would replace ${relPath} (${beforeLines} lines) with ${afterLines} line(s), removing ${removed} lines (${percent}%) — a write that removes at least half of a file's lines (and at least ${WRITE_GUARD.minRemovedLines}) is treated as a probable mistake. Pass overwrite: true to replace it anyway, or use update/insert to change part of the file.`
}

// ── (E4): language-aware insert body detection ──────────────────────
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

// ── (E2): AST reference-identity rename ──────────────────────────────
// The refactor path must rename only actual reference sites, never unrelated
// same-name bindings, member accesses, or property keys. Classification is
// derived from tree-sitter node types (via parseForSafety), not raw-text scans.

/** Parent types that BIND/declare the identifier (const x, function f(), param,
 *  field, object key). Conservative: ambiguous reassignments are treated as
 *  bindings so a rename never over-reaches and corrupts source.
 *
 *  Cross-language: every supported grammar names its declaration containers
 *  differently, so this is a deliberate union of those conventions. */

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
 * classification is position-aware, not just parent-type substring
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
 * (): the declaration file's indexed rows no longer match disk.
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

/**
 * How many files this project has indexed ().
 *
 * Consulted ONLY on the resolution failure path, to tell two refusals apart: a
 * name that is not in a real index, and a project that has no index to look in.
 * They shared one message — `symbol appFn not found or has no byte bounds` — and
 * on a project the indexer has never run over that sentence is false: the symbol
 * is on disk and nothing could have found it, so the caller is sent hunting for
 * a typo instead of indexing. Measured before the fix: an unindexed project
 * answered exactly that for `update`, `insert`, `delete` and `refactor`.
 * -1 means the count itself could not be read, which is reported as the old
 * message rather than as a confident claim about the index.
 */
async function indexedFileCount(projectId: string): Promise<number> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    return Number((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c ?? 0)
  } catch {
    return -1
  }
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
  if (matches.length === 0) {
    // name the real cause when there is no index at all. The MCP server
    // refuses the symbol modes earlier on such a project and says so; this
    // message is the one the CLI door (`bb tool bb_edit`) and any direct handler
    // caller see, and "symbol not found" is the wrong sentence for both of them.
    if ((await indexedFileCount(projectId)) === 0) {
      const project = projectPath ? `"${projectPath}"` : "<project>"
      throw new Error(
        `symbol ${name} could not be resolved: this project has no index (0 files indexed), so the name cannot be found in it — index it first: bb index ${project}. bb_edit write mode does not need an index and works now; update, insert, delete and refactor resolve their target through the index.`,
      )
    }
    throw new Error(`symbol ${name} not found or has no byte bounds`)
  }
  if (matches.length > 1) throw new Error(`symbol ${name} is ambiguous; provide filePath and lineStart`)
  let match = matches[0] as SymbolMatch
  if (allowStaleIndex) return match

  const staleFile = await staleDeclarationFile(projectId, match)
  if (!staleFile) return match

  // (): agent-real. Every other read tool refreshes a stale file
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
 * scopes that re-declare `symbolName` inside the file (shadowing).
 * An occurrence of `symbolName` inside one of these byte ranges belongs to the
 * inner binding (a nested def/class of the same name, or a local variable), NOT
 * to the symbol being renamed — renaming it would corrupt a different symbol.
 *
 * The renamed declaration itself is excluded (its enclosing scope is the room
 * the symbol lives in, not a shadow), and body ranges come from tree-sitter
 * body nodes (block / body_statement / class_body …) via parseForSafety, so
 * this is AST-derived, never a text scan.
 */
/**
 * Parent types that mean "this name belongs to an OBJECT/HASH/STRUCT LITERAL entry or
 * is a member definition" — measured per language in
 * script/m71/diagnose-member-binding-shapes.ts: TS/JS object key `pair`, object and
 * class method `method_definition`, class field `public_field_definition`, Go and Rust
 * struct field `field_declaration`, Java/C# field `variable_declarator`, Kotlin class
 * property `variable_declaration`.
 *
 * `isBindingParentType` calls these binding SITES (right for the rename filter: a member
 * name must never be renamed as a reference) which is not the same question as "does this
 * name enter an enclosing scope".
 */
const MEMBER_NAME_PARENT_TYPES = new Set([
  "pair",
  "pair_pattern",
  "method_definition",
  "public_field_definition",
  "property_signature",
])

/**
 * Parent types that mean "this binding is a PARAMETER".
 *
 * MEASURED per language (script/m71/diagnose-parameter-binding.ts): typescript
 * `required_parameter`, javascript `formal_parameters`, java `formal_parameter`,
 * python `parameters`, go and c `parameter_declaration`, rust/kotlin/csharp
 * `parameter`, ruby `method_parameters`.
 */
const PARAMETER_BINDING_PARENTS = new Set([
  "required_parameter",
  "optional_parameter",
  "formal_parameters",
  "formal_parameter",
  "spread_parameter",
  "parameter",
  "parameter_declaration",
  "parameters",
  "method_parameters",
  "lambda_parameters",
  "typed_parameter",
  "default_parameter",
])

function collectShadowScopes(parsed: SafetyParse, symbolName: string, declStart: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const o of parsed.occurrences) {
    if (o.text !== symbolName) continue
    if (!isBindingParentType(o.parentType)) continue
    if (o.startIndex === declStart) continue

    // A PARAMETER is declared in the parameter list, BEFORE the body it shadows, so
    // the "which body encloses this binding" test below can never find it: measured,
    // the parameter site sits outside every body range, no shadow scope was
    // reported, and the body's reference was renamed as if it were the outer symbol
    // — `export function use(target: number) { return renamed + 1 }` while the
    // parameter kept its name. That reproduced in the DECLARATION file as well
    // (case V of script/m71/probe-refactor-completeness.ts), so it predates the
    // cross-file coverage added in D2; the import coverage simply reached more
    // files with the same hole.
    //
    // Its scope is approximated by BOTH the nearest following body range (right for
    // C, whose declaration node is only the declarator `use(int target)` and stops
    // before the body) and the smallest enclosing declaration node (right for an
    // expression-bodied arrow, which has no body range at all). Both are added when
    // present; over-inclusion skips a rename, which is the safe direction.
    if (PARAMETER_BINDING_PARENTS.has(o.parentType)) {
      const following = parsed.bodyRanges
        .filter((b) => b.startIndex > o.endIndex)
        .sort((a, b) => a.startIndex - b.startIndex)[0]
      if (following) out.push({ start: following.startIndex, end: following.endIndex })
      const container = parsed.declaredNames
        .filter((d) => d.declarationStart <= o.startIndex && o.endIndex <= d.declarationEnd)
        .sort((a, b) => (a.declarationEnd - a.declarationStart) - (b.declarationEnd - b.declarationStart))[0]
      if (container) out.push({ start: container.declarationStart, end: container.declarationEnd })
      continue
    }

    // A shadow binding's scope is its smallest enclosing body block.
    const body = parsed.bodyRanges
      .filter((b) => b.startIndex <= o.startIndex && o.endIndex <= b.endIndex)
      .sort((a, b) => (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex))[0]
    if (!body) continue
    // The declaration lives inside this same body → it IS the symbol's own
    // scope, not a shadow of the same name elsewhere.
    if (body.startIndex <= declStart && declStart <= body.endIndex) continue

    // A MEMBER NAME only shadows when its container is a declaration wrapper. In
    // `const config = { target: 99 }` / `const helper = { target(x) {…} }` the nearest
    // enclosing body is the surrounding FUNCTION, no object braces form a body range,
    // so the property was treated as a shadow of the whole enclosing function — and
    // the call site `target()` sitting right beside it was skipped.
    //
    // MEASURED (script/m71/diagnose-m67-fixture.ts, m67's own fixture): that bogus scope
    // covered `caller()` in full, so the declaration-file pass left `return target()`
    // alone while the caller-span pass, which had no shadow check at all, renamed it.
    // The pre-fix answer was therefore accidentally correct and the two passes
    // DISAGREED; making them agree exposed the bug (2 sites expected, 1
    // reported). The exemption is narrow on purpose: a member whose container IS a
    // wrapper (a class/impl/struct body) does shadow bare references inside that
    // container in Java, C#, Kotlin, Ruby and Python, so those stay as they were.
    if (MEMBER_NAME_PARENT_TYPES.has(o.parentType) && !DECLARATION_WRAPPER_BODY_TYPES.has(body.nodeType)) continue

    out.push({ start: body.startIndex, end: body.endIndex })
  }
  return out
}

// ── full declaration vs body fragment, decided by the PARSE ────────────
//
// made `update` fragment-safe: if `newContent` does not declare the
// symbol, it is treated as the new BODY, which is the right contract. The
// DECISION, though, was two regexes that required a keyword (`function`, `def`,
// `fn`, …) or a modifier (`public`, `static`, …) IMMEDIATELY before the symbol
// name. MEASURED (script/m71/probe-edit-review.ts, script/m71/probe-method-shapes.ts):
//
//   kotlin  `fun target(): Int { … }`        → nested `fun target` INSIDE the old body, ok
//   csharp  `int Target() { … }`              → nested `int Target()`, ok
//   dart    `int target() { … }`              → nested `int target()`, ok
//   java    `int target() { … }`              → refused by the syntax validator (loud, misdiagnosed)
//   ts      `target(): number { … }`          → refused by the syntax validator (loud, misdiagnosed)
//   haskell `target x = x + 2`                → "does not declare the symbol" (a full declaration)
//
// Three of those languages accept a nested function/method, so the mangled file
// PARSES, `validated: true` comes back, and the caller is told the edit
// succeeded over a file that no longer declares the function they edited.
//
// The decision is now structural. `parseForSafety(newContent)` reports every
// name the fragment DECLARES, taken from each declaration node's own `name`
// field — which is grammar-truth, not spelling:
//
//   1. STRUCTURAL. A declared name equal to the symbol, whose declaration node is
//      not inside a STATEMENT body of the fragment (container bodies like
//      class_body are wrappers, not scopes), is the symbol's own declaration.
//      Covers Kotlin/C#/Dart/Java/TS-method/Haskell/Erlang/PHP/F#/Scala and every
//      `export function`/`const x = () =>`/`def`/`fn` shape.
//   2. COMPATIBILITY. The old regexes still speak, but ONLY when the grammar
//      answered nothing at all (`declaredNames` empty) — measured: Elixir
//      `def target do … end` has no `name` field anywhere (the name is an
//      identifier inside a `call`), so the parse cannot answer and the old
//      keyword check is the only signal left. The regexes are never a NEGATIVE:
//      a parse that found the declaration wins regardless of what they say.
//   3. METHOD FRAGMENT. `target(): number { … }` is a valid METHOD but not a
//      valid statement, so the standalone parse is full of ERROR nodes and step
//      1 sees nothing (measured: TS and JS class methods, object-literal methods).
//      Retrying inside a class wrapper resolves it — and the wrapper result is
//      accepted only when the declaration the wrapper finds is FUNCTION/METHOD
//      shaped, so `x = 1` (a field inside the same wrapper) can never be read as
//      a method declaration.

/**
 * Body node types that WRAP declarations rather than contain statements.
 * A declaration inside one of these is still "top level" for this decision —
 * `class A { int target() {…} }` declares target, while
 * `if (x) { const target = 1 }` does NOT (statement_block is not in this set).
 */
const DECLARATION_WRAPPER_BODY_TYPES = new Set([
  "class_body",
  "interface_body",
  "enum_body",
  "object_body",
  "impl_body",
  "trait_body",
  "type_body",
  "class_definition",
  "declaration_list", // C# class/interface/enum body
  "field_declaration_list", // Rust struct / Go struct body
  "enum_variant_list", // Rust enum body
])

/** True when a declared name sits inside a statement/function body of the fragment. */
function insideStatementBody(parsed: SafetyParse, declared: DeclaredName): boolean {
  return parsed.bodyRanges.some(
    (b) =>
      !DECLARATION_WRAPPER_BODY_TYPES.has(b.nodeType) &&
      b.startIndex <= declared.declarationStart &&
      declared.declarationEnd <= b.endIndex,
  )
}

/** Structural verdict: does the fragment declare this symbol at its top level? */
function declaresSymbolAtTopLevel(parsed: SafetyParse, symbolName: string): boolean {
  return parsed.declaredNames.some((d) => d.text === symbolName && !insideStatementBody(parsed, d))
}

/**
 * The keyword/modifier patterns, retained ONLY as the compatibility signal
 * described above. They can only ever ADD a full-declaration verdict, never
 * remove one: a false positive falls back to the structural declaration test,
 * while a false negative would treat a declaration as a fragment and splice a
 * body into it.
 */
function legacySelfDeclarationPattern(symbolName: string): RegExp {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `(?:function|class|interface|type|enum|struct|impl|def|fn|func|method|const|let|var|val)\\s+${escaped}\\b` +
      `|\\b(?:public|private|protected|internal|static|abstract|override|readonly|final|sealed|export|declare|async)\\s+(?:async\\s+)?${escaped}\\b`,
  )
}

/** Wrapper that turns a bare method fragment into a parseable declaration. */
const METHOD_FRAGMENT_WRAPPED = (content: string): string => `class __bb_fragment__ {\n${content}\n}\n`

async function contentDeclaresSymbol(
  filePath: string,
  content: string,
  symbolName: string,
  symbolType?: string,
): Promise<boolean> {
  let parsed: SafetyParse
  try {
    parsed = await parseForSafety(filePath, content)
  } catch {
    // Unsupported grammar for this path, or a fragment the parser refuses
    // outright: fall through to the body path, which fails loud when there is no
    // spliceable body.
    return false
  }
  if (declaresSymbolAtTopLevel(parsed, symbolName)) return true

  // 2 · compatibility fallback — only when the grammar exposed no declaration
  // names at all for this fragment.
  if (parsed.declaredNames.length === 0 && legacySelfDeclarationPattern(symbolName).test(content)) return true

  // 3 · method fragment: not a statement, so retry inside a class wrapper. Gated
  // on a syntax error or a method-shaped symbol so an ordinary body fragment
  // never pays for a second parse, and accepted only for a function/method
  // declaration (a field of the same name is not a declaration of the symbol).
  const grammarSawTheName = parsed.declaredNames.some((d) => d.text === symbolName)
  if (!grammarSawTheName && (parsed.hasSyntaxError || /method|constructor/i.test(symbolType ?? ""))) {
    try {
      const wrapped = await parseForSafety(filePath, METHOD_FRAGMENT_WRAPPED(content))
      if (
        wrapped.declaredNames.some(
          (d) =>
            d.text === symbolName &&
            /function|method/i.test(d.declarationType) &&
            !insideStatementBody(wrapped, d),
        )
      ) {
        return true
      }
    } catch {
      /* the wrapper is an attempt, not a requirement */
    }
  }
  return false
}

/**
 * the indexed span is NOT always the DECLARATION range.
 *
 * MEASURED (script/m71/debug-java-span.ts): a Java method is indexed from its
 * NAME — `target() {\n return 1;\n }` — with the return type OUTSIDE the span, and
 * a Kotlin function from `target(): Int { … }` with `fun ` outside it, while
 * C#, TypeScript, Go and Dart index the whole declaration from its first keyword.
 * So replacing the span with a full declaration `int target() { … }` produced
 * `int int target() { … }`, which the validator refused — a legitimate Java or
 * Kotlin full-declaration update could not succeed, which is half of why the
 * D1 probe's Java case failed even once the content was correctly recognised.
 *
 * The parse knows the real range: the declaration node whose NAME sits inside the
 * indexed span. The indexed span is then widened to it — min/max, so a language
 * that indexes MORE than the declaration (a Python decorator ahead of `def`, say)
 * is never shrunk; the span only grows to cover the declaration it belongs to.
 *
 * The widening is refused across a newline: the prefix between the span and the
 * declaration is a return type / keyword / modifier list and lives on the same
 * line. A multi-line gap means the parse is describing something else, and the
 * indexed span is used unchanged rather than guessing.
 */
function declarationRangeOf(
  parsed: SafetyParse,
  symbolName: string,
  spanStart: number,
  spanEnd: number,
): { start: number; end: number } | null {
  const hits = parsed.declaredNames.filter(
    (d) => d.text === symbolName && d.startIndex >= spanStart && d.endIndex <= spanEnd,
  )
  if (hits.length === 0) return null
  // Outermost declaration: a same-named local inside the symbol also sits inside
  // the span, and its declaration starts later.
  const decl = hits.reduce((a, b) => (b.declarationStart < a.declarationStart ? b : a))
  const start = Math.min(spanStart, decl.declarationStart)
  const end = Math.max(spanEnd, decl.declarationEnd)
  if (start === spanStart && end === spanEnd) return null
  if (parsed.content.slice(start, spanStart).includes("\n") || parsed.content.slice(spanEnd, end).includes("\n")) return null
  return { start, end }
}

/** D2/ what one `refactor` must rewrite in ONE file. */
type RefactorFilePlan = {
  declaration?: { start: number; end: number }
  callers: Array<{ start: number; end: number; relType: string }>
  /**
   * D2: import bindings of THIS symbol in this file, from `brain_import`. The
   * `line` is the index's line for that specifier (used to pick the right one when
   * a file imports the same name from two modules); `aliased` records that the
   * caller bound the symbol under ANOTHER local name, so only the specifier may be
   * rewritten and the local name left alone.
   */
  imports?: Array<{ line: number | null; aliased: boolean }>
}

type EditPlan = {
  changes: EditPlanChange[]
  warnings: string[]
  summary?: { renamedFiles: number; renamedSites: number }
  /** the sha256 of each target's bytes AT PLAN TIME (null: the plan
   *  intends to create that path). Never part of a result — `executeEdit` uses it
   *  to check, immediately before the first write, that the bytes it is about to
   *  replace are the bytes the plan was computed from. */
  preImages: Record<string, string | null>
  /** the same read's byte length, per target (null: to be created).
   *  Free — `readPreImage` already holds the bytes — and it is what lets the
   *  envelope report a real byte count without a second read of every file. */
  preImageBytes: Record<string, number | null>
  /** which batch entry planned each target, and that entry's mode.
   *  A single-mode call reports entry 0 and its own mode, so the envelope has one
   *  shape for both. */
  owners: Record<string, { entry: number; mode: Exclude<EditMode, "batch"> }>
  /** batch only — the entry each change came from, in plan order. */
  batch?: Array<{ entry: number; mode: Exclude<EditMode, "batch">; files: string[]; importPruning?: ImportPruneReport }>
  /** `delete` only: the import-cleanup outcome to declare on the result. */
  importPruning?: ImportPruneReport
}

// ── batch ─────────────────────────────────────────────────────────
//
// WHY. A symbol mode edits ONE file and one symbol in it. The edits an agent
// actually has in front of it are plural and unrelated: a rename that must follow
// into the three files that call it, a header added to the two new modules of a
// feature, four small fixes found by one test run. Doing that as N calls pays the
// heavy half of the cost N times — each call formats its file, validates it,
// reindexes it, and takes its own plan→commit window — and leaves the working tree
// half-edited whenever one of the N is refused. It also gives the caller no single
// answer to "what did this change?".
//
// WHAT THIS IS. One plan over all of it, then ONE cycle: one pre-image check, one
// write loop, one formatting pass, one validation pass, one reindex, and one
// rollback envelope. The failure properties are the ones the single modes already
// have and are not special-cased here: nothing is written until every entry has
// planned successfully, so a refusal is a refusal of the whole call; the pre-image
// check reads the WHOLE batch before the first write (`preImages` is shared across
// entries), so a file that moved is caught before anything is touched; and a
// failure after some writes rolls every committed file back with its exact bytes
// and mode.

/** The modes a batch ENTRY may carry. `batch` is deliberately absent: a batch
 *  inside a batch would nest without a visible bound. */
export const BATCH_ENTRY_MODES = ["write", "update", "insert", "delete", "refactor"] as const

/** Options that belong to the batch as a whole and are REFUSED inside an entry.
 *  A per-entry `dryRun` would plan one edit and apply another; a per-entry
 *  `format` would make the one formatting pass mean two different things. */
export const BATCH_WIDE_OPTIONS = ["dryRun", "format", "edits", "files"] as const

/**
 * The resource bound on a batch, counted in PLANNED EDITS (entries × files after
 * fan-out), which is what the work is proportional to.
 *
 * This is a capability limit, not a safety judgement: the plan, the snapshots, the
 * formatting pass, the validation pass and the reindex all hold every target at
 * once, and a batch result carries each target's before/after text. The number is
 * declared here, named in the refusal, and read by the gates, so a caller that
 * hits it is told the limit rather than meeting a timeout.
 */
export const MAX_BATCH_EDITS = 200

export type BatchEntry = { entry: number; mode: Exclude<EditMode, "batch">; request: EditRequest }

/**
 * Turn a batch request into concrete single-mode requests, one per planned edit,
 * or refuse it. Pure and exported, so the boundary layer, the gates and the
 * engine all expand a batch the same way (script/m13/verify-edit-batch.ts reads
 * THIS function rather than restating its rules).
 *
 * The fan-out rule, stated once: when `files` is present it SUPPLIES `filePath` to
 * every entry, so each entry applies once per listed file and an entry must not
 * name its own file. When `files` is absent every entry names its own target, the
 * way the single-mode call it mirrors does.
 */
export function expandBatchRequest(request: EditRequest): BatchEntry[] {
  const specs = request.edits
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("batch requires a non-empty `edits` array — one entry per edit, each with its own mode (write|update|insert|delete|refactor)")
  }
  const files = request.files
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("batch: `files` must be a non-empty array of project-relative paths — omit it to let each entry name its own filePath")
    }
    const seen = new Map<string, number>()
    for (const [i, file] of files.entries()) {
      if (typeof file !== "string" || file.trim() === "") throw new Error(`batch: files[${i}] must be a non-empty project-relative path`)
      const prior = seen.get(file)
      if (prior !== undefined) {
        throw new Error(`batch: files[${i}] repeats ${file} (already listed as files[${prior}]) — \`files\` fans every entry out over the list, and two entries on one file would be planned from the same pre-edit bytes`)
      }
      seen.set(file, i)
    }
  }
  const batch: BatchEntry[] = []
  for (const [i, raw] of specs.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`batch entry ${i} must be an object carrying its own mode (write|update|insert|delete|refactor)`)
    }
    const spec = raw as EditRequest
    if (String(spec.mode) === "batch") {
      throw new Error(`batch entry ${i} must not itself be a batch — the entries are the five single-file modes: ${BATCH_ENTRY_MODES.join(" | ")}`)
    }
    if (!(BATCH_ENTRY_MODES as readonly string[]).includes(String(spec.mode))) {
      throw new Error(`batch entry ${i} requires a mode of ${BATCH_ENTRY_MODES.join("|")} (got ${JSON.stringify(spec.mode ?? null)}) — an entry with no mode would otherwise pass every per-mode check silently`)
    }
    const mode = spec.mode as Exclude<EditMode, "batch">
    const wide = BATCH_WIDE_OPTIONS.filter((option) => (spec as Record<string, unknown>)[option] !== undefined)
    if (wide.length > 0) {
      throw new Error(`batch entry ${i} must not set ${wide.join(", ")} — ${wide.length === 1 ? "that option belongs" : "those options belong"} to the batch as a whole, because a batch previews, formats and reindexes ONCE; set ${wide.join(", ")} on the batch request itself`)
    }
    if (files !== undefined) {
      if (typeof spec.filePath === "string") {
        throw new Error(`batch entry ${i} sets filePath (${spec.filePath}) and the batch sets \`files\` — \`files\` supplies the target of every entry, so an entry must not also name one`)
      }
      for (const file of files) batch.push({ entry: i, mode, request: { ...spec, filePath: file } })
    } else {
      batch.push({ entry: i, mode, request: { ...spec } })
    }
  }
  if (batch.length > MAX_BATCH_EDITS) {
    throw new Error(
      `batch: ${batch.length} planned edits exceeds the limit of ${MAX_BATCH_EDITS} (${specs.length} entr${specs.length === 1 ? "y" : "ies"}${files ? ` × ${files.length} file(s)` : ""}) — split the batch, or lower the entry count and the fan-out list. The limit bounds one plan, one formatting pass, one validation pass and one reindex, which all hold every target at once.`,
    )
  }
  return batch
}

/**
 * Read an edit target's pre-image ONCE: the decoded text the plan works from, and
 * the byte hash the commit re-checks against (). Returning both from one
 * read is what makes the check exact rather than approximate — a second read would
 * have its own window, and `readFileSync(path, "utf8")` cannot be hashed back into
 * the bytes it came from (see the note in `executeEdit`).
 */
function readPreImage(
  file: string,
  preImages: Map<string, string | null>,
  preImageBytes: Map<string, number | null>,
): { existed: boolean; text: string } {
  if (!existsSync(file)) {
    preImages.set(file, null)
    preImageBytes.set(file, null)
    return { existed: false, text: "" }
  }
  const bytes = readFileSync(file)
  preImages.set(file, createHash("sha256").update(bytes).digest("hex"))
  preImageBytes.set(file, bytes.length)
  return { existed: true, text: bytes.toString("utf8") }
}

async function planEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditPlan> {
  const preImages = new Map<string, string | null>()
  const preImageBytes = new Map<string, number | null>()
  const plan = await planEditInto(projectPath, projectId, request, preImages, preImageBytes)
  return {
    ...plan,
    preImages: Object.fromEntries(preImages),
    preImageBytes: Object.fromEntries(preImageBytes),
    owners: Object.fromEntries(
      plan.changes.map((change) => [change.path, { entry: 0, mode: request.mode as Exclude<EditMode, "batch"> }]),
    ),
  }
}

/**
 * plan every entry of a batch into ONE plan, or write nothing.
 *
 * Two things are deliberate here and both are load-bearing:
 *
 *   * `preImages` is SHARED across entries, so the commit's pre-image check covers
 *     the whole batch at once — the same check, read by the same function
 *     (`preImageMismatches`), over every target instead of one. A batch that
 *     checked each file as it reached it would have a window per file; this has
 *     one window for the call.
 *   * a second entry that resolves to a file an earlier entry already planned is
 *     REFUSED, by index, rather than composed. Both plans were computed from the
 *     same pre-edit bytes, so applying both would drop the first one's change on
 *     the floor — the silent lost update this mode exists to make impossible.
 *
 * A failure in any entry's plan propagates with the entry named; planning never
 * writes, so the batch is refused as a whole.
 */
async function planBatch(projectPath: string, projectId: string, request: EditRequest): Promise<EditPlan> {
  const entries = expandBatchRequest(request)
  const preImages = new Map<string, string | null>()
  const preImageBytes = new Map<string, number | null>()
  const changes: EditPlanChange[] = []
  const warnings: string[] = []
  const owners: Record<string, { entry: number; mode: Exclude<EditMode, "batch"> }> = {}
  // One report row per ENTRY (not per expansion), so `batch.length` is the number
  // of `edits` and a fan-out entry lists every file it reached. A row per planned
  // edit would repeat the entry index and make the count mean something the caller
  // cannot read off their own request.
  const batchRows = new Map<number, { entry: number; mode: Exclude<EditMode, "batch">; files: string[] }>()
  let renamedFiles = 0
  let renamedSites = 0
  let sawSummary = false
  for (const { entry, mode, request: concrete } of entries) {
    let planned: Omit<EditPlan, "preImages" | "preImageBytes" | "owners">
    try {
      planned = await planEditInto(projectPath, projectId, concrete, preImages, preImageBytes)
    } catch (e: any) {
      const target = typeof concrete.filePath === "string" ? ` ${concrete.filePath}` : ""
      throw new Error(`batch entry ${entry} (${mode}${target}): ${e?.message ?? String(e)}`)
    }
    for (const change of planned.changes) {
      const prior = owners[change.path]
      if (prior) {
        throw new Error(
          `bb_edit wrote nothing: batch entries ${prior.entry} and ${entry} both resolve to ${relativeTo(projectPath, change.path)} — each entry is planned from the file's pre-edit bytes, so applying both would discard one of them. Edit that file in one entry, or make a second bb_edit call after this one.`,
        )
      }
      owners[change.path] = { entry, mode }
      changes.push(change)
    }
    for (const warning of planned.warnings) warnings.push(`batch entry ${entry}: ${warning}`)
    if (planned.summary) {
      sawSummary = true
      renamedFiles += planned.summary.renamedFiles
      renamedSites += planned.summary.renamedSites
    }
    const row: { entry: number; mode: Exclude<EditMode, "batch">; files: string[]; importPruning?: ImportPruneReport } =
      batchRows.get(entry) ?? { entry, mode, files: [] }
    row.files.push(...planned.changes.map((change) => relativeTo(projectPath, change.path)))
    if (planned.importPruning) row.importPruning = planned.importPruning
    batchRows.set(entry, row)
  }
  return {
    changes,
    warnings,
    summary: sawSummary ? { renamedFiles, renamedSites } : undefined,
    preImages: Object.fromEntries(preImages),
    preImageBytes: Object.fromEntries(preImageBytes),
    owners,
    batch: [...batchRows.values()],
  }
}

async function planEditInto(
  projectPath: string,
  projectId: string,
  request: EditRequest,
  preImages: Map<string, string | null>,
  preImageBytes: Map<string, number | null>,
): Promise<Omit<EditPlan, "preImages" | "preImageBytes" | "owners">> {
  const warnings: string[] = []
  if (request.mode === "write") {
    if (!request.filePath) throw new Error("write requires filePath")
    const target = resolveSafeEditPath(projectPath, request.filePath)
    const pre = readPreImage(target, preImages, preImageBytes)
    const after = String(request.content ?? request.newContent ?? "")
    // refused BEFORE the plan is returned, so a `dryRun: true` call
    // reports the same refusal the real call would — a preview that says "ok"
    // about a write the commit then refuses is a preview of a different call.
    const refusal = writeGuardMessage(relativeTo(projectPath, target), { existed: pre.existed, before: pre.text, after }, request.overwrite)
    if (refusal) throw new Error(refusal)
    return { changes: [{ path: target, before: pre.text, after }], warnings }
  }

  const symbolName = request.mode === "insert" ? request.targetSymbolName : request.symbolName
  if (!symbolName) throw new Error(`${request.mode} requires ${request.mode === "insert" ? "targetSymbolName" : "symbolName"}`)
  const match = await uniqueSymbol(projectId, symbolName, request.filePath, request.lineStart, request.allowStaleIndex === true, projectPath, warnings)
  resolveSafeEditPath(projectPath, match.fileId)
  const original = readPreImage(match.fileId, preImages, preImageBytes).text

  // parse the file once, lazily — the declaration-range normalisation needs
  // it in update/insert/delete, and update/insert already parse for other
  // reasons, so this replaces those parses rather than adding one.
  let originalParse: SafetyParse | null | undefined
  const parsedOriginal = async (): Promise<SafetyParse | null> => {
    if (originalParse === undefined) {
      try {
        originalParse = await parseForSafety(match.fileId, original)
      } catch {
        originalParse = null
      }
    }
    return originalParse
  }
  const declaredRange = async (): Promise<{ start: number; end: number } | null> => {
    const parsed = await parsedOriginal()
    if (!parsed) return null
    return declarationRangeOf(parsed, symbolName, match.byteStart, match.byteEnd)
  }

  if (request.mode === "update") {
    const newContent = String(request.newContent ?? request.content ?? "")
    // A fragment-safe update. The documented contract (registry example) is
    // full-declaration replacement, but a BODY FRAGMENT ("return 42") is a
    // legitimate request that must not replace the ENTIRE declaration span. If
    // newContent does not declare the symbol itself, it is treated as the new
    // body — or refused, when the language exposes no body node to splice:
    // the declaration and signature are kept, only the body block changes.
    //
    // WHICH of the two it is is now a parse verdict, not a name-adjacent
    // keyword guess — see contentDeclaresSymbol above for the measured defect
    // this replaces (a full method declaration spliced into its own body in
    // Kotlin/C#/Dart, reported as success).
    if (await contentDeclaresSymbol(match.fileId, newContent, symbolName, match.symbolType)) {
      // replace the DECLARATION's range, not the indexed span, when the two
      // differ (see declarationRangeOf: Java/Kotlin index from the name).
      const range = (await declaredRange()) ?? { start: match.byteStart, end: match.byteEnd }
      return { changes: [{ path: match.fileId, before: original, after: replaceRange(original, range.start, range.end, withNewline(newContent, dominantNewline(original))) }], warnings }
    }
    const parsed = await parsedOriginal()
    if (!parsed) throw new Error(`update ${symbolName}: cannot parse ${path.basename(match.fileId)} to locate a body block`)
    const body = findSymbolBody(parsed, match.byteStart, match.byteEnd)
    if (body && original[body.startIndex] === "{") {
      const open = body.startIndex
      const close = body.endIndex - 1
      const inner = original.slice(open + 1, close)
      const innerIndent = inner.includes("\n") ? computeInnerIndent(original, body) : lineLeadingWhitespace(original, open) + indentUnit(original)
      // splice with the FILE's line ending. This concatenated a literal "\n",
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
    // `before`/`after` anchor on the DECLARATION, not the indexed span. On a Java
    // method the span starts at the name, so an anchor taken from the raw span
    // would insert between the return type and the name (`int <new code>
    // target()` — a syntax error at best); Kotlin behaves the same after `fun `.
    if (position === "before" || position === "after") {
      const anchor = (await declaredRange()) ?? { start: match.byteStart, end: match.byteEnd }
      start = end = position === "before" ? anchor.start : anchor.end
    }
    if (position === "inside-top" || position === "inside-bottom") {
      const parsed = await parsedOriginal()
      if (!parsed) throw new Error(`cannot insert inside ${symbolName}: ${path.basename(match.fileId)} could not be parsed`)
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
    // `replacement` is assembled from literal "\n" in every branch above, so
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
    // remove the DECLARATION, not the indexed span — deleting a Java method
    // by its name-anchored span left the return type behind (`int ` alone in the
    // class body), which failed validation after a perfectly legitimate delete.
    const removal = (await declaredRange()) ?? { start: match.byteStart, end: match.byteEnd }
    const deleted = replaceRange(original, removal.start, removal.end, "")
    // dangling-reference guard. Relationship edges alone are not
    // trustworthy (proven on rake: symbol had zero edges while real call sites
    // existed). Scan the post-delete content for remaining AST reference sites
    // of the deleted name — a forced delete must never be silent about them.
    const parsedAfter = await parseForSafety(match.fileId, deleted)
    const leftovers = parsedAfter.occurrences
      .filter((o) => o.text === symbolName && isReferenceSite(o, ""))
      .map((o) => `line ${o.startLine}: ${o.parentType || "reference"}`)

    // check the files that IMPORT this module, not only this one.
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
    // A forced delete may bypass evidence that leaves no textual leftover: a call
    // reached through a namespace import (`import * as m; m.sym()`) names no
    // specifier occurrence and no in-file reference, so it is invisible to the
    // leftover scan and would otherwise disappear without a word. The index still
    // records those callers, so the forced answer states the count it overrode.
    if (request.force === true && callers > 0) {
      warnings.push(`delete ${symbolName} (forced): ${callers} indexed caller(s) were bypassed by force=true — the index still records them; review with bb_graph or bb_impact before relying on this deletion`)
    }
    const pruneReport = await ImportPruner.pruneWithReport(deleted, match.fileId)
    const prunedContent = pruneReport.content ?? deleted
    if (pruneReport.removedBindings.length > 0) {
      warnings.push(`delete ${symbolName}: removed ${pruneReport.removedBindings.length} import binding(s) the deletion made dead — ${pruneReport.removedBindings.join(", ")}`)
    }
    if (!pruneReport.attempted && pruneReport.reason) {
      warnings.push(`delete ${symbolName}: import cleanup was not attempted — ${pruneReport.reason}`)
    }
    // `content` is the rewritten TEXT the change already carries; it does not
    // belong in the result (a delete answer would echo the whole file back).
    const importPruning: ImportPruneReport = pruneReport.attempted
      ? { attempted: true, language: pruneReport.language, removedBindings: pruneReport.removedBindings }
      : { attempted: false, language: pruneReport.language, removedBindings: [], reason: pruneReport.reason }
    return { changes: [{ path: match.fileId, before: original, after: prunedContent }], warnings, importPruning }
  }

  const newName = String(request.newName ?? "")
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) throw new Error("refactor requires a valid identifier newName")
  // A rename that targets the name it already has covers one site and changes
  // nothing; reporting "1 site(s) across 1 file(s)" over identical bytes is a
  // success message for a no-op. Refused by name before any plan is built.
  if (newName === symbolName) {
    throw new Error(`refactor ${symbolName} → ${newName}: the new name is the current name; a rename must change the identifier. No change was made.`)
  }
  const raw = await BrainDatabase.getRawInstance(projectId)

  // ── D2/ cross-file coverage that does not depend on a NON-NULL source ───
  //
  // MEASURED (script/m71/diagnose-refactor-evidence.ts, probe-refactor-completeness.ts):
  // a cross-file call site is stored as a `calls` row with `source_symbol_id = NULL`
  // whenever the call is not inside an indexed symbol — a MODULE-TOP-LEVEL call is
  // the ordinary case, legitimate since — and `brain_relationship` has NO
  // file column, so such a row cannot name the file it lives in. The previous query
  // INNER JOINed `brain_symbol` on `source_symbol_id`, which discarded exactly those
  // rows: the edge existed, the query returned 0 rows, and the rename reported
  // "1 site(s) across 1 file(s)" while the calling file kept the old name.
  //
  // The file that contains such a call is the file that IMPORTS the declaration, and
  // `brain_import` is the table that records it — INCLUDING THE ALIAS, which the
  // rename needs: `import { target as t }` must rewrite the SPECIFIER and must leave
  // the caller's chosen local name `t` alone.
  //
  // Measured shape → index evidence → behaviour BEFORE this fix:
  //
  //   import { target } + `target()` at top level  {name:target, as:null, './a'}  call NOT renamed (NULL source)
  //   import { target } + `return target()`         {name:target, as:null, './a'}  CALL renamed, `import { target }` LEFT STALE
  //   import { target as t } + `t()`                {name:target, as:t,    './a'}  nothing renamed
  //   import { target }, no call site               {name:target, as:null, './a'}  specifier left stale
  //   export { target } from './a' (barrel)         {name:target, as:null, './a'}  barrel left stale
  //   import { other } from './a' + local `target`  {name:other,  as:null, './a'}  correctly untouched
  //   import './a' (side effect)                    {name:'./a'}                   correctly untouched
  //
  // `resolved_symbol_id` is NULL in every measured case, so it is not the signal;
  // the (imported_name, imported_as, import_path) triple is.
  const callerRows = raw.prepare(
    "SELECT DISTINCT f.id AS fileId, f.path AS path, s.byte_start AS byteStart, s.byte_end AS byteEnd, r.relationship_type AS relType " +
    "FROM brain_relationship r " +
    "LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id " +
    "LEFT JOIN brain_file f ON f.id = s.file_id " +
    "WHERE r.target_symbol_id = ? AND r.relationship_type IN ('calls','instantiates','references','uses')",
  ).all(match.id) as Array<{ fileId: string | null; path: string | null; byteStart: number | null; byteEnd: number | null; relType: string }>
  // A row with no source symbol carries no file (measured above): it is evidence
  // that a cross-file reference EXISTS, and the import route below is what makes it
  // reachable. Counted rather than discarded, so the closing warning can be honest
  // about what this rename could not reach.
  const locatableCallerRows = callerRows.filter((r) => r.path != null && r.byteStart != null)
  const sourcelessCallerRows = callerRows.filter((r) => r.path == null)

  const declRelPath = projectRelativePath(raw, projectId, match.fileId, projectPath)
  const importers = new Map<string, { fileId: string; bindings: Array<{ line: number | null; aliased: boolean }> }>()
  if (declRelPath !== null) {
    const stem = basenameNoExt(match.fileId)
    const importerRows = raw.prepare(
      "SELECT i.file_id AS fileId, f.path AS path, f.relative_path AS relPath, i.imported_name AS importedName, " +
      "       i.imported_as AS importedAs, i.import_path AS spec, i.line_number AS lineNumber " +
      "FROM brain_import i JOIN brain_file f ON f.id = i.file_id " +
      "WHERE i.project_id = ? AND i.is_external = 0 AND i.file_id <> ? AND i.import_path IS NOT NULL " +
      // Only an import that NAMES this symbol is evidence about this symbol. A file
      // that imports another export from the same module (`import { other }`) is not,
      // which is what keeps an unrelated local with the same name out of the rename.
      "AND i.imported_name = ? " +
      "AND (i.import_path = ? OR i.import_path LIKE ? OR i.import_path LIKE ?)",
    ).all(projectId, match.fileId, symbolName, stem, `%/${stem}`, `./${stem}`) as Array<{
      fileId: string; path: string; relPath: string; importedName: string; importedAs: string | null; spec: string; lineNumber: number | null
    }>
    for (const row of importerRows) {
      // The LIKE is a PREFILTER on the specifier's last segment, nothing more: the
      // decision is made by resolveImportToFile, which walks the real path, so a
      // same-stem module in another directory is a different module and never matches.
      if (!resolveImportToFile(row.relPath, row.spec, declRelPath)) continue
      const entry = importers.get(row.path) ?? { fileId: row.fileId, bindings: [] }
      entry.bindings.push({
        line: row.lineNumber ?? null,
        aliased: row.importedAs != null && row.importedAs !== "" && row.importedAs !== symbolName,
      })
      importers.set(row.path, entry)
    }
  }

  // Fail loud on any stale file this plan will rewrite BEFORE renaming anything (no
  // silent partial rename). The declaration file was already freshness-checked by
  // uniqueSymbol(); the importing files are new to this path, and rewriting a
  // specifier in a file that has changed since it was indexed is exactly the silent
  // inconsistency this mode is being fixed for. fileId here is brain_file.id (what
  // checkFileFreshness expects); path is the on-disk location rewritten below.
  const callerFileIds = [...new Set([
    ...locatableCallerRows.map((r) => r.fileId).filter((id): id is string => id != null),
    ...[...importers.values()].map((i) => i.fileId),
  ])].filter((id) => id !== match.fileId)
  if (callerFileIds.length > 0) assertFreshFiles(raw, callerFileIds, `refactor ${symbolName}`)

  // path -> what to rename in that file.
  const fileRanges = new Map<string, RefactorFilePlan>()
  const declEntry = fileRanges.get(match.fileId) ?? { callers: [] }
  declEntry.declaration = { start: match.byteStart, end: match.byteEnd }
  fileRanges.set(match.fileId, declEntry)
  for (const row of locatableCallerRows) {
    if (row.path == null || row.byteStart == null) continue
    const entry = fileRanges.get(row.path) ?? { callers: [] }
    entry.callers.push({ start: row.byteStart, end: row.byteEnd ?? Number.MAX_SAFE_INTEGER, relType: row.relType || "" })
    fileRanges.set(row.path, entry)
  }
  for (const [importerPath, importer] of importers) {
    const entry = fileRanges.get(importerPath) ?? { callers: [] }
    entry.imports = [...(entry.imports ?? []), ...importer.bindings]
    fileRanges.set(importerPath, entry)
  }

  // D2b: a plan is only complete if nothing it has evidence about is left behind.
  // Anything recorded here is a site this rename KNOWS refers to the symbol and
  // could not rewrite; the run is refused rather than reported as a success.
  const unrenamed: string[] = []

  const changes: EditPlanChange[] = []
  let renamedFiles = 0
  let renamedSites = 0
  let declarationRenamed = false
  for (const [file, ranges] of fileRanges) {
    resolveSafeEditPath(projectPath, file)
    const before = readPreImage(file, preImages, preImageBytes).text
    const parsed = await parseForSafety(file, before)
    const sites = new Set<number>()

    const declStart = ranges.declaration
      ? findDeclarationName(parsed.occurrences, symbolName, ranges.declaration.start, ranges.declaration.end)
      : undefined

    // 1. Declaration: rename the symbol's own name identifier exactly once.
    if (declStart != null) { sites.add(declStart); declarationRenamed = true }

    // ONE shadow computation for the whole file, used by EVERY step below: a site
    // inside a scope that re-declares the name belongs to the inner binding, no
    // matter which step found it. MEASURED (case W of
    // script/m71/probe-refactor-completeness.ts): `export function outer(target: ()
    // => number) { return target() }` in a caller file was CORRECTED by the import
    // step and then re-broken by the caller-span step, which had no shadow check at
    // all — `return renamed()` beside a parameter still named `target`. The names
    // below are anchored on the declaration's own name, or (for an importing file)
    // on the import specifier, so the anchor itself is never read as a shadow.
    const importAnchor = parsed.occurrences.find(
      (o) => o.text === symbolName && IMPORT_SPECIFIER_PARENTS.has(o.parentType),
    )?.startIndex
    const shadowScopes = collectShadowScopes(parsed, symbolName, declStart ?? importAnchor ?? 0)

    // 2. COMPLETE reference rename in the declaration file. The old
    // implementation renamed only sites inside index caller spans — when the
    // index had no edge (proven on rake: prerequisite_tasks had zero), real
    // call sites in the SAME file stayed at the old name while the tool
    // reported success. Now every AST-classified reference site of the name in
    // the declaration file is renamed, unless a nested scope shadows the name
    // (those sites belong to the inner symbol). Cross-file callers are still
    // applied on top via index caller spans (step 3).
    const shadowedSites = new Set<number>()
    const isShadowed = (start: number, end: number): boolean =>
      shadowScopes.some((s) => start >= s.start && end <= s.end)
    if (ranges.declaration && declStart != null) {
      for (const o of parsed.occurrences) {
        if (o.text !== symbolName) continue
        if (!isReferenceSite(o, "")) continue
        if (isShadowed(o.startIndex, o.endIndex)) { shadowedSites.add(o.startIndex); continue }
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
        if (!isReferenceSite(o, span.relType)) continue
        // A caller span can CONTAIN a shadow of the name — the function it covers
        // may take a parameter called `target` — and that site is the parameter's,
        // not the symbol's (case W above).
        if (isShadowed(o.startIndex, o.endIndex)) { shadowedSites.add(o.startIndex); continue }
        sites.add(o.startIndex)
      }
    }

    // 4. D2: the IMPORT BINDING itself, plus — when the binding is unaliased — every
    // reference site of the name in the importing file.
    //
    // Renaming a declaration without rewriting the specifier that names it leaves
    // `import { target }` pointing at a name that no longer exists; that is a broken
    // file reported as a successful rename, and MEASURED it happened in the very
    // shape the old gate called green (probe-refactor-completeness.ts case B: the
    // call was renamed, the specifier was not).
    //
    // The sites come from `brain_import`, which is the only index row that names the
    // importing FILE (measured: a `calls` row has no file column and its source
    // symbol is NULL for any call outside an indexed symbol).
    if (ranges.imports?.length) {
      const specifiers = parsed.occurrences.filter((o) => o.text === symbolName && IMPORT_SPECIFIER_PARENTS.has(o.parentType))
      for (const binding of ranges.imports) {
        // Line-precise when the index recorded one: a file may import the same NAME
        // from two modules (`import { target } from './a'` and `… from './b'`), and
        // only the specifier whose module resolves to the declaration may move. If
        // the recorded line matches nothing (drift), fall back to every specifier of
        // the name in this file — bounded to files we already resolved to the
        // declaration, and the leftover check below refuses rather than guess.
        const onLine = binding.line == null ? [] : specifiers.filter((o) => o.startLine === binding.line)
        const chosen = onLine.length > 0 ? onLine : specifiers
        for (const o of chosen) sites.add(o.startIndex)
      }
      if (ranges.imports.some((b) => !b.aliased)) {
        // The import binds the symbol under its own name, so every reference site of
        // that name in this file refers to it — including a call at MODULE TOP
        // LEVEL, which is exactly the site the index stored with a NULL source and
        // the edge query could not reach. Nested scopes that re-declare the name are
        // left alone: those sites belong to the inner binding.
        for (const o of parsed.occurrences) {
          if (o.text !== symbolName) continue
          if (!isReferenceSite(o, "")) continue
          if (isShadowed(o.startIndex, o.endIndex)) { shadowedSites.add(o.startIndex); continue }
          sites.add(o.startIndex)
        }
      }
    }

    // D2b: what this file's evidence covers but the plan does not rename. A
    // deliberately skipped site (a shadowed binding, which belongs to the inner
    // symbol) is not a survivor; anything else is.
    const fileHasEvidence = ranges.declaration != null || (ranges.imports?.length ?? 0) > 0
    if (fileHasEvidence) {
      for (const o of parsed.occurrences) {
        if (o.text !== symbolName) continue
        if (sites.has(o.startIndex) || shadowedSites.has(o.startIndex)) continue
        if (!IMPORT_SPECIFIER_PARENTS.has(o.parentType) && !isReferenceSite(o, "")) continue
        unrenamed.push(`${relativeTo(projectPath, file)}:${o.startLine} (${o.parentType || "reference"})`)
      }
    }

    if (sites.size === 0) continue
    let after = before
    for (const offset of [...sites].sort((a, b) => b - a)) after = replaceRange(after, offset, offset + symbolName.length, newName)
    changes.push({ path: file, before, after })
    renamedFiles++
    renamedSites += sites.size
  }
  // D2b: refuse rather than report a complete rename that left a reference behind.
  // This is the outcome the mode must never call success, so it is a hard error with
  // the sites named, not a warning that scrolls past.
  if (unrenamed.length > 0) {
    throw new Error(`refactor ${symbolName} → ${newName}: ${unrenamed.length} reference(s) this rename found but could not rewrite — ${unrenamed.slice(0, 6).join(", ")}${unrenamed.length > 6 ? ", …" : ""}; reindex the project or rename them manually`)
  }
  // A refactor that resolved ZERO sites changed nothing. Answering ok with
  // "0 site(s) across 0 file(s)" is a success message over a no-op — measured on
  // YAML and Makefile, whose grammars expose no identifier reference for a mapping
  // key or a rule target. A rename that covers nothing is a failure.
  if (renamedSites === 0) {
    throw new Error(`refactor ${symbolName} → ${newName}: resolved 0 rename site(s) in 0 file(s) — the symbol was located but nothing could be renamed (this grammar may expose no identifier node for it, as a YAML key or a Makefile target does not). No change was made.`)
  }
  // A rename must not land on a name the file already declares: renaming
  // `target` onto an existing `existing` in the declaration file would leave TWO
  // declarations of `existing`, which no compiler accepts, while the result would
  // report success. The new name is checked against every file this plan rewrites —
  // one top-level declaration of it is expected in the declaration file (the
  // renamed one) and zero elsewhere.
  const collisions: string[] = []
  for (const change of changes) {
    const parsedAfter = await parseForSafety(change.path, change.after)
    const topLevel = parsedAfter.declaredNames.filter((d) => d.text === newName && !insideStatementBody(parsedAfter, d))
    const expected = change.path === match.fileId && declarationRenamed ? 1 : 0
    for (const extra of topLevel.slice(expected)) {
      const line = parsedAfter.content.slice(0, extra.startIndex).split("\n").length
      collisions.push(`${relativeTo(projectPath, change.path)}:${line} (${extra.declarationType})`)
    }
  }
  if (collisions.length > 0) {
    throw new Error(`refactor ${symbolName} → ${newName}: the new name is already declared — ${collisions.slice(0, 6).join(", ")}${collisions.length > 6 ? ", …" : ""}; renaming onto an existing declaration would leave two declarations with one name. No change was made.`)
  }
  if (request.mode === "refactor") {
    warnings.push(`refactor ${symbolName} → ${newName}: ${renamedSites} site(s) across ${renamedFiles} file(s)`)
    if (sourcelessCallerRows.length > 0) {
      // Honest residual, not a silent one: these edges exist and their call site is
      // not inside an indexed symbol, so the row itself cannot name its file. Every
      // file that IMPORTS the declaration was covered above; a call site in a file
      // that does not import it is out of this rename's reach and is said so.
      warnings.push(`refactor ${symbolName}: ${sourcelessCallerRows.length} cross-file edge(s) to this symbol have no source symbol in the index; ${importers.size} importing file(s) were covered through brain_import, and a call site in a file that does not import the declaration module is not reachable by this rename`)
    }
  }
  return { changes, warnings, summary: request.mode === "refactor" ? { renamedFiles, renamedSites } : undefined }
}

/**
 * the envelope a plan starts with — every target planned, nothing
 * committed. Built from the plan, so a dry run reports the same file set (and the
 * same byte sizes, measured by the plan's own read) that the commit would touch.
 */
function plannedEnvelope(projectPath: string, plan: EditPlan): EditEnvelope {
  return {
    atomic: true,
    entries: plan.changes.map((change) => {
      const owner = plan.owners[change.path] ?? { entry: 0, mode: "write" as const }
      return {
        path: relativeTo(projectPath, change.path),
        entry: owner.entry,
        mode: owner.mode,
        planned: true,
        committed: false,
        restored: false,
        bytesBefore: plan.preImageBytes[change.path] ?? null,
        bytesAfter: null,
      }
    }),
    committed: 0,
    restored: 0,
    failed: [],
  }
}

/**
 * Fill in what actually happened: the two counts, and each file's size ON DISK
 * now. Stat, not inference — after a rollback the size on disk is the restored
 * one whether the new bytes are there or the old ones are back, and a file the
 * call never touched measures as itself.
 */
function closeEnvelope(envelope: EditEnvelope, changes: EditPlanChange[]): EditEnvelope {
  envelope.committed = envelope.entries.filter((entry) => entry.committed).length
  envelope.restored = envelope.entries.filter((entry) => entry.restored).length
  for (const [i, entry] of envelope.entries.entries()) {
    try { entry.bytesAfter = statSync(changes[i].path).size } catch { entry.bytesAfter = null }
  }
  return envelope
}

/**
 * Apply a plan: one pre-image check over EVERY target, one write loop, one
 * formatting pass, one validation pass, one reindex — and one rollback envelope
 * if any of that fails.
 *
 * Shared verbatim by the single modes and by `batch`. That sharing is the point:
 * "a batch gets the same plan-to-commit check" is true because there is one
 * implementation of it, not two that agree today.
 */
async function commitPlan(projectPath: string, projectId: string, request: EditRequest, plan: EditPlan): Promise<EditResult> {
  const { changes, warnings, summary, preImages, batch } = plan
  // the snapshot is BYTES, not a decoded string. The previous snapshot was
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
  // The invariant every mode's plan must hold, asserted rather than assumed: one
  // change per file. Two entries for one path would each be planned from the same
  // pre-edit bytes, so the write loop would replace the file twice and keep only
  // the second — a lost update with no error. `batch` refuses this by entry index
  // while planning (`planBatch`); this is the backstop for every other mode.
  if (snapshots.size !== changes.length) {
    const seen = new Set<string>()
    const dupes = changes.filter((change) => (seen.has(change.path) ? true : (seen.add(change.path), false))).map((change) => relativeTo(projectPath, change.path))
    throw new Error(`bb_edit wrote nothing: two planned changes target the same file (${[...new Set(dupes)].join(", ")}) — a plan defect, not a request defect: each change is resolved against the file's pre-edit bytes, so only one of them could ever be applied.`)
  }
  const envelope = plannedEnvelope(projectPath, plan)
  const envelopeByAbs = new Map(changes.map((change, i) => [change.path, envelope.entries[i]]))
  // the plan and this commit are two reads of the same files with a
  // window between them, and until now nothing in that window was checked. The
  // bytes about to be replaced must be the bytes the plan was computed from, or
  // the write applies spans resolved against content that is no longer there —
  // a silent partial overwrite of someone else's edit. Checked for the WHOLE
  // batch before the first write, so a mismatch refuses without half-applying
  // (this is the one failure the rollback envelope cannot express: there is
  // nothing to roll back to, because the file moved out from under the plan).
  const moved = preImageMismatches(
    projectPath,
    preImages,
    new Map([...snapshots].map(([path0, snapshot]) => [path0, snapshot.hash])),
  )
  if (moved.length > 0) {
    throw new Error(
      `bb_edit wrote nothing: ${moved.length} target file(s) changed on disk between planning and committing — ${moved.join(", ")}. The edit was planned from those bytes, so applying it now would overwrite content it never read; re-run the edit to re-plan against the current file.`,
    )
  }
  // which files were ACTUALLY replaced on disk, as opposed to merely
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
      // carry the mode across the rename. renameSync REPLACES the inode, so
      // a 0755 script or a 0600 secret the tool edited came back 0644 — the temp
      // inherits the process umask and nothing preserved the original. An edit
      // that quietly drops a file's permissions is a change the caller never
      // asked for and cannot see in a diff.
      const originalMode = snapshots.get(change.path)!.mode
      renameSync(temporary, change.path)
      // Past this point the file on disk is NOT the pre-edit file, so putting it
      // back is the engine's responsibility.
      committed.push(change.path)
      envelopeByAbs.get(change.path)!.committed = true
      if (originalMode !== null) {
        try { chmodSync(change.path, originalMode) } catch { /* best effort: content is the contract */ }
      }
    }
    // Formatting is measured, not assumed. `formatted` is never
    // `request.format !== false` — the request restated as if it were an outcome —
    // because a caller who trusts it is told a file had been formatted when nothing
    // had run (no mapping), nothing could run (no formatter installed), or the
    // formatter failed (exit 3, `warnings: []`). Each outcome is kept per file.
    const formatting = request.format === false
      ? undefined
      : await Promise.all(changes.map(async (change): Promise<{ path: string } & FormatOutcome & { lineEndingRestored?: boolean }> => {
          const outcome = await BrainSurgicalPatcher.tryAutoFormat(change.path)
          return { path: relativeTo(projectPath, change.path), ...outcome }
        }))
    // A formatter that RAN and failed is an anomaly worth a warning; "no mapping"
    // and "not installed" are not, or every edit in a repo without prettier would
    // warn and train the caller to ignore that channel. Both facts are in `formatting`.
    for (const entry of formatting ?? []) {
      if (entry.ran && !entry.ok) warnings.push(`format: ${entry.path}: ${entry.reason ?? "formatter failed"}`)
    }
    // The engine's splice keeps the FILE's line ending, and a formatter may then
    // rewrite the whole file with its own. `gofmt` does exactly that: a CRLF file
    // edited with the default formatter came back with five lone LFs. The caller
    // asked for an edit, not for a line-ending migration, so a CRLF file is put
    // back to CRLF and the repair is declared on that file's formatting entry.
    if (formatting) {
      const absoluteByRel = new Map(changes.map((change) => [relativeTo(projectPath, change.path), change.path]))
      for (const entry of formatting) {
        if (!entry.ran || !entry.ok) continue
        const absolute = absoluteByRel.get(entry.path)
        const preImage = absolute ? snapshots.get(absolute)?.bytes : null
        if (!absolute || !preImage) continue
        if (dominantNewline(preImage.toString("utf8")) !== "\r\n") continue
        const current = readFileSync(absolute, "utf8")
        if (!hasLoneLf(current)) continue
        writeFileSync(absolute, withNewline(current, "\r\n"), "utf8")
        entry.lineEndingRestored = true
      }
    }
    for (const change of changes) await validateFile(change.path, readFileSync(change.path, "utf8"))
    // the reindex call now applies the bounded post-pass internally
    // (snapshot + repair + scoped enrichment/gravity), so "AI edits a function
    // → seconds later the DB has it with resolved relationships" holds here.
    const reindexResult = await reindexFilesParallel(projectId as any, realpathSync(projectPath), changes.map((change) => ({ path: change.path, type: snapshots.get(change.path)!.existed ? "modified" as const : "added" as const })))
    // `reindexed` is MEASURED from the reindex result, never asserted. The reindex
    // reports per-file failures in `errors`/`errorDetail` instead of throwing; the
    // edit stands (the bytes on disk are correct and validated), but claiming the
    // index is current would be false, so the failure is named in warnings.
    const reindexErrors = reindexResult.errors ?? 0
    const reindexed = reindexErrors === 0
    if (reindexErrors > 0) {
      const named = (reindexResult.errorDetail ?? []).slice(0, 5).map((d) => `${relativeTo(projectPath, d.file)} (${d.error})`)
      warnings.push(`reindex: ${reindexErrors} file(s) failed to reindex — the edit stands but the index is NOT current for them${named.length > 0 ? `: ${named.join("; ")}` : ""}; run bb index --changed`)
    }
    return {
      mode: request.mode,
      dryRun: false,
      changes: changes.map((change) => ({ ...change, after: readFileSync(change.path, "utf8") })),
      formatted: formatting !== undefined && formatting.length > 0 && formatting.every((entry) => entry.ok),
      ...(formatting !== undefined ? { formatting } : {}),
      validated: true,
      reindexed,
      // visible derived-data outcome — never a silent deferral.
      derived: reindexResult.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 },
      warnings: warnings.length > 0 ? warnings : undefined,
      summary,
      ...(batch ? { batch } : {}),
      ...(plan.importPruning ? { importPruning: plan.importPruning } : {}),
      envelope: closeEnvelope(envelope, changes),
    }
  } catch (error) {
    // Roll back every file to its pre-edit snapshot, then scrub any orphaned
    // .bb-edit-* temp files so a mid-loop failure never leaks temp artifacts.
    //
    // each restore is its own try/catch and the loop does NOT stop on the
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
        envelopeByAbs.get(file)!.restored = true
      } catch (e: any) {
        rollbackFailures.push(`${file}: ${e?.message ?? String(e)}`)
        // a restore that failed is named in the envelope with its reason,
        // beside the file's path, instead of being represented only by a count.
        envelope.failed.push({ path: relativeTo(projectPath, file), reason: e?.message ?? String(e) })
      }
    }
    for (const t of temps) { try { rmSync(t, { force: true }) } catch {} }
    if (rollbackFailures.length > 0) {
      ;(error as any).rollbackFailures = rollbackFailures
      ;(error as any).message = `${(error as any).message} — ROLLBACK INCOMPLETE, these files were NOT restored: ${rollbackFailures.join("; ")}`
    }
    // The caller's real question about a failed edit is per-file ("is my tree back?"),
    // and the handler cannot answer it from a boolean. The envelope is attached to
    // the error, measured from disk after the restore loop.
    ;(error as any).envelope = closeEnvelope(envelope, changes)
    throw error
  }
}

/**
 * The one entry point for every mode. A batch is planned as a single plan
 * (`planBatch`) and then committed by exactly the same code path as an `update`
 * of one symbol — including the pre-image check, which sees every target of the
 * batch because the batch's plan recorded every target.
 */
export async function executeEdit(projectPath: string, projectId: string, request: EditRequest): Promise<EditResult> {
  // A refusal raised while PLANNING wrote nothing at all, and the docs promise a
  // per-file answer on refusals too. The honest envelope for that state is the
  // empty one: no file planned, none committed, none restored — a caller (and a
  // batch caller in particular) can branch on the envelope without having to
  // special-case "the error object has no envelope because it failed early".
  let plan: EditPlan
  try {
    plan = request.mode === "batch"
      ? await planBatch(projectPath, projectId, request)
      : await planEdit(projectPath, projectId, request)
  } catch (error: any) {
    if (error && typeof error === "object" && error.envelope === undefined) {
      error.envelope = { atomic: true, entries: [], committed: 0, restored: 0, failed: [] }
      error.refusedBeforeWriting = true
    }
    throw error
  }
  if (request.dryRun === true) {
    const { changes, warnings, summary, batch } = plan
    // A preview reports the same set of files the commit would touch, in the same
    // order, with the same measured pre-edit sizes — and claims nothing more:
    // nothing is committed, so nothing is committed and nothing was restored.
    return {
      mode: request.mode,
      dryRun: true,
      changes,
      formatted: false,
      validated: false,
      reindexed: false,
      warnings: warnings.length > 0 ? warnings : undefined,
      summary,
      ...(batch ? { batch } : {}),
      ...(plan.importPruning ? { importPruning: plan.importPruning } : {}),
      envelope: plannedEnvelope(projectPath, plan),
    }
  }
  return commitPlan(projectPath, projectId, request, plan)
}
