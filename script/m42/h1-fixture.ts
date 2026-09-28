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

export function writeH1Fixture(): string {
  mkdirSync(path.dirname(H1_FILE), { recursive: true })
  writeFileSync(H1_FILE, H1_SOURCE)
  return H1_ROOT
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("fixture written:", writeH1Fixture(), "\n", H1_FILE)
}
