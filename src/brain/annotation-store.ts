// src/brain/annotation-store.ts — the SINGLE owner of annotation identity,
// reachability, and path spelling.
//
// WHY THIS MODULE EXISTS (measured, not theoretical):
// The annotation row id used to be derived by concatenating symbol and path and
// flattening every character outside [A-Za-z0-9-] to '_':
//
//     `bbann-${projectId}-${symbol}-${path ?? ""}-agent`.replace(/[^a-zA-Z0-9-]/g, "_")
//
// That map is NOT injective — '.', '/', '_' and ' ' all collapse to the same
// '_' — so two structurally different, individually legal writes claimed one
// primary key and the second silently destroyed the first. Reproduced on a
// real corpus through the real tool: `symbol=Foo.Bar, path=x/y.ts` and
// `symbol=Foo_Bar, path=x/y.ts` produced the same id, both calls returned
// `stored: true`, and the first note was gone. Real corpora supply exactly
// these characters (symbol names like `Clyde.ClydeApplicationController`,
// paths like `Cocoa/UserDefaults.icl`), so this was reachable with real data.
//
// THE FIX HAS TWO LAYERS, and each closes the other's failure mode:
//
//   1. `annotationId` is a length-delimited (unambiguous) sha256 over the
//      location tuple. Distinct tuples therefore produce distinct ids by
//      construction — no character class can alias another, and the id stays
//      bounded no matter how deep a path is.
//   2. A UNIQUE expression index on (project_id, symbol_name, author_class,
//      COALESCE(symbol_path, '')) declares "one note per author per location"
//      IN THE SCHEMA, so location identity no longer depends on an encoded
//      string at all. COALESCE is required: symbol_path is nullable and SQLite
//      treats NULLs as distinct in a UNIQUE index, so without it a path-less
//      note would never conflict with itself.
//
// Layer 2 is why the fix needs no destructive migration: the write upserts on
// the NATURAL key, so a pre-existing row that still carries the old flattened
// id is updated in place (its id preserved) instead of being duplicated.
// And because `id` remains a PRIMARY KEY, even the residual case of a digest
// collision is refused LOUDLY by the constraint rather than silently
// overwriting a note.
//
// The same key backs the upsert, so the two can never disagree about what
// "this location" means.

import { createHash } from "node:crypto"

/** The one location an annotation belongs to: a symbol, optionally in a file,
 *  written by one author class. This tuple IS the identity of a note. */
export interface AnnotationLocation {
  projectId: string
  symbol: string
  /** null = a note about the symbol NAME, not about one file's copy of it. */
  path: string | null
  authorClass: string
}

/** Additive, idempotent index that declares location identity in the schema.
 *  Part of the annotation DDL so it is created on fresh DBs AND re-applied
 *  (IF NOT EXISTS) on every pre-existing DB — the same wire as ANNOTATION_DDL. */
export const ANNOTATION_LOCATION_INDEX_DDL = `
    CREATE UNIQUE INDEX IF NOT EXISTS brain_annotation_location_idx
      ON brain_annotation(project_id, symbol_name, author_class, COALESCE(symbol_path, ''));
  `

/** Length-prefix each field so the concatenation is unambiguously decodable —
 *  the property the old flattening map lacked. NUL is not a legal character in
 *  a path or a symbol name, but the length prefix makes the separator choice
 *  irrelevant either way. */
