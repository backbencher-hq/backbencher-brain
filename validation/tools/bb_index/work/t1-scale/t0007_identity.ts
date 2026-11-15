// src/lsp/identity.ts — M55.T1 (issue #770): the ONE identity resolver.
//
// Truth Rule 2 (docs/IDE-HONESTY-CONTRACT.md §15): identity is stated. Every
// surface that names a symbol to the server — the hover's action args,
// `bb/graph`, `bb/impact`, call hierarchy, references — resolves that name
// through THIS module, and every substitution it makes is declared on the
// surface that made it. Before M55 the decision lived inside the impact door
// and the graph door re-implemented its own call; a member target could be
// substituted for its owning declaration with nothing said about it (found
// live: the constructor graph opened titled `Store` after the user asked for
// a constructor — a silent relabel).
//
// Declared resolution outcomes:
//   direct              the name is a root the traversal engine resolves
//                       itself; nothing was substituted, nothing is labeled
//   owning-declaration  an indexed member the engine's traversable-type
//                       whitelist excludes (a constructor, a plain member)
//                       roots through its OWNING declaration; the caller MUST
//                       render `MemberResolution` (panel title, header note,
//                       wire payload) — a substitution the user cannot see is
//                       a defect, not a convenience
//   none (null)         no honest resolution exists; the caller keeps its
//                       declared error. A genuinely absent symbol never
//                       silently becomes someone else's impact.
//
// The rules (mechanical, never a guess):
//   1. the name resolves to stored symbols and the member is UNIQUE — exactly
//      one row, or several rows disambiguated to exactly one by the caller's
//      defining-file hint (every real repo has one `constructor` per class);
//      several rows with no usable hint stay ambiguous -> null
//   2. that symbol's type is outside the engine's traversable whitelist
//      (otherwise the direct path already handled it) -> null
//   3. the member has no stored reverse edges of its own (its own impact set
//      would be non-empty; rooting through the owner would drop real
//      dependencies) -> null
//   4. the owner (owner_symbol_id) exists, is unique and is traversable -> the
//      owner row, else null
//
// Gated by script/m55/verify-identity.ts (the M55.T1 suite) and reused by the
// M44.U5 impact gate, which pins the same decision through the impact door.

/** The hover's server-resolved member identity (M53 X1 closure, generalised
 *  here by M55.T1): a name plus the DEFINING FILE that disambiguates
 *  same-name members. Every real repo has several `constructor` rows (one per
 *  class) — a name-only fallback cannot resolve them. The hover's action args
 *  already carry the file; every transport must pass it through. */
export interface MemberIdentityHint {
  name: string
  /** Defining file as the hover carries it (absolute or relative). Matched
   *  against the stored relative path component-aligned (the stored path is a
   *  suffix of the hint). Absent means the name alone must be unique. */
  file?: string
}

/** What a caller renders when it substituted one symbol for another. */
export interface MemberResolution {
  through: "owning-declaration"
  memberName: string
  ownerName: string
  memberFile?: string
}

/** The db surface the resolver needs (structural, so tests can stub). */
export interface IdentityDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
}

/** The engine's traversable-type whitelist, as the resolver applies it. */
export const IDENTITY_TRAVERSABLE_TYPES: readonly string[] = [
  "function",
  "method",
  "class",
  "interface",
  "trait",
  "struct",
  "enum",
  "macro",
]

/** Component-aligned suffix match: the stored relative path must be a
 *  path-suffix of the hint ("src/greeter.ts" matches
 *  "/home/u/repo/src/greeter.ts"), never a bare substring. ONE decision,
 *  shared by every door. */
export function memberFileMatches(hint: string, stored: string): boolean {
  const h = hint.replace(/\\/g, "/")
  const s = stored.replace(/\\/g, "/")
  if (h === s) return true
  return h.endsWith("/" + s)
}

/** M55 spelling of the same decision (the name the new surfaces use; the
 *  M44-era name above is kept as the export the closed gates anchor on). */
export const memberIdentityFileMatches = memberFileMatches

/** Resolve a member name to its OWNING declaration, or null when no honest
 *  resolution exists (see the header's rules). */
export function resolveMemberIdentity(
  db: IdentityDb,
  projectId: string,
  symbolName: string,
  fileHint?: string,
): { id: string; name: string; file: string } | null {
  try {
    const TRAVERSABLE: readonly string[] = IDENTITY_TRAVERSABLE_TYPES
    const memberRows = db
      .prepare(
        `SELECT s.id, s.name, s.symbol_type AS symbolType, s.owner_symbol_id AS ownerId,
                COALESCE(f.relative_path, f.path, '') AS file
         FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.name = ?`,
      )
      .all(projectId, symbolName) as Array<{ id: string; name: string; symbolType: string; ownerId: string | null; file: string }>
    // Rule 1: the member must be UNIQUE. Several same-name members resolve
    // ONLY through the caller's file hint; without a usable hint the name
    // stays ambiguous — declared error, never a guessed owner. A hint that
    // matches none of the rows is treated as stale-index noise: a single-row
    // resolution still stands on the index's own truth.
    let member = memberRows[0]
    if (memberRows.length > 1) {
      if (!fileHint) return null
      const narrowed = memberRows.filter((r) => memberFileMatches(fileHint, r.file))
      if (narrowed.length !== 1) return null
      member = narrowed[0]
    }
    if (!member) return null
    // Rule 2: the direct path handles traversable types — no fallback here.
    if (TRAVERSABLE.includes(member.symbolType)) return null
    // Rule 3: the member's OWN reverse edges exist -> its own impact set is
    // real; resolving through the owner would drop dependencies. Declared
    // error (unchanged behavior) is the honest answer for that shape.
    const inbound = db
      .prepare(
        `SELECT COUNT(*) AS c FROM brain_relationship
         WHERE project_id = ? AND target_symbol_id = ?
           AND relationship_type IN ('calls','instantiates','extends','implements')`,
      )
      .get(projectId, member.id) as { c: number }
    if (typeof inbound?.c === "number" && inbound.c > 0) return null
    // Rule 4: the owner must exist and be traversable (the cascade needs a
    // real root; the owner prefix cascade in the engine does the rest).
    if (!member.ownerId) return null
    const ownerRows = db
      .prepare(
        `SELECT s.id, s.name, s.symbol_type AS symbolType,
                COALESCE(f.relative_path, f.path, '') AS file
         FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE s.project_id = ? AND s.id = ?`,
      )
      .all(projectId, member.ownerId) as Array<{ id: string; name: string; symbolType: string; file: string }>
    if (ownerRows.length !== 1) return null
    const owner = ownerRows[0]!
    if (!TRAVERSABLE.includes(owner.symbolType)) return null
    return { id: owner.id, name: owner.name, file: owner.file }
  } catch {
    // Unreadable index: null -> the caller's declared error stands (never a
    // crash disguised as resolution).
    return null
  }
}

/** The declared resolution record for a substitution that DID happen. Callers
 *  attach this to their payload so every renderer can state it (Truth Rule 2).
 *  Returns undefined for a direct resolution — nothing was substituted, so
 *  nothing is labeled. */
export function memberResolutionRecord(
  requestedName: string,
  ownerName: string,
  fileHint?: string,
): MemberResolution {
  return {
    through: "owning-declaration",
    memberName: requestedName,
    ownerName,
    ...(fileHint ? { memberFile: fileHint } : {}),
  }
}
