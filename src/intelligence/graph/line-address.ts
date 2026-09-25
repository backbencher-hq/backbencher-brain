// src/intelligence/graph/line-address.ts — M62.A1 (issue #875).
//
// The SINGLE owner of what a stored call-site line IS and how it may be shown.
//
// The defect this replaces (measured at HEAD, 2026-09-16): the indexer writes
// `brain_relationship.line_number = 0` as a literal for every row (only some
// analyzers store a real line — scala today; M59 extends this per language).
// The graph engine read `row.lineNumber || node.line`, so a stored `0` meant
// "use the calling symbol's declaration line" — and that value was presented as
// the call site, typed non-nullable, on the agent-facing (`bb_graph`) and hub
// (`bb/graph`) surfaces. Measured on the audit machine: 3,034 of 3,034 stored
// relationship rows carried `0`.
//
// M59 changes the store to "a real line, or NULL" (NULL = unknown). This module
// makes the three states explicit BEFORE that lands, so the change is absorbed
// with no consumer rewrite (plan D-5):
//
//   real                 line > 0        -> kind "call-site"
//   legacy-placeholder   line === 0      -> unknown (the indexer's literal)
//   not-stored           null/undefined  -> unknown
//   unusable             present, but not a positive integer (negative,
//                        fractional, NaN, Infinity) -> unknown, and NEVER
//                        quietly replaced by a substitute: a corrupt store is
//                        a store-contract violation, and a labeled position
//                        would hide it.
//
// Laws (gated by script/m62/verify-address.ts and, for consumers, A2):
//   L1 a position is produced ONLY from a real stored line (> 0, integer)
//   L2 a substitute is ALWAYS labeled — a bare `file:line` is producible only
//      for kind "call-site"
//   L3 unknown is a first-class value with a declared note (and the note names
//      the RIGHT reason); it is never rendered as line 0, as line 1, or as a
//      bare `file:line`
//   L4 the 1-based (index) -> 0-based (LSP) step is ONE rule; this module's
//      `addressLine0` is drift-gated against src/lsp/positions.ts by A2
//   L5 pure: no fs, no clock, no db — every consumer and every mutant exercises
//      the same code, and the verdict cannot differ by caller

import type { CallSiteAddress } from "../contracts"

/** What a stored `brain_relationship.line_number` actually is. The first two
 *  are the store's declared states (M59); `unusable` is a store-contract
 *  violation — present, but not a position. */
export type StoredLineState = "real" | "legacy-placeholder" | "not-stored" | "unusable"

/** The declared note for every non-exact address. These strings are the
 *  vocabulary the surfaces render; they are gated (A1) so a renderer cannot
 *  invent its own wording and call it the same thing. */
export const ADDRESS_NOTES = {
  legacy: "call site not stored (legacy index: line_number is 0)",
  notStored: "call site not stored (no line_number in the index)",
  unusable: "call site not stored (unusable line_number in the index)",
  substitute: "this is the calling symbol's declaration, not the call site",
} as const

/** Every address kind, in the declared order the doc generator lists them. */
export const ADDRESS_KINDS = ["call-site", "declaration", "unknown"] as const

/** Classify a raw stored line. Only a positive integer is a position. */
export function classifyStoredLine(raw: number | null | undefined): StoredLineState {
  // ABSENT first: the store carried no value at all. This is the only
  // "not-stored" state — a value that exists but is not a position is a
  // different fact and must not be reported as absence.
  if (raw === null || raw === undefined) return "not-stored"
  // Present, but not a usable position: NaN, Infinity, a fraction, a negative
  // integer, or (defensively) a non-number at all. A store-contract
  // violation — unknown, and never quietly replaced by a substitute.
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) return "unusable"
  if (raw > 0) return "real"
  if (raw === 0) return "legacy-placeholder"
  return "unusable"
}

export type AddressInput = {
  /** `brain_relationship.line_number` as stored (1-based when real). */
  storedLine: number | null | undefined
  /** The CALLING symbol's relative file path (the edge's source side), or
   *  "" / null when the store names none. Never invented. */
  file?: string | null | undefined
  /** The calling symbol's own declaration line (1-based) when known — the
   *  ONLY permitted substitute for a missing call site. */
  callerDeclaration?: { line?: number | null | undefined } | null
}

/** Derive the address for one edge's source side. This is the ONLY conversion
 *  from a stored line to something a surface may show. */
export function deriveCallSiteAddress(input: AddressInput): CallSiteAddress {
  const file = typeof input.file === "string" ? input.file : ""
  const state = classifyStoredLine(input.storedLine)
  if (state === "real") {
    return { kind: "call-site", file, line: input.storedLine as number }
  }
  const callerLine = input.callerDeclaration?.line
  // A substitute is permitted for the store's DECLARED unknown states (the
  // legacy literal and NULL). An unusable value is not one of them.
  if (state !== "unusable" && classifyStoredLine(callerLine) === "real") {
    return { kind: "declaration", file, line: callerLine as number, note: ADDRESS_NOTES.substitute }
  }
  const note = state === "legacy-placeholder" ? ADDRESS_NOTES.legacy : state === "unusable" ? ADDRESS_NOTES.unusable : ADDRESS_NOTES.notStored
  return {
    kind: "unknown",
    file,
    line: null,
    note,
  }
}

/** Render an address for a human/machine surface. The ONLY place a position
 *  becomes text: a bare `file:line` is produced for kind "call-site" alone —
 *  every other kind carries its declared note. */
export function formatAddress(a: CallSiteAddress): string {
  const position = a.line === null ? null : a.file.length > 0 ? `${a.file}:${a.line}` : `line ${a.line}`
  if (a.kind === "call-site") return position ?? ADDRESS_NOTES.notStored
  if (position === null) return a.file.length > 0 ? `${a.file} — ${a.note}` : a.note
  return `${position} — ${a.note}`
}

/** The 0-based line an editor may OPEN for this address, or null when no
 *  position is known. Kind "call-site" only: a labeled substitute is not a call
 *  site, and opening it as one would be the same lie in a click-through. The
 *  conversion (1-based index line -> 0-based LSP line) is the position owner's
 *  rule; A2 asserts this equals src/lsp/positions.ts `indexToLsp` on a real
 *  index (no byte/UTF-16 work is involved — an address carries no column). */
export function addressLine0(a: CallSiteAddress): number | null {
  return a.kind === "call-site" ? a.line - 1 : null
}

/** True when the address names an exact stored call site — the predicate every
 *  rendering surface is expected to narrow on (never on a raw line value). */
export function isExactAddress(a: CallSiteAddress): boolean {
  return a.kind === "call-site"
}