function encodeLocation(location: AnnotationLocation): string {
  return [location.projectId, location.symbol, location.path ?? "", location.authorClass]
    .map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`)
    .join("")
}

/**
 * The primary key for one annotation row. A pure function of the location, so
 * re-annotating the same location always yields the same id (the upsert
 * contract every existing gate depends on), and distinct locations never alias.
 */
export function annotationId(location: AnnotationLocation): string {
  return `bbann-${createHash("sha256").update(encodeLocation(location)).digest("hex")}`
}

// ─────────────────────────────────────────────────────────────────────────────
// REACHABILITY: can the editor ever show this note?
//
// The write door used to answer `surfaces: "this note renders in the editor
// hover section and graph badge"` for EVERY note. That is a claim about the
// future, made unconditionally, and it is false for a large class of real
// inputs — measured on a real corpus (clyde, 3862 symbols):
//
//   * The editor matched an annotation's `symbol_name` against
//     `brain_symbol.name` ONLY. The index ALSO publishes `qualified_name` for
//     1046 of those symbols (27%), and those are exactly the names an agent
//     reads in source. 1046 of 1046 — 100% — of the qualified-name rows were
//     unreachable: the note stored, read back, and was reported as surfacing,
//     and no editor surface would ever match it.
//   * A path was matched only against `brain_file.relative_path` and
//     `brain_file.path`. A writer who passed `./src/a.ts` (a spelling agents
//     produce constantly) matched neither, so that note was invisible too.
//
// So the tool told a true-sounding story about a surface it could not deliver.
// `annotationReachability` is the measured answer, so the write door can report
// reachability instead of promising it.
// ─────────────────────────────────────────────────────────────────────────────

/** How a note written under `name` can reach the editor, measured against the
 *  real index rather than assumed. */
export interface AnnotationReachability {
  /** true when at least one indexed symbol carries this name, so an editor
   *  surface that resolves that symbol will render the note. */
  surfaced: boolean
  /** Which spellings reached it — `name` for a simple name, `qualifiedName`
   *  when it matched an indexed symbol's qualified name. */
  matchedAs: Array<"name" | "qualifiedName">
  /** The indexed symbol names this note would attach to. */
  matchedNames: string[]
  /** Human-readable statement of what is and is not true. Never empty. */
  statement: string
}

/**
 * Measure whether an annotation written under `name` can be shown by the editor.
 *
 * The editor resolves a symbol, then selects that symbol's notes by its `name`
 * and its `qualified_name` (hover.ts / graph_request.ts both do). So a note is
 * reachable exactly when the given string is one of those two. Both are queried
 * here from the same predicate the editor uses, so the write door's claim and
 * the editor's behaviour cannot drift apart again.
 */
export function annotationReachability(raw: any, projectId: string, name: string): AnnotationReachability {
  const asName = raw
    .prepare("SELECT DISTINCT name FROM brain_symbol WHERE project_id = ? AND name = ?")
    .all(projectId, name) as Array<{ name: string }>
  const asQualified = raw
    .prepare("SELECT DISTINCT qualified_name FROM brain_symbol WHERE project_id = ? AND qualified_name = ?")
    .all(projectId, name) as Array<{ qualified_name: string }>

  const matchedNames: string[] = []
  const matchedAs: Array<"name" | "qualifiedName"> = []
  if (asName.length > 0) { matchedAs.push("name"); matchedNames.push(...asName.map((r) => r.name)) }
  if (asQualified.length > 0) { matchedAs.push("qualifiedName"); matchedNames.push(...asQualified.map((r) => r.qualified_name)) }

  const both = matchedAs.length === 2
  const statement = matchedAs.length === 0
    ? `no indexed symbol carries the name '${name}' as either a name or a qualified name, so NO editor surface will show this note — it is stored and readable through bb_annotations only. Re-index the project, or annotate a name the index publishes.`
    : both
      ? `'${name}' matches ${asName.length} indexed symbol name(s) and ${asQualified.length} qualified name(s), so this note renders in the editor hover section and graph badge.`
      : matchedAs[0] === "name"
        ? `'${name}' matches ${asName.length} indexed symbol name(s), so this note renders in the editor hover section and graph badge.`
        : `'${name}' matches ${asQualified.length} indexed qualified name(s) and no plain name, so this note renders for a symbol that carries it as a qualified name.`

  return { surfaced: matchedAs.length > 0, matchedAs, matchedNames: [...new Set(matchedNames)], statement }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH CANONICALIZATION: one spelling per file — the index's own.
//
// A file has several spellings a writer can produce (`src/a.ts`, `./src/a.ts`,
// `/abs/project/src/a.ts`), and the editor matches only two of them. Storing
// the writer's spelling verbatim meant one file could hold two notes and one of
// them would never render.
//
// `canonicalFilePath` resolves whatever the writer passed to the ONE spelling
// the index itself stores (`brain_file.relative_path`) — by asking the index,
// not by string surgery. A path that resolves to no indexed file is returned
// unchanged with `matched: false`, so a note about something the index has never
// seen is still stored faithfully, and the write door can say so instead of
// promising a surface that does not exist.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPath {
  /** The index's own spelling, or the input unchanged when nothing matched. */
  path: string
  /** Whether an indexed file row was found for the given path. */
  matched: boolean
}

/**
 * Resolve a caller-supplied path to the spelling the index stores, so a note's
 * `symbol_path` always matches what the editor selects on.
 *
 * Handles the three spellings that matter: the index's relative path, the
 * absolute path, and a `./`-prefixed relative path. Returns the input unchanged
 * with `matched: false` when no indexed file matches.
 */
export function canonicalFilePath(raw: any, projectId: string, given: string | null): CanonicalPath {
  if (given === null) return { path: "", matched: false }
  const direct = raw
    .prepare("SELECT relative_path FROM brain_file WHERE project_id = ? AND (relative_path = ? OR path = ?) LIMIT 1")
    .get(projectId, given, given) as { relative_path: string } | undefined
  if (direct) return { path: direct.relative_path, matched: true }

  // `./src/a.ts` is the common third form; the index never stores it. Resolve
  // it through the index rather than by string surgery, so a project root that
  // genuinely contains a `./`-prefixed path still wins on the direct match above.
  if (given.startsWith("./")) {
    const stripped = raw
      .prepare("SELECT relative_path FROM brain_file WHERE project_id = ? AND (relative_path = ? OR path = ?) LIMIT 1")
      .get(projectId, given.slice(2), given) as { relative_path: string } | undefined
    if (stripped) return { path: stripped.relative_path, matched: true }
  }
  return { path: given, matched: false }
}
