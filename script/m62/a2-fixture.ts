// script/m62/a2-fixture.ts — M62.A2 (issue #876): the fixture for the CONSUMER
// gate, authored before the consumer changes.
//
// Two independent specs live here:
//   1. ADDRESS_SAMPLES — addresses the webview's import-pure mirror must format
//      exactly as the owner formats them (the mirror cannot import the owner,
//      W1, so it is drift-gated instead of shared).
//   2. HUB_MODEL — a hub model whose rows carry each address kind, so the gate
//      can assert the DOM declares what it is showing and never labels an
//      unknown address as a call site.
//
// The addresses are written out longhand (not computed) so a defect in the
// owner or the mirror cannot rewrite the expectation it is judged against.

import { LEGACY_NOTE, NOT_STORED_NOTE, SUBSTITUTE_NOTE } from "./a1-fixture.ts"

export type SampleAddress =
  | { kind: "call-site"; file: string; line: number }
  | { kind: "declaration"; file: string; line: number; note: string }
  | { kind: "unknown"; file: string; line: null; note: string }

export const ADDRESS_SAMPLES: Array<{ name: string; address: SampleAddress; format: string }> = [
  { name: "exact call site", address: { kind: "call-site", file: "src/a.ts", line: 12 }, format: "src/a.ts:12" },
  { name: "exact call site, no path", address: { kind: "call-site", file: "", line: 7 }, format: "line 7" },
  { name: "labeled substitute", address: { kind: "declaration", file: "src/a.ts", line: 40, note: SUBSTITUTE_NOTE }, format: `src/a.ts:40 — ${SUBSTITUTE_NOTE}` },
  { name: "labeled substitute, no path", address: { kind: "declaration", file: "", line: 3, note: SUBSTITUTE_NOTE }, format: `line 3 — ${SUBSTITUTE_NOTE}` },
  { name: "unknown with a path (legacy store)", address: { kind: "unknown", file: "src/a.ts", line: null, note: LEGACY_NOTE }, format: `src/a.ts — ${LEGACY_NOTE}` },
  { name: "unknown without a path (NULL store)", address: { kind: "unknown", file: "", line: null, note: NOT_STORED_NOTE }, format: NOT_STORED_NOTE },
]

/** A hub model whose caller rows carry a call site, a substitute and an
 *  unknown — and whose callee row carries only unknowns (a group that must
 *  never be labeled as if it knew where the call is). */
export const HUB_MODEL = {
  root: { symbolId: "file-1:root", name: "root", file: "main.ts", language: "typescript", line: 1 },
  callers: [
    {
      symbolId: "file-2:callerA",
      name: "callerA",
      file: "a.ts",
      language: "typescript",
      symbolType: "function",
      line: 3,
      isExternal: false,
      relationshipTypes: [{ type: "calls", occurrences: 3 }],
      occurrences: 3,
      rows: [
        { rowId: "r-real", relationshipType: "calls", callSite: { kind: "call-site", file: "a.ts", line: 12 }, depth: 0, confidence: 0.9, isCrossLanguage: false, parentSymbolId: "file-1:root", parentName: "root" },
        { rowId: "r-legacy", relationshipType: "calls", callSite: { kind: "declaration", file: "a.ts", line: 3, note: SUBSTITUTE_NOTE }, depth: 0, confidence: 0.9, isCrossLanguage: false, parentSymbolId: "file-1:root", parentName: "root" },
        { rowId: "r-null", relationshipType: "calls", callSite: { kind: "declaration", file: "a.ts", line: 3, note: SUBSTITUTE_NOTE }, depth: 0, confidence: 0.9, isCrossLanguage: false, parentSymbolId: "file-1:root", parentName: "root" },
      ],
    },
  ],
  callees: [
    {
      symbolId: "file-5:unknownCallee",
      name: "unknownCallee",
      file: "d.ts",
      language: "typescript",
      symbolType: "function",
      line: 2,
      isExternal: false,
      relationshipTypes: [{ type: "calls", occurrences: 2 }],
      occurrences: 2,
      rows: [
        { rowId: "r-callee-unknown-a", relationshipType: "calls", callSite: { kind: "unknown", file: "main.ts", line: null, note: LEGACY_NOTE }, depth: 0, confidence: 0.9, isCrossLanguage: false, parentSymbolId: "file-1:root", parentName: "root" },
        { rowId: "r-callee-unknown-b", relationshipType: "calls", callSite: { kind: "unknown", file: "main.ts", line: null, note: NOT_STORED_NOTE }, depth: 0, confidence: 0.9, isCrossLanguage: false, parentSymbolId: "file-1:root", parentName: "root" },
      ],
    },
  ],
  fileLevel: { imports: [], exports: [] },
  counts: { callerGroups: 1, calleeGroups: 1, callerRows: 3, calleeRows: 2, fileLevelRows: 0 },
  summary: { truncated: false, crossLanguageGroups: 0 },
} as const

/** The declared kinds each hub group must announce in the DOM. */
export const HUB_EXPECTED_KINDS: Record<string, string> = {
  callerA: "call-site,declaration",
  unknownCallee: "unknown",
}
