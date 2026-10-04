// script/m42/h1-fixture.ts — M42.H1 fixture (F7: authored BEFORE the wiring).
//
// The fixture proves the highlight provider is SEMANTIC, not lexical:
//   - line 12 (comment) and line 15 (string) contain the token `total` —
//     they must NEVER highlight;
//   - the real declaration (line 8) and the real call (line 14) must.
//
// Exports the fixture layout + expectations so the verifier and the editor
// leg share ONE source of truth.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export const H1_ROOT = path.resolve(import.meta.dirname, "../../.tools/m42-h1-fixture")
export const H1_FILE = path.join(H1_ROOT, "src/main/java/com/demo/Highlight.java")
export const H1_REL = "src/main/java/com/demo/Highlight.java"

export const H1_SOURCE = `package com.demo;

/** Fixture: semantic highlights only. The word total below is a decoy. */
public class Highlight {

    public int total() {
        return 42;
    }

    public int useTotalTwice() {
        int a = total();
        // total in a comment must not highlight
        int b = total();
        String s = "total in a string must not highlight";
        return a + b + s.length();
    }
}
`

// 0-based LSP lines as authored above (1-based as `grep -n` reports).
// queryCharacter is DERIVED from the source (the 0-based UTF-16 offset of
// the symbol name inside the query line) — never a hand-picked constant;
// a hand-picked column once probed a space and honestly returned absence.
const queryLineText = H1_SOURCE.split("\n")[12] ?? ""
export const H1_EXPECT = {
  declarationLine: 5, // `public int total() {` (1-based 6)
  declarationText: "public int total()",
  referenceLines: [10, 12], // `int a = total();` and `int b = total();`
  decoyLines: [2, 11, 13], // javadoc, comment, string
  queryLine: 12, // cursor on the second real call
  queryText: "int b = total();",
  queryCharacter: queryLineText.indexOf("total"),
  symbolName: "total",
}

/**
 * The UNROUTABLE fixture — the negative case for contract §11.7 (a file outside
 * the launch-language set must get DECLARED ABSENCE, never a wire error).
 *
 * `.txt` is not in EXTENSION_LANGUAGE and has no basename/shebang route, so
 * `detectLanguageFromPath` returns null and `ASTEngine.parseTree` throws
 * `Unsupported file type`. It is a REAL file on disk with REAL text on the
 * query line, so the request that used to fail was a well-formed request at a
 * real position in a real file — not a malformed params object.
 *
 * Deliberately NOT inside the indexed source tree's language: the indexer skips
 * it, so `H1/R1` stays "indexed 1 files" and this leg cannot perturb the
 * positive legs' fixture.
 */
export const UNROUTED_REL = "docs/notes.txt"
export const UNROUTED_FILE = path.join(H1_ROOT, UNROUTED_REL)
export const UNROUTED_QUERY_LINE = 1 // 0-based: `total is here`
export const UNROUTED_QUERY_CHARACTER = 0
export const UNROUTED_SOURCE = `plain notes
total is here
not code
`

export function writeH1Fixture(): string {
  mkdirSync(path.dirname(H1_FILE), { recursive: true })
  writeFileSync(H1_FILE, H1_SOURCE)
  writeUnroutableFixture()
  return H1_ROOT
}

export function writeUnroutableFixture(): string {
  mkdirSync(path.dirname(UNROUTED_FILE), { recursive: true })
  writeFileSync(UNROUTED_FILE, UNROUTED_SOURCE)
  return UNROUTED_FILE
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("fixture written:", writeH1Fixture(), "\n", H1_FILE)
}
