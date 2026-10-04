// script/m62/a2-language-fixture.ts — M62.A2 R7 (issue #878): the per-language
// call-site TRUTH fixture.
//
// A2's other laws seed the store directly (a1-fixture.ts), because what they
// constrain is the DERIVATION. R7 asks a different question and cannot be
// answered by a seeded row: WHAT DOES EACH LANGUAGE'S ANALYZER ACTUALLY EMIT
// TODAY? That is a property of the analyzer, not of this repository's code, so
// the only honest oracle is a real index run over real files in each language —
// real analyzers, real store, real engine.
//
// Every file below declares the SAME shape on purpose: a `target` function and a
// `caller` function that invokes it, so every language that routes the
// extension gets at least one `calls` row for which a call-site line is a
// MEANINGFUL claim. A language that emits nothing for that row is not a bug in
// this gate — it is the DECLARED ABSENCE the whole lane exists to preserve, and
// R7's T1 law turns any fabricated position for it red.
//
// Two design choices keep the fixture from being a second opinion:
//
//   * The invocation line is FOUND, never COUNTED. Each source carries a
//     marker comment on the invocation line, in that language's own comment
//     syntax, so R7 locates the position by scanning for the marker. A
//     hand-counted `invocationLine` field would be a number an author wrote
//     down and forgot, and it would silently rot the first time somebody edited
//     a fixture file — with the table still reporting numbers.
//   * The expectations are NOT authored here. A fixture that asserted WHICH
//     languages emit lines would be an oracle sharing its author's belief with
//     the implementation (§8.7). This file states only the FACTS — the source
//     text, and the marker — and the gate measures everything else against the
//     source itself.

/** The marker comment, one spelling per comment syntax. R7 finds the
 *  invocation line by looking for this token; nothing counts lines. */
export const CALLSITE_MARKER = "BB-CALLSITE"

export interface LanguageFixture {
  /** The routed extension (src/ast/language-detection.ts). */
  ext: string
  /** The declared language name the registry routes it to. */
  language: string
  /** The comment introducer for this language's syntax (including the space). */
  comment: string
  /** The file body, relative to the fixture workspace. */
  source: string
}

/** One shape per language. `target` first, then `caller`, so the invocation is
 *  never on line 1 — a call site on line 1 is a boundary the owner already
 *  covers in a1-fixture.ts, and here it would only make the table harder to
 *  read. */
