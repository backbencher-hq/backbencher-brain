// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_annotations: it reads the annotation
// store for one symbol, one file's copy of a symbol, or the whole project, and
// declares its bound and its absence.
// WHICH TOOL IT SERVES — bb_annotations (mutability read, requiresIndex false,
//   modes: none — the tool takes no mode option; every call is a read).
// WHY IT IS SHAPED THIS WAY — three invariants force the design. (1) A read must
//   not write: the store is opened byte-read-only, a project with no store is a
//   DECLARED ABSENCE rather than a database created by asking, and a legacy
//   store without the annotation table is absence rather than a schema change.
//   (2) A reader must agree with the editor: a requested symbol resolves to both
//   name forms the index publishes (simple name AND qualified name), the same
//   pair the hover matches, so a note written under either form is found from
//   either spelling. (3) A bounded read declares its bound: the page size, the
//   true total, and a reason that names an action the caller can actually take
//   at the declared cap.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotations.md, validation/tools/
//   bb_annotations/** (Phase A audit, contract matrix, real-corpus leg, latency),
//   gates: npx tsx script/m28/verify-annotation-store.ts,
//   npx tsx script/m28/verify-annotation-ui.ts,
//   npx tsx script/m28/verify-mcp-tools.ts, and
//   npx tsx validation/tools/bb_annotations/verify-read-door.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — descriptor.ts, the curation file, the
//   generated page, and the read-door gate (it pins the absence, truncation,
//   canonicalization and name-form contracts asserted here).
// CONTRACTS IT MUST NOT BREAK — the read writes nothing; absence is declared for
//   symbol, path and project shapes; bound and truncation are declared with a
//   true total; a symbol read matches both name forms; path input is canonicalized
//   through the index; no regex.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { canonicalFilePath } from "../../../brain/annotation-store"

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/** One resolved filter target: the stored names a symbol request matches, and
 *  whether the request named an indexed symbol at all. */
export interface AnnotationNameSet {
  names: string[]
  /** true when the index publishes the requested string as a symbol name or a
   *  qualified name; false when it does not, and the request falls back to the
   *  literal stored name so an arbitrary name is still findable. */
  indexed: boolean
}

/**
 * Resolve the caller's symbol spelling to the set of stored `symbol_name` values
 * a note about that symbol can carry.
 *
 * The editor matches a note either by the symbol's simple name or by its
 * qualified name — the two forms the index publishes and a caller reads in
 * source. This resolver returns BOTH forms for every symbol the request names,
 * so reading by `Widget.render` finds a note written as `render` and reading by
 * `render` finds a note written as `Widget.render`. A request that names no
 * indexed symbol falls back to itself, because the write door records the
 * caller's spelling faithfully and such a note must still be findable.
 */
export function resolveAnnotationNames(raw: any, projectId: string, symbol: string): AnnotationNameSet {
  const rows = raw.prepare(
    `SELECT name AS n FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?)
     UNION
     SELECT qualified_name AS n FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?) AND qualified_name IS NOT NULL`,
  ).all(projectId, symbol, symbol, projectId, symbol, symbol) as Array<{ n: string | null }>
  const names = [...new Set(rows.map((row) => row.n).filter((name): name is string => typeof name === "string" && name.length > 0))]
  return names.length > 0 ? { names, indexed: true } : { names: [symbol], indexed: false }
}

/**
 * The declared truncation reason. The advice depends on the limit actually used:
 * at the declared cap "raise the limit" is an action the caller cannot take, so
 * the reason names the action that remains — narrow the filter.
 */
export function truncationReason(limit: number, totalCountIfKnown: number): string {
  const next = limit >= MAX_LIMIT
    ? `the limit is already the declared cap (${MAX_LIMIT}), so narrow the filter (symbol or path) to read the rest`
    : `raise limit (max ${MAX_LIMIT}) or narrow the filter`
  return `limit ${limit} reached; ${totalCountIfKnown} annotations match this query — ${next}.`
}

interface AbsenceShape {
  symbol: string | null
  path: string | null
  includeNameLevel: boolean
  nameLevelIncluded: boolean
  /** true when no annotation store exists for the project: the absence is the
   *  whole store's, and this read created nothing. */
  storeAbsent: boolean
  absenceNote: string
}

function absenceResult(shape: AbsenceShape) {
  // The absence answer is a real (empty) page, not a hollow placeholder: the
  // bound fields are computed from an actual empty set, so the same code path
  // decides truncation for an empty answer and for a full one.
  const annotations: any[] = []
  const totalCountIfKnown = 0
  const truncated = totalCountIfKnown > annotations.length
  return textResult(JSON.stringify({
    symbol: shape.symbol,
    path: shape.path,
    includeNameLevel: shape.includeNameLevel,
    nameLevelIncluded: shape.nameLevelIncluded,
    storeAbsent: shape.storeAbsent,
    symbolIndexed: null,
    annotations,
    count: annotations.length,
    totalCountIfKnown,
    truncated,
    truncationReason: truncated ? truncationReason(0, totalCountIfKnown) : null,
    declaredAbsent: annotations.length === 0,
    absenceNote: shape.absenceNote,
  }, null, 2))
}

