// script/m62/a1-fixture.ts — M62.A1 (issue #875): the fixture, authored BEFORE
// the owner code it constrains (the lane's F7 rule: every improvement lands
// fixture-first).
//
// This file states the REQUIRED behavior independently — it imports nothing
// from the owner, so a mutant that changes the owner cannot change the
// expectation it is judged against. The expectation strings are the required
// vocabulary; the gate compares the owner's output against them verbatim.
//
// The storage facts this fixture encodes (measured at HEAD 2026-09-16):
//   * the indexer writes `brain_relationship.line_number = 0` for every row
//     (`src/ast/parallel-indexer.ts`), so `0` is the LEGACY PLACEHOLDER — it
//     means "no line stored", not "line zero";
//   * analyzers that do emit a line write a real 1-based line (scala today);
//   * M59.A2 changes the store to "a real line, or NULL" — NULL means unknown.
//
// Both unknown reasons are DISTINCT and declared: a legacy 0 and a NULL line
// are both "no position", but the note must say which store state produced it
// (a surface that collapses them loses a diagnostic the owner needs).

export const LEGACY_NOTE = "call site not stored (legacy index: line_number is 0)"
export const NOT_STORED_NOTE = "call site not stored (no line_number in the index)"
export const UNUSABLE_NOTE = "call site not stored (unusable line_number in the index)"
export const SUBSTITUTE_NOTE = "this is the calling symbol's declaration, not the call site"

export type ExpectedAddress =
  | { kind: "call-site"; file: string; line: number }
  | { kind: "declaration"; file: string; line: number; note: string }
  | { kind: "unknown"; file: string; line: null; note: string }

export type AddressCase = {
  name: string
  /** `brain_relationship.line_number` as stored. */
  storedLine: number | null | undefined
  /** The calling symbol's relative file, as the store names it. */
  file: string | null | undefined
  /** The calling symbol's own declaration line (1-based), when known. */
  callerLine: number | null | undefined
  expect: ExpectedAddress
  /** The one permitted rendering of this address. */
  format: string
  /** The 0-based editor line an address may OPEN, or null when none is known. */
  line0: number | null
}

export const A1_CASES: AddressCase[] = [
  {
    name: "real stored line → exact call site (stored wins over any substitute)",
    storedLine: 12,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "call-site", file: "src/a.ts", line: 12 },
    format: "src/a.ts:12",
    line0: 11,
  },
  {
    name: "real stored line on the very first line → LSP line 0 (the boundary)",
    storedLine: 1,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "call-site", file: "src/a.ts", line: 1 },
    format: "src/a.ts:1",
    line0: 0,
  },
  {
    name: "real stored line with no stored file → call site without a path",
    storedLine: 12,
    file: "",
    callerLine: 40,
    expect: { kind: "call-site", file: "", line: 12 },
    format: "line 12",
    line0: 11,
  },
  {
    name: "legacy 0 (the indexer's literal) → LABELED declaration substitute",
    storedLine: 0,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "declaration", file: "src/a.ts", line: 40, note: SUBSTITUTE_NOTE },
    format: `src/a.ts:40 — ${SUBSTITUTE_NOTE}`,
    line0: null,
  },
  {
    name: "NULL (M59.A2 unknown) → LABELED declaration substitute",
    storedLine: null,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "declaration", file: "src/a.ts", line: 40, note: SUBSTITUTE_NOTE },
    format: `src/a.ts:40 — ${SUBSTITUTE_NOTE}`,
    line0: null,
  },
  {
    name: "absent line (undefined) → LABELED declaration substitute",
    storedLine: undefined,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "declaration", file: "src/a.ts", line: 40, note: SUBSTITUTE_NOTE },
    format: `src/a.ts:40 — ${SUBSTITUTE_NOTE}`,
    line0: null,
  },
  {
    name: "legacy 0 and NO usable caller declaration → unknown (legacy reason)",
    storedLine: 0,
    file: "src/a.ts",
    callerLine: 0,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: LEGACY_NOTE },
    format: `src/a.ts — ${LEGACY_NOTE}`,
    line0: null,
  },
  {
    name: "NULL and no caller declaration known → unknown (not-stored reason)",
    storedLine: null,
    file: "src/a.ts",
    callerLine: undefined,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: NOT_STORED_NOTE },
    format: `src/a.ts — ${NOT_STORED_NOTE}`,
    line0: null,
  },
  {
    name: "negative stored line is a corrupt store → unknown with the unusable reason (no substitute)",
    storedLine: -5,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: UNUSABLE_NOTE },
    format: `src/a.ts — ${UNUSABLE_NOTE}`,
    line0: null,
  },
  {
    name: "fractional stored line is not a line → unknown with the unusable reason (no substitute)",
    storedLine: 2.5,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: UNUSABLE_NOTE },
    format: `src/a.ts — ${UNUSABLE_NOTE}`,
    line0: null,
  },
  {
    name: "NaN stored line → unknown with the unusable reason (no substitute)",
    storedLine: Number.NaN,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: UNUSABLE_NOTE },
    format: `src/a.ts — ${UNUSABLE_NOTE}`,
    line0: null,
  },
  {
    name: "Infinity stored line → unknown with the unusable reason (no substitute)",
    storedLine: Number.POSITIVE_INFINITY,
    file: "src/a.ts",
    callerLine: 40,
    expect: { kind: "unknown", file: "src/a.ts", line: null, note: UNUSABLE_NOTE },
    format: `src/a.ts — ${UNUSABLE_NOTE}`,
    line0: null,
  },
  {
    name: "legacy 0, no stored file, usable caller declaration → labeled substitute without a path",
    storedLine: 0,
    file: "",
    callerLine: 7,
    expect: { kind: "declaration", file: "", line: 7, note: SUBSTITUTE_NOTE },
    format: `line 7 — ${SUBSTITUTE_NOTE}`,
    line0: null,
  },
  {
    name: "no stored file and no substitute → the declared reason alone",
    storedLine: 0,
    file: "",
    callerLine: null,
    expect: { kind: "unknown", file: "", line: null, note: LEGACY_NOTE },
    format: LEGACY_NOTE,
    line0: null,
  },
]