export const LANGUAGE_FIXTURE: LanguageFixture[] = [
  // --- the five launch languages (contract §9) -----------------------------------
  {
    ext: "java",
    language: "java",
    comment: "// ",
    source: `public class Fixture {
    public static int target(int x) {
        return x + 1;
    }

    public static int caller(int y) {
        int z = target(y); // BB-CALLSITE
        return z;
    }
}
`,
  },
  {
    ext: "kt",
    language: "kotlin",
    comment: "// ",
    source: `class Fixture {
    fun target(x: Int): Int {
        return x + 1
    }

    fun caller(y: Int): Int {
        val z = target(y) // BB-CALLSITE
        return z
    }
}
`,
  },
  {
    ext: "scala",
    language: "scala",
    comment: "// ",
    source: `object Fixture {
  def target(x: Int): Int = x + 1

  def caller(y: Int): Int = {
    val z = target(y) // BB-CALLSITE
    z
  }
}
`,
  },
  {
    ext: "groovy",
    language: "groovy",
    comment: "// ",
    source: `class Fixture {
    int target(int x) {
        return x + 1
    }

    int caller(int y) {
        int z = target(y) // BB-CALLSITE
        return z
    }
}
`,
  },
  {
    ext: "ts",
    language: "typescript",
    comment: "// ",
    source: `export function target(x: number): number {
  return x + 1
}

export function caller(y: number): number {
  const z = target(y) // BB-CALLSITE
  return z
}
`,
  },
  // --- languages M59/M60 recorded line emission for --------------------------------
  {
    ext: "py",
    language: "python",
    comment: "# ",
    source: `def target(x):
    return x + 1

def caller(y):
    z = target(y) # BB-CALLSITE
    return z
`,
  },
  {
    ext: "go",
    language: "go",
    comment: "// ",
    source: `package fixture

func Target(x int) int {
	return x + 1
}

func Caller(y int) int {
	z := Target(y) // BB-CALLSITE
	return z
}
`,
  },
  {
    ext: "rs",
    language: "rust",
    comment: "// ",
    source: `pub fn target(x: i32) -> i32 {
    x + 1
}

pub fn caller(y: i32) -> i32 {
    let z = target(y); // BB-CALLSITE
    z
}
`,
  },
  {
    ext: "rb",
    language: "ruby",
    comment: "# ",
    source: `def target(x)
  x + 1
end

def caller(y)
  z = target(y) # BB-CALLSITE
  z
end
`,
  },
  // --- languages the recorded probes measured at 0% --------------------------------
  // (validation/m59/results/probe-line-absence-by-language.json: python 0 of
  // 4 321, rust 0 of 6 490, go 0 of 2 895 — measured 2026-09-17, before M59's
  // later waves. R7 re-measures; it does not inherit that number.)
  {
    ext: "c",
    language: "c",
    comment: "// ",
    source: `int target(int x) {
    return x + 1;
}

int caller(int y) {
    int z = target(y); // BB-CALLSITE
    return z;
}
`,
  },
  {
    ext: "cs",
    language: "csharp",
    comment: "// ",
    source: `class Fixture {
    int Target(int x) {
        return x + 1;
    }

    int Caller(int y) {
        int z = Target(y); // BB-CALLSITE
        return z;
    }
}
`,
  },
  {
    ext: "php",
    language: "php",
    comment: "// ",
    source: `<?php
function target($x) {
    return $x + 1;
}

function caller($y) {
    $z = target($y); // BB-CALLSITE
    return $z;
}
`,
  },
  {
    ext: "lua",
    language: "lua",
    comment: "-- ",
    source: `local function target(x)
  return x + 1
end

local function caller(y)
  local z = target(y) -- BB-CALLSITE
  return z
end
`,
  },
  {
    ext: "pl",
    language: "perl",
    comment: "# ",
    source: `sub target {
    my ($x) = @_;
    return $x + 1;
}

sub caller {
    my ($y) = @_;
    my $z = target($y); # BB-CALLSITE
    return $z;
}
`,
  },
  {
    ext: "ex",
    language: "elixir",
    comment: "# ",
    source: `defmodule Fixture do
  def target(x) do
    x + 1
  end

  def caller(y) do
    z = target(y) # BB-CALLSITE
    z
  end
end
`,
  },
  {
    ext: "erl",
    language: "erlang",
    comment: "% ",
    source: `-module(fixture).
-export([target/1, caller/1]).

target(X) ->
    X + 1.

caller(Y) ->
    Z = target(Y), % BB-CALLSITE
    Z.
`,
  },
  {
    ext: "swift",
    language: "swift",
    comment: "// ",
    source: `func target(_ x: Int) -> Int {
    return x + 1
}

func caller(_ y: Int) -> Int {
    let z = target(y) // BB-CALLSITE
    return z
}
`,
  },
  {
    ext: "dart",
    language: "dart",
    comment: "// ",
    source: `int target(int x) {
  return x + 1;
}

int caller(int y) {
  int z = target(y); // BB-CALLSITE
  return z;
}
`,
  },
  {
    ext: "hs",
    language: "haskell",
    comment: "-- ",
    source: `target :: Int -> Int
target x = x + 1

caller :: Int -> Int
caller y = let z = target y -- BB-CALLSITE
            in z
`,
  },
  {
    ext: "sh",
    language: "bash",
    comment: "# ",
    source: `target() {
  echo 1
}

caller() {
  target # BB-CALLSITE
}
`,
  },
  {
    ext: "sol",
    language: "solidity",
    comment: "// ",
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Fixture {
    function target(uint256 x) public pure returns (uint256) {
        return x + 1;
    }

    function caller(uint256 y) public pure returns (uint256) {
        uint256 z = target(y); // BB-CALLSITE
        return z;
    }
}
`,
  },
  {
    ext: "fs",
    language: "fsharp",
    comment: "// ",
    source: `module Fixture

let target x = x + 1

let caller y =
    let z = target y // BB-CALLSITE
    z
`,
  },
]

/** The files the fixture writes, keyed by relative path. One file per language,
 *  named so the language is readable in a failure message and so no two files
 *  can collide. */
export function languageFixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of LANGUAGE_FIXTURE) out[`lang_${entry.language}.${entry.ext}`] = entry.source
  return out
}

/** The 1-based line each file's marker sits on, FOUND by scanning the source.
 *  Returns `null` for a file whose marker is missing or ambiguous — the gate
 *  treats that as a fixture defect and fails, because a fixture whose call site
 *  cannot be located cannot measure whether the analyzer found it. */
export function invocationLineByFile(files: Record<string, string>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const [rel, body] of Object.entries(files)) {
    const hits: number[] = []
    body.split("\n").forEach((text, i) => {
      if (text.includes(CALLSITE_MARKER)) hits.push(i + 1)
    })
    out[rel] = hits.length === 1 ? hits[0]! : null
  }
  return out
}

/** Line counts per relative path — R7's T2 law needs them to decide whether a
 *  positive stored line points at a line that EXISTS. A line past the end of a
 *  file is a position no editor could open, so publishing one is fabrication
 *  even though it is "a real stored line". */
export function languageFixtureLineCounts(files: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [rel, body] of Object.entries(files)) out[rel] = body.split("\n").length
  return out
}