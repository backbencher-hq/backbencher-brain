// src/brain/annotation-store.ts — the SINGLE owner of annotation identity.
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
