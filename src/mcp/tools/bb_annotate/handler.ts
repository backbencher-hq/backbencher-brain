// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_annotate: validates the request, writes one provenance-enforced annotation row in place, and reports whether an editor surface can actually show it.
// WHICH TOOL IT SERVES — bb_annotate (mutability write, requiresIndex false, modes: annotate).
// WHY IT IS SHAPED THIS WAY — the row's identity is the (project, symbol, author, path)
//   location owned by src/brain/annotation-store.ts, so re-annotation updates instead of
//   flooding; the reply's `surfacing` block is a MEASUREMENT against the index, and the
//   measurement must be the JOINT predicate the editors use (the hover and the graph badge
//   select notes by symbol name AND file), because two individually-true halves can still
//   render nowhere; every rejection is explicit and declared, never a silent truncation.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotate.md (generated), docs/tools/bb_annotations.md,
//   validation/tools/bb_annotate/** (AUDIT.json, PHASE-A-PROBES.json, LATENCY.json,
//   REAL-CORPUS.json, phase-a-probes.ts, latency.ts); gates:
//   npx tsx script/m28/verify-annotation-store.ts, npx tsx script/m28/verify-annotation-ui.ts,
//   npx tsx script/verify-tool-docs.ts --only bb_annotate.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/descriptor.ts,
//   script/tool-docs/curation/bb_annotate.ts, docs/tools/bb_annotate.md,
//   script/m28/verify-annotation-store.ts, and src/brain/annotation-store.ts when the
//   location/reachability vocabulary changes.
// CONTRACTS IT MUST NOT BREAK — author_class is always 'agent' for tool writes; one note
//   per author per location; declared refusals for the bounded fields; `surfacing.editor`
//   is the joint name+file truth; the write stays inside brain_annotation (never source,
//   never index content); regex policy (this file contains no regex).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { annotationId, annotationReachability, canonicalFilePath } from "../../../brain/annotation-store"

/** Declared bounds, counted in code points so an astral glyph is one character. */
const MAX_BODY_CHARS = 2000
const MAX_TOOL_IDENTITY_CHARS = 200
const MAX_SYMBOL_CHARS = 500
const MAX_PATH_CHARS = 1024

function codePointLength(text: string): number {
  return [...text].length
}

/** A label is a name, not a document: control characters and line breaks are refused.
 *  A character-code scan, not a pattern match — the condition is a range test. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Does the indexed file at `relativePath` itself declare the name the note was written
 *  under? This is the second half of the editor's selection rule: `hover.ts` resolves the
 *  symbol under the cursor and then selects notes whose `symbol_name` equals the symbol's
 *  name or qualified name AND whose `symbol_path` is NULL or that file. A name match in
 *  one file plus a path match for a different file renders nowhere, so reachability may
 *  only be reported true when BOTH halves name the same file. */
function fileDeclaresSymbol(raw: any, projectId: string, relativePath: string, name: string): boolean {
  const row = raw
    .prepare(
      "SELECT COUNT(*) AS n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND f.project_id = ? AND f.relative_path = ? AND (s.name = ? OR s.qualified_name = ?)",
    )
    .get(projectId, projectId, relativePath, name, name) as { n: number } | undefined
  return (row?.n ?? 0) > 0
}

export const handler: ToolHandler = async (args, { projectId }) => {
  const symbol = String(args.symbol ?? "").trim()
  const body = String(args.body ?? "")
  const givenPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
  const toolIdentity = String(args.toolIdentity ?? "bb_annotate(mcp)")

  if (!symbol) return textResult("bb_annotate requires symbol", true)
  if (!body.trim()) return textResult("bb_annotate requires a non-empty body — an empty note is a refusal, not a silent no-op", true)
  const bodyChars = codePointLength(body)
  if (bodyChars > MAX_BODY_CHARS) {
    return textResult(`bb_annotate: body exceeds the declared limit of ${MAX_BODY_CHARS} chars (got ${bodyChars}) — declared refusal, not silent truncation`, true)
  }
  const symbolChars = codePointLength(symbol)
  if (symbolChars > MAX_SYMBOL_CHARS) {
    return textResult(`bb_annotate: symbol exceeds the declared limit of ${MAX_SYMBOL_CHARS} chars (got ${symbolChars}) — declared refusal, not silent truncation`, true)
  }
  if (givenPath !== null) {
    const pathChars = codePointLength(givenPath)
    if (pathChars > MAX_PATH_CHARS) {
      return textResult(`bb_annotate: path exceeds the declared limit of ${MAX_PATH_CHARS} chars (got ${pathChars}) — declared refusal, not silent truncation`, true)
    }
  }
  const identityChars = codePointLength(toolIdentity)
  if (identityChars > MAX_TOOL_IDENTITY_CHARS) {
    return textResult(`bb_annotate: toolIdentity exceeds the declared limit of ${MAX_TOOL_IDENTITY_CHARS} chars (got ${identityChars}) — declared refusal`, true)
  }
  if (hasControlCharacter(toolIdentity)) {
    return textResult("bb_annotate: toolIdentity must not contain control characters or line breaks — it is a name, not a document (declared refusal)", true)
  }

  const now = Date.now()
  const raw = await BrainDatabase.getRawInstance(projectId as any)

  // One spelling per file: store the index's own relative path, so the hover that selects
  // by (relative_path or absolute path) finds the note regardless of how it was typed.
  const canonical = canonicalFilePath(raw, projectId, givenPath)
  const annotationPath = givenPath === null ? null : canonical.path

  // Reachability is MEASURED, and it is one joint question, not two independent ones.
  const reach = annotationReachability(raw, projectId, symbol)
  const pathKnown = givenPath === null || canonical.matched
  const fileMatched: boolean | null = givenPath === null ? null : canonical.matched ? fileDeclaresSymbol(raw, projectId, canonical.path, symbol) : false
  const editorSurfaced = reach.surfaced && pathKnown && (fileMatched === null || fileMatched)

  const statement = !reach.surfaced
    ? reach.statement
    : givenPath !== null && !canonical.matched
      ? `'${symbol}' matches ${reach.matchedNames.length} indexed symbol name(s), but no indexed file matches the path '${givenPath}', so NO editor surface will show this note: the hover scopes notes to the file under the cursor. It is stored under that spelling and readable through bb_annotations.`
      : fileMatched === false
        ? `'${symbol}' matches ${reach.matchedNames.length} indexed symbol name(s), but none of them is declared in the indexed file '${canonical.path}', so NO editor surface will show this note: the hover and graph badge select notes by the file under the cursor. It is stored under that spelling and readable through bb_annotations.`
        : reach.statement

  const id = annotationId({ projectId, symbol, path: annotationPath, authorClass: "agent" })

  // Read the location before writing it: one note per location is the model, but
  // "last writer wins, silently" is not. The second writer learns whose note it replaced
  // and receives the previous body so it can merge instead of clobbering.
  const prior = raw
    .prepare(
      "SELECT author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name = ? AND author_class = 'agent' AND COALESCE(symbol_path, '') = COALESCE(?, '')",
    )
    .get(projectId, symbol, annotationPath) as { author_class: string; tool_identity: string; body: string; time_created: number; time_updated: number } | undefined
  // `!= null`: better-sqlite3 returns undefined for a miss, bun:sqlite returns null.
  const isReplacement = prior != null && prior.body !== body

  raw
    .prepare(
      `INSERT INTO brain_annotation (id, project_id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated)
       VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?)
       ON CONFLICT(project_id, symbol_name, author_class, COALESCE(symbol_path, '')) DO UPDATE
         SET body = excluded.body, tool_identity = excluded.tool_identity, time_updated = excluded.time_updated`,
    )
    .run(id, projectId, symbol, annotationPath, toolIdentity, body, now, now)

  // Re-read by the NATURAL key, not by id: an upsert onto a row that predates the current
  // id scheme keeps that row's original id, so reading by id would report a missing row.
  const updated = raw
    .prepare(
      "SELECT id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name = ? AND author_class = 'agent' AND COALESCE(symbol_path, '') = COALESCE(?, '')",
    )
    .get(projectId, symbol, annotationPath) as any

  return textResult(
    JSON.stringify(
      {
        stored: true,
        annotation: updated,
        provenance:
          "author_class is enforced 'agent' for tool writes — recorded, not claimed. tool_identity is the caller's own label: recorded verbatim, never verified.",
        ...(isReplacement
          ? {
              replaced: {
                authorClass: prior.author_class,
                toolIdentity: prior.tool_identity,
                previousBody: prior.body,
                previousCreatedAt: prior.time_created,
                previousUpdatedAt: prior.time_updated,
                note: `this location already held a note written by '${prior.tool_identity}'; it has been replaced. Read it above and merge if both matter — only one note is kept per location by design.`,
              },
            }
          : {}),
        surfacing: {
          editor: editorSurfaced,
          nameMatched: reach.surfaced,
          pathMatched: pathKnown,
          fileMatched,
          matchedAs: reach.matchedAs,
          matchedNames: reach.matchedNames,
          statement,
          ...(givenPath === null
            ? { pathNote: "no path given — a NAME-level note, shown for the symbol wherever it appears" }
            : canonical.matched
              ? { pathNote: `path resolved to the indexed spelling '${canonical.path}'` }
              : { pathWarning: `no indexed file matches '${givenPath}', so no editor surface will scope this note to a file; it is stored under that spelling and readable through bb_annotations` }),
        },
      },
      null,
      2,
    ),
  )
}