export const handler: ToolHandler = async (args, { projectId }) => {
  const symbol = args.symbol === undefined || args.symbol === null || String(args.symbol).trim() === "" ? null : String(args.symbol).trim()
  const givenPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
  const includeNameLevel = args.includeNameLevel === true
  const limitRaw = args.limit === undefined || args.limit === null ? DEFAULT_LIMIT : Number(args.limit)
  if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) return textResult(`bb_annotations: limit must be a number between 1 and ${MAX_LIMIT}`, true)
  const limit = Math.floor(limitRaw)
  // With a symbol, a name-level note is about the symbol the caller asked for,
  // so it always applies. Without one, the flag decides whether the path answer
  // is the file's own notes or also the project's name-level set.
  const nameLevelIncluded = symbol !== null || includeNameLevel
  const label = symbol !== null && givenPath !== null ? `'${symbol}' in '${givenPath}'` : symbol !== null ? `'${symbol}'` : givenPath !== null ? `'${givenPath}'` : null

  // A READ OPEN. The store is opened byte-read-only: no migrations, no healer,
  // no schema creation, no WAL movement. Asking this tool for annotations is not
  // a reason for a store to come into existence — a read on a never-indexed
  // project used to create projects/<pid>/brain.db and answer "declared absent",
  // and a read on a legacy store used to recreate a dropped annotation table.
  // A missing or uninitialised store is therefore an absence this answer
  // declares, not a file this call writes.
  let raw: any
  try {
    raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const storeMissing = message.startsWith("no index found for project") || message.startsWith("index not initialised for project")
    if (!storeMissing) throw error
    return absenceResult({
      symbol,
      path: givenPath,
      includeNameLevel,
      nameLevelIncluded,
      storeAbsent: true,
      absenceNote: label !== null
        ? `no annotation store exists for this project yet, so no annotations are stored for ${label} — absence declared; nothing was created by this read`
        : "no annotation store exists for this project yet — nothing has been written, and this read created nothing",
    })
  }
  // A store that exists without the annotation table is a store in which nothing
  // has been written. Declaring that absence is true; creating the table here
  // would make a read a write.
  const hasAnnotationTable = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_annotation'").get()
  if (!hasAnnotationTable) {
    return absenceResult({
      symbol,
      path: givenPath,
      includeNameLevel,
      nameLevelIncluded,
      storeAbsent: true,
      absenceNote: label !== null
        ? `this project's store has no annotation table yet, so no annotations are stored for ${label} — absence declared; this read created no schema`
        : "this project's store has no annotation table yet — nothing has been written, and this read created no schema",
    })
  }

  // The same canonicalization the write door applies, so a reader that filters by
  // `./src/a.ts` finds the note a writer stored as `src/a.ts`.
  const canonicalPath = givenPath === null ? null : canonicalFilePath(raw, projectId, givenPath).path
  const resolved = symbol === null ? null : resolveAnnotationNames(raw, projectId, symbol)
  const namePredicate = resolved === null ? null : `symbol_name IN (${resolved.names.map(() => "?").join(",")})`
  const nameParams: unknown[] = resolved === null ? [] : [...resolved.names]
  const COLUMNS = "id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated"
  // The ORDER BY carries a deterministic tiebreak: several agents writing in the
  // same millisecond share a time_updated, and without a second key their
  // relative order is whatever SQLite happens to produce — so "read back what I
  // just wrote" would not be reproducible.
  const ORDER = "ORDER BY time_updated DESC, id"
  // The flag governs the PATH-ONLY shape. With a symbol as well, a name-level
  // note about THAT symbol genuinely applies — it is about the symbol the caller
  // asked for, not a global answer — so the symbol+path shape keeps including it
  // regardless of the flag.
  const pathOnlyClause = includeNameLevel ? "(symbol_path = ? OR symbol_path IS NULL)" : "symbol_path = ?"
  const symbolPathClause = "(symbol_path = ? OR symbol_path IS NULL)"
  let where: string
  let params: unknown[]
  if (symbol && canonicalPath !== null) {
    where = `project_id = ? AND ${namePredicate} AND ${symbolPathClause}`
    params = [projectId, ...nameParams, canonicalPath]
  } else if (symbol) {
    where = `project_id = ? AND ${namePredicate}`
    params = [projectId, ...nameParams]
  } else if (canonicalPath !== null) {
    where = `project_id = ? AND ${pathOnlyClause}`
    params = [projectId, canonicalPath]
  } else {
    where = `project_id = ?`
    params = [projectId]
  }
  const rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE ${where} ${ORDER} LIMIT ?`).all(...params, limit) as any[]
  // A bounded read declares its bound: the page size, the true total, and
  // whether the limit actually dropped rows. Without the total a caller cannot
  // distinguish a short page from a complete one.
  const totalCountIfKnown = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_annotation WHERE ${where}`).get(...params) as any).c
  const truncated = totalCountIfKnown > rows.length
  return textResult(JSON.stringify({
    symbol,
    path: canonicalPath,
    includeNameLevel,
    nameLevelIncluded,
    storeAbsent: false,
    symbolIndexed: resolved === null ? null : resolved.indexed,
    annotations: rows,
    count: rows.length,
    totalCountIfKnown,
    truncated,
    truncationReason: truncated ? truncationReason(limit, totalCountIfKnown) : null,
    declaredAbsent: rows.length === 0,
    absenceNote: rows.length === 0
      ? (symbol && canonicalPath !== null
        ? `no annotations stored for '${symbol}' in '${canonicalPath}' — absence declared, never guessed`
        : symbol
          ? `no annotations stored for '${symbol}' — absence declared, never guessed`
          : canonicalPath !== null
            ? `no annotations stored for '${canonicalPath}' — absence declared, never guessed`
            : "no annotations stored for this project yet")
      : null,
  }, null, 2))
}