// --- The real-index seed -----------------------------------------------------------
// The verifier seeds this into a REAL BrainDatabase and drives the REAL engine
// (`graphTraversal`), so the derivation is proven end-to-end, not only on
// hand-built inputs. Every relationship row targets the one root symbol.

export const SEED = {
  files: {
    "main.ts": "export function root(): void {}\n",
    "a.ts": "export function callerA(): void {}\n",
    "b.ts": "export function callerB(): void {}\n",
    "c.ts": "export function calleeC(): void {}\n",
    "d.ts": "export function calleeD(): void {}\n",
  },
  symbols: [
    { id: "file-1:root", file: "main.ts", name: "root", symbolType: "function", lineStart: 1, lineEnd: 1 },
    { id: "file-2:callerA", file: "a.ts", name: "callerA", symbolType: "function", lineStart: 3, lineEnd: 9 },
    { id: "file-3:callerB", file: "b.ts", name: "callerB", symbolType: "function", lineStart: 7, lineEnd: 12 },
    { id: "file-3:callerNoDecl", file: "b.ts", name: "callerNoDecl", symbolType: "function", lineStart: null, lineEnd: null },
    { id: "file-4:calleeC", file: "c.ts", name: "calleeC", symbolType: "function", lineStart: 4, lineEnd: 6 },
    { id: "file-5:calleeD", file: "d.ts", name: "calleeD", symbolType: "function", lineStart: 2, lineEnd: 2 },
  ],
  relationships: [
    // Caller side: one row per store state, all from real caller symbols.
    { id: "r-real", source: "file-2:callerA", target: "file-1:root", lineNumber: 12 },
    { id: "r-legacy", source: "file-2:callerA", target: "file-1:root", lineNumber: 0 },
    { id: "r-null", source: "file-2:callerA", target: "file-1:root", lineNumber: null },
    { id: "r-b-legacy", source: "file-3:callerB", target: "file-1:root", lineNumber: 0 },
    { id: "r-nodecl-legacy", source: "file-3:callerNoDecl", target: "file-1:root", lineNumber: 0 },
    { id: "r-nodecl-null", source: "file-3:callerNoDecl", target: "file-1:root", lineNumber: null },
    // A present-but-unusable store: the call site must NOT be silently
    // replaced by the caller's declaration — the corruption stays visible.
    { id: "r-unusable", source: "file-2:callerA", target: "file-1:root", lineNumber: -3 },
    // Callee side: the substitute for a missing call site is the CALLING
    // symbol's declaration, which on a depth-0 callee edge is the root itself.
    { id: "r-callee-real", source: "file-1:root", target: "file-4:calleeC", lineNumber: 5 },
    { id: "r-callee-legacy", source: "file-1:root", target: "file-5:calleeD", lineNumber: 0 },
  ],
  /** Required address per stored row id, derived from the facts above. */
  expected: {
    "r-real": { kind: "call-site", file: "a.ts", line: 12 },
    "r-legacy": { kind: "declaration", file: "a.ts", line: 3, note: SUBSTITUTE_NOTE },
    "r-null": { kind: "declaration", file: "a.ts", line: 3, note: SUBSTITUTE_NOTE },
    "r-b-legacy": { kind: "declaration", file: "b.ts", line: 7, note: SUBSTITUTE_NOTE },
    "r-nodecl-legacy": { kind: "unknown", file: "b.ts", line: null, note: LEGACY_NOTE },
    "r-nodecl-null": { kind: "unknown", file: "b.ts", line: null, note: NOT_STORED_NOTE },
    "r-unusable": { kind: "unknown", file: "a.ts", line: null, note: UNUSABLE_NOTE },
    "r-callee-real": { kind: "call-site", file: "main.ts", line: 5 },
    "r-callee-legacy": { kind: "declaration", file: "main.ts", line: 1, note: SUBSTITUTE_NOTE },
  } as Record<string, ExpectedAddress>,
}
