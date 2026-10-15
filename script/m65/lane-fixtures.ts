// script/m65/lane-fixtures.ts — the fixture corpus for the refresh-resolution gate.
//
// WHY THIS FILE EXISTS, AND WHY IT HAS 48 ENTRIES
// `validation/m14/verification/FLEET-48.md` established that the programme's scope is the fleet of
// `src/ast/real-*-analyzer.ts` — 48 analyzers — and that the 23-lane `LANES_B` scope was an A/B
// machine split that no longer exists. A seam fix in the indexer that holds for eight lanes is not
// a fix: `resolveNameTargets` and `resolveImportTargets` are language-agnostic deciders, and the
// only way to know whether they bind a lane's cross-file call is to index that lane's shape and
// look. So the corpus is the whole fleet, and `verify-refresh-resolution.ts` derives its LANE SET
// from the analyzer files on disk: a 49th analyzer cannot arrive unnoticed, and a lane cannot be
// dropped from the corpus to make the gate green (both directions are asserted there).
//
// WHAT EACH FIXTURE IS
// Two files minimum: one DECLARES a symbol, one CALLS it across the file boundary. The edited file
// is the caller, and the edit adds a SECOND call site — the shape a developer produces all day and
// the shape a routine incremental refresh must survive. `targetName` is the declared symbol's name
// as the analyzer spells it (or "" for lanes whose ontology has no callable declaration; those
// lanes still exercise refresh parity). The gate MEASURES whether a bound cross-file `calls` row
// appears at all; nothing here claims it does.
//
// FIXTURE FIDELITY IS PART OF THE MEASUREMENT
// A typo'd fixture whose analyzer emits nothing would look exactly like an ontology gap. The gate
// therefore also checks that each fixture PARSES (the analyzer reports the target declaration as a
// symbol) before it reads a missing call as a finding — a malformed fixture fails, it does not
// silently become a declared gap.

export type LangFixture = {
  /** The lane name, spelled as `src/ast/real-<lane>-analyzer.ts` spells it. */
  language: string
  /** Declaration file(s): relative path -> content. */
  files: Record<string, string>
  /** The file whose routine edit is the refresh's cause. */
  editedPath: string
  editedContent: string
  /** The declaration the edited file calls across files; "" when the lane has no callable. */
  targetName: string
  /** The SPELLING the store holds that declaration under, when it differs from `targetName`.
   *  Objective-C stores a method as its selector (`refTargetObjc:`), while the graph door
   *  accepts the bare name — so the row lookups need the selector and the traversal the bare
   *  name. Declared rather than normalised in the gate: the gate must not guess a language's
   *  spelling rules, and a lane whose spelling changes should fail here. */
  targetSymbolName?: string
}

export const LANE_FIXTURES: LangFixture[] = [
  {
    language: "typescript",
    files: {
      "src/a.ts": `export function refTargetTs(x: number): number {\n  return x + 1\n}\n`,
      "src/b.ts": `import { refTargetTs } from "./a"\nexport function useOneTs(): number {\n  return refTargetTs(1)\n}\n`,
    },
    editedPath: "src/b.ts",
    editedContent: `import { refTargetTs } from "./a"\nexport function useOneTs(): number {\n  return refTargetTs(1)\n}\nexport function useTwoTs(): number {\n  return refTargetTs(2)\n}\n`,
    targetName: "refTargetTs",
  },
  {
    language: "javascript",
    files: {
      "src/a.js": `export function refTargetJs(x) {\n  return x + 1\n}\n`,
      "src/b.js": `import { refTargetJs } from "./a"\nexport function useOneJs() {\n  return refTargetJs(1)\n}\n`,
    },
    editedPath: "src/b.js",
    editedContent: `import { refTargetJs } from "./a"\nexport function useOneJs() {\n  return refTargetJs(1)\n}\nexport function useTwoJs() {\n  return refTargetJs(2)\n}\n`,
    targetName: "refTargetJs",
  },
  {
    language: "python",
    files: {
      "a.py": `def ref_target_py(x):\n    return x + 1\n`,
      "b.py": `from a import ref_target_py\n\n\ndef use_one_py():\n    return ref_target_py(1)\n`,
    },
    editedPath: "b.py",
    editedContent: `from a import ref_target_py\n\n\ndef use_one_py():\n    return ref_target_py(1)\n\n\ndef use_two_py():\n    return ref_target_py(2)\n`,
    targetName: "ref_target_py",
  },
  {
    language: "go",
    files: {
      "a.go": `package demo\n\nfunc RefTargetGo(x int) int {\n\treturn x + 1\n}\n`,
      "b.go": `package demo\n\nfunc UseOneGo() int {\n\treturn RefTargetGo(1)\n}\n`,
    },
    editedPath: "b.go",
    editedContent: `package demo\n\nfunc UseOneGo() int {\n\treturn RefTargetGo(1)\n}\n\nfunc UseTwoGo() int {\n\treturn RefTargetGo(2)\n}\n`,
    targetName: "RefTargetGo",
  },
  {
    language: "rust",
    files: {
      "src/lib.rs": `pub mod a;\npub mod b;\n`,
      "src/a.rs": `pub fn ref_target_rs(x: i64) -> i64 {\n    x + 1\n}\n`,
      "src/b.rs": `use crate::a::ref_target_rs;\n\npub fn use_one_rs() -> i64 {\n    ref_target_rs(1)\n}\n`,
    },
    editedPath: "src/b.rs",
    editedContent: `use crate::a::ref_target_rs;\n\npub fn use_one_rs() -> i64 {\n    ref_target_rs(1)\n}\n\npub fn use_two_rs() -> i64 {\n    ref_target_rs(2)\n}\n`,
    targetName: "ref_target_rs",
  },
  {
    language: "java",
    files: {
      "demo/A.java": `package demo;\n\npublic class A {\n    public static int refTargetJava(int x) {\n        return x + 1;\n    }\n}\n`,
      "demo/B.java": `package demo;\n\npublic class B {\n    public static int useOneJava() {\n        return A.refTargetJava(1);\n    }\n}\n`,
    },
    editedPath: "demo/B.java",
    editedContent: `package demo;\n\npublic class B {\n    public static int useOneJava() {\n        return A.refTargetJava(1);\n    }\n\n    public static int useTwoJava() {\n        return A.refTargetJava(2);\n    }\n}\n`,
    targetName: "refTargetJava",
  },
  {
    language: "csharp",
    files: {
      "A.cs": `namespace Demo {\n    public static class A {\n        public static int RefTargetCs(int x) { return x + 1; }\n    }\n}\n`,
      "B.cs": `namespace Demo {\n    public static class B {\n        public static int UseOneCs() { return A.RefTargetCs(1); }\n    }\n}\n`,
    },
    editedPath: "B.cs",
    editedContent: `namespace Demo {\n    public static class B {\n        public static int UseOneCs() { return A.RefTargetCs(1); }\n        public static int UseTwoCs() { return A.RefTargetCs(2); }\n    }\n}\n`,
    targetName: "RefTargetCs",
  },
  {
    language: "ruby",
    files: {
      "a.rb": `def ref_target_rb(x)\n  x + 1\nend\n`,
      "b.rb": `def use_one_rb\n  ref_target_rb(1)\nend\n`,
    },
    editedPath: "b.rb",
    editedContent: `def use_one_rb\n  ref_target_rb(1)\nend\n\ndef use_two_rb\n  ref_target_rb(2)\nend\n`,
    targetName: "ref_target_rb",
  },
  {
    language: "bash",
    files: {
      "a.sh": `ref_target_bash() {\n  echo $(( $1 + 1 ))\n}\n`,
      "b.sh": `source ./a.sh\n\nuse_one_bash() {\n  ref_target_bash 1\n}\n`,
    },
    editedPath: "b.sh",
    editedContent: `source ./a.sh\n\nuse_one_bash() {\n  ref_target_bash 1\n}\n\nuse_two_bash() {\n  ref_target_bash 2\n}\n`,
    targetName: "ref_target_bash",
  },
  {
    language: "c",
    files: {
      "a.h": `int ref_target_c(int x);\n`,
      // No `#include "a.h"` here ON PURPOSE: the header is included by the CALLER only,
      // so the file-level `imports` row belongs to exactly one file. With both files
      // including it, the two rows collide on one file-level id and which file's
      // spelling survives is store ORDER — a race this gate would then report as a
      // parity failure in a lane whose seam is fine (measured: it did).
      "a.c": `int ref_target_c(int x) {\n  return x + 1;\n}\n`,
      "b.c": `#include "a.h"\n\nint use_one_c() {\n  return ref_target_c(1);\n}\n`,
    },
    editedPath: "b.c",
    editedContent: `#include "a.h"\n\nint use_one_c() {\n  return ref_target_c(1);\n}\n\nint use_two_c() {\n  return ref_target_c(2);\n}\n`,
    targetName: "ref_target_c",
  },
  {
    language: "clean",
    files: {
      "A.dcl": `definition module A\n\nref_target_clean :: Int -> Int\n`,
      "A.icl": `implementation module A\n\nref_target_clean x = x + 1\n`,
      "B.icl": `implementation module B\n\nimport A\n\nuse_one_clean :: Int -> Int\nuse_one_clean x = ref_target_clean (x + 1)\n`,
    },
    editedPath: "B.icl",
    editedContent: `implementation module B\n\nimport A\n\nuse_one_clean :: Int -> Int\nuse_one_clean x = ref_target_clean (x + 1)\n\nuse_two_clean :: Int -> Int\nuse_two_clean x = ref_target_clean (x + 2)\n`,
    targetName: "ref_target_clean",
  },
  {
    language: "clojure",
    files: {
      "a.clj": `(ns ida)\n\n(defn ref-target-clj [x] (+ x 1))\n`,
      "b.clj": `(ns idb)\n\n(require '[ida])\n\n(defn use-one-clj [] (ida/ref-target-clj 1))\n`,
    },
    editedPath: "b.clj",
    editedContent: `(ns idb)\n\n(require '[ida])\n\n(defn use-one-clj [] (ida/ref-target-clj 1))\n\n(defn use-two-clj [] (ida/ref-target-clj 2))\n`,
    targetName: "ref-target-clj",
  },
  {
    language: "cpp",
    files: {
      "a.hpp": `int refTargetCpp(int x);\n`,
      "a.cpp": `#include "a.hpp"\n\nint refTargetCpp(int x) {\n  return x + 1;\n}\n`,
      "b.cpp": `#include "a.hpp"\n\nint useOneCpp() {\n  return refTargetCpp(1);\n}\n`,
    },
    editedPath: "b.cpp",
    editedContent: `#include "a.hpp"\n\nint useOneCpp() {\n  return refTargetCpp(1);\n}\n\nint useTwoCpp() {\n  return refTargetCpp(2);\n}\n`,
    targetName: "refTargetCpp",
  },
  {
    language: "css",
    files: {
      "a.css": `.panel {\n  color: red;\n}\n`,
      "b.css": `@import "./a.css";\n\n.card {\n  color: blue;\n}\n`,
    },
    editedPath: "b.css",
    editedContent: `@import "./a.css";\n\n.card {\n  color: blue;\n}\n\n.tile {\n  color: green;\n}\n`,
    targetName: "",
  },
  {
    language: "dart",
    files: {
      "a.dart": `int refTargetDart(int x) {\n  return x + 1;\n}\n`,
      "b.dart": `import 'a.dart';\n\nint useOneDart() {\n  return refTargetDart(1);\n}\n`,
    },
    editedPath: "b.dart",
    editedContent: `import 'a.dart';\n\nint useOneDart() {\n  return refTargetDart(1);\n}\n\nint useTwoDart() {\n  return refTargetDart(2);\n}\n`,
    targetName: "refTargetDart",
  },
  {
    language: "elixir",
    files: {
      "a.ex": `defmodule A do\n  def ref_target_ex(x), do: x + 1\nend\n`,
      "b.ex": `defmodule B do\n  def use_one_ex, do: A.ref_target_ex(1)\nend\n`,
    },
    editedPath: "b.ex",
    editedContent: `defmodule B do\n  def use_one_ex, do: A.ref_target_ex(1)\n  def use_two_ex, do: A.ref_target_ex(2)\nend\n`,
    targetName: "ref_target_ex",
  },
  {
    language: "erlang",
    files: {
      "a.erl": `-module(a).\n-export([ref_target_erlang/1]).\n\nref_target_erlang(X) -> X + 1.\n`,
      "b.erl": `-module(b).\n-export([use_one_erlang/0]).\n\nuse_one_erlang() -> a:ref_target_erlang(1).\n`,
    },
    editedPath: "b.erl",
    editedContent: `-module(b).\n-export([use_one_erlang/0]).\n\nuse_one_erlang() -> a:ref_target_erlang(1).\n\nuse_two_erlang() -> a:ref_target_erlang(2).\n`,
    targetName: "ref_target_erlang",
  },
  {
    language: "fsharp",
    files: {
      "a.fs": `module A\n\nlet refTargetFs x = x + 1\n`,
      "b.fs": `module B\n\nlet useOneFs () = A.refTargetFs 1\n`,
    },
    editedPath: "b.fs",
    editedContent: `module B\n\nlet useOneFs () = A.refTargetFs 1\nlet useTwoFs () = A.refTargetFs 2\n`,
    targetName: "refTargetFs",
  },
  {
    language: "graphql",
    files: {
      "a.graphql": `type Panel {\n  id: ID\n}\n`,
      "b.graphql": `type Card {\n  panel: Panel\n}\n`,
    },
    editedPath: "b.graphql",
    editedContent: `type Card {\n  panel: Panel\n}\n\ntype Tile {\n  panel: Panel\n}\n`,
    targetName: "Panel",
  },
  {
    language: "groovy",
    files: {
      "a.groovy": `class A {\n  static int refTargetGroovy(int x) {\n    return x + 1\n  }\n}\n`,
      "b.groovy": `class B {\n  static int useOneGroovy() {\n    return A.refTargetGroovy(1)\n  }\n}\n`,
    },
    editedPath: "b.groovy",
    editedContent: `class B {\n  static int useOneGroovy() {\n    return A.refTargetGroovy(1)\n  }\n\n  static int useTwoGroovy() {\n    return A.refTargetGroovy(2)\n  }\n}\n`,
    targetName: "refTargetGroovy",
  },
  {
    language: "haskell",
    files: {
      "A.hs": `module A where\n\nrefTargetHs :: Int -> Int\nrefTargetHs x = x + 1\n`,
      "B.hs": `module B where\n\nimport A\n\nuseOneHs :: Int\nuseOneHs = refTargetHs 1\n`,
    },
    editedPath: "B.hs",
    editedContent: `module B where\n\nimport A\n\nuseOneHs :: Int\nuseOneHs = refTargetHs 1\n\nuseTwoHs :: Int\nuseTwoHs = refTargetHs 2\n`,
    targetName: "refTargetHs",
  },
  {
    language: "hcl",
    files: {
      "a.tf": `resource "demo_instance" "a" {\n  ami = "first"\n}\n`,
      "b.tf": `resource "demo_instance" "b" {\n  ami = demo_instance.a.ami\n}\n`,
    },
    editedPath: "b.tf",
    editedContent: `resource "demo_instance" "b" {\n  ami = demo_instance.a.ami\n}\n\nresource "demo_instance" "c" {\n  ami = demo_instance.a.ami\n}\n`,
    targetName: "demo_instance.a",
  },
  {
    language: "html",
    files: {
      "a.html": `<!doctype html>\n<div id="panel">panel</div>\n`,
      "b.html": `<!doctype html>\n<iframe src="./a.html"></iframe>\n`,
    },
    editedPath: "b.html",
    editedContent: `<!doctype html>\n<iframe src="./a.html"></iframe>\n<iframe src="./a.html#panel"></iframe>\n`,
    targetName: "",
  },
  {
    language: "json",
    files: {
      "a.json": `{\n  "defs": {\n    "panel": {\n      "type": "string"\n    }\n  }\n}\n`,
      "b.json": `{\n  "$ref": "./a.json#/defs/panel"\n}\n`,
    },
    editedPath: "b.json",
    editedContent: `{\n  "$ref": "./a.json#/defs/panel",\n  "also": "./a.json#/defs/panel"\n}\n`,
    targetName: "panel",
  },
  {
    language: "julia",
    files: {
      "a.jl": `function ref_target_jl(x)\n    return x + 1\nend\n`,
      "b.jl": `include("a.jl")\n\nfunction use_one_jl()\n    return ref_target_jl(1)\nend\n`,
    },
    editedPath: "b.jl",
    editedContent: `include("a.jl")\n\nfunction use_one_jl()\n    return ref_target_jl(1)\nend\n\nfunction use_two_jl()\n    return ref_target_jl(2)\nend\n`,
    targetName: "ref_target_jl",
  },
  {
    language: "kotlin",
    files: {
      "demo/A.kt": `package demo\n\nobject A {\n    fun refTargetKt(x: Int): Int = x + 1\n}\n`,
      "demo/B.kt": `package demo\n\nfun useOneKt(): Int = A.refTargetKt(1)\n`,
    },
    editedPath: "demo/B.kt",
    editedContent: `package demo\n\nfun useOneKt(): Int = A.refTargetKt(1)\n\nfun useTwoKt(): Int = A.refTargetKt(2)\n`,
    targetName: "refTargetKt",
  },
  {
    language: "lua",
    files: {
      "a.lua": `local M = {}\n\nfunction M.ref_target_lua(x)\n  return x + 1\nend\n\nreturn M\n`,
      "b.lua": `local a = require("a")\n\nfunction use_one_lua()\n  return a.ref_target_lua(1)\nend\n`,
    },
    editedPath: "b.lua",
    editedContent: `local a = require("a")\n\nfunction use_one_lua()\n  return a.ref_target_lua(1)\nend\n\nfunction use_two_lua()\n  return a.ref_target_lua(2)\nend\n`,
    targetName: "ref_target_lua",
  },
  {
    language: "makefile",
    files: {
      "a.mk": `ref_target_make:\n\t@echo one\n`,
      "b.mk": `include a.mk\n\nuse_one_make:\n\t@echo two\n`,
    },
    editedPath: "b.mk",
    editedContent: `include a.mk\n\nuse_one_make:\n\t@echo two\n\nuse_two_make:\n\t@echo three\n`,
    targetName: "ref_target_make",
  },
  {
    language: "markdown",
    files: {
      "a.md": `# Target\n\nThe declaration.\n`,
      "b.md": `# Caller\n\nSee [target](./a.md).\n`,
    },
    editedPath: "b.md",
    editedContent: `# Caller\n\nSee [target](./a.md).\n\nAnd [again](./a.md#target).\n`,
    targetName: "",
  },
  {
    language: "nim",
    files: {
      "a.nim": `proc refTargetNim(x: int): int =\n  x + 1\n`,
      "b.nim": `import a\n\nproc useOneNim(): int =\n  refTargetNim(1)\n`,
    },
    editedPath: "b.nim",
    editedContent: `import a\n\nproc useOneNim(): int =\n  refTargetNim(1)\n\nproc useTwoNim(): int =\n  refTargetNim(2)\n`,
    targetName: "refTargetNim",
  },
  {
    language: "objective-c",
    files: {
      "A.h": `#import <Foundation/Foundation.h>\n\n@interface A : NSObject\n+ (int)refTargetObjc:(int)x;\n@end\n`,
      "A.m": `#import "A.h"\n\n@implementation A\n+ (int)refTargetObjc:(int)x {\n  return x + 1;\n}\n@end\n`,
      "B.m": `#import "A.h"\n\nint useOneObjc(void) {\n  return [A refTargetObjc:1];\n}\n`,
    },
    editedPath: "B.m",
    editedContent: `#import "A.h"\n\nint useOneObjc(void) {\n  return [A refTargetObjc:1];\n}\n\nint useTwoObjc(void) {\n  return [A refTargetObjc:2];\n}\n`,
    targetName: "refTargetObjc",
    targetSymbolName: "refTargetObjc:",
  },
  {
    language: "perl",
    files: {
      "a.pm": `package A;\nuse strict;\nuse warnings;\n\nsub ref_target_perl {\n    my ($x) = @_;\n    return $x + 1;\n}\n\n1;\n`,
      "b.pl": `use strict;\nuse warnings;\nuse A;\n\nsub use_one_perl {\n    return A::ref_target_perl(1);\n}\n`,
    },
    editedPath: "b.pl",
    editedContent: `use strict;\nuse warnings;\nuse A;\n\nsub use_one_perl {\n    return A::ref_target_perl(1);\n}\n\nsub use_two_perl {\n    return A::ref_target_perl(2);\n}\n`,
    targetName: "ref_target_perl",
  },
  {
    language: "php",
    files: {
      "a.php": `<?php\n\nfunction ref_target_php($x) {\n    return $x + 1;\n}\n`,
      "b.php": `<?php\n\nrequire_once __DIR__ . '/a.php';\n\nfunction use_one_php() {\n    return ref_target_php(1);\n}\n`,
    },
    editedPath: "b.php",
    editedContent: `<?php\n\nrequire_once __DIR__ . '/a.php';\n\nfunction use_one_php() {\n    return ref_target_php(1);\n}\n\nfunction use_two_php() {\n    return ref_target_php(2);\n}\n`,
    targetName: "ref_target_php",
  },
  {
    language: "powershell",
    files: {
      "a.ps1": `function Ref-TargetPwsh($x) {\n  return $x + 1\n}\n`,
      "b.ps1": `. ./a.ps1\n\nfunction Use-OnePwsh {\n  return Ref-TargetPwsh 1\n}\n`,
    },
    editedPath: "b.ps1",
    editedContent: `. ./a.ps1\n\nfunction Use-OnePwsh {\n  return Ref-TargetPwsh 1\n}\n\nfunction Use-TwoPwsh {\n  return Ref-TargetPwsh 2\n}\n`,
    targetName: "Ref-TargetPwsh",
  },
  {
    language: "protobuf",
    files: {
      "a.proto": `syntax = "proto3";\n\npackage demo;\n\nmessage Panel {\n  string id = 1;\n}\n`,
      "b.proto": `syntax = "proto3";\n\npackage demo;\n\nimport "a.proto";\n\nmessage Card {\n  Panel panel = 1;\n}\n`,
    },
    editedPath: "b.proto",
    editedContent: `syntax = "proto3";\n\npackage demo;\n\nimport "a.proto";\n\nmessage Card {\n  Panel panel = 1;\n}\n\nmessage Tile {\n  Panel panel = 1;\n}\n`,
    targetName: "Panel",
  },
  {
    language: "r",
    files: {
      "a.R": `ref_target_r <- function(x) {\n  x + 1\n}\n`,
      "b.R": `source("a.R")\n\nuse_one_r <- function() {\n  ref_target_r(1)\n}\n`,
    },
    editedPath: "b.R",
    editedContent: `source("a.R")\n\nuse_one_r <- function() {\n  ref_target_r(1)\n}\n\nuse_two_r <- function() {\n  ref_target_r(2)\n}\n`,
    targetName: "ref_target_r",
  },
  {
    language: "scala",
    files: {
      "a.scala": `object A {\n  def refTargetScala(x: Int): Int = x + 1\n}\n`,
      "b.scala": `object B {\n  def useOneScala(): Int = A.refTargetScala(1)\n}\n`,
    },
    editedPath: "b.scala",
    editedContent: `object B {\n  def useOneScala(): Int = A.refTargetScala(1)\n  def useTwoScala(): Int = A.refTargetScala(2)\n}\n`,
    targetName: "refTargetScala",
  },
  {
    language: "scss",
    files: {
      "a.scss": `$base: 4px;\n\n.panel {\n  padding: $base;\n}\n`,
      "b.scss": `@use "./a";\n\n.card {\n  margin: 1px;\n}\n`,
    },
    editedPath: "b.scss",
    editedContent: `@use "./a";\n\n.card {\n  margin: 1px;\n}\n\n.tile {\n  margin: 2px;\n}\n`,
    targetName: "",
  },
  {
    language: "solidity",
    files: {
      "A.sol": `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\nlibrary LibRef {\n    function refTargetSol(uint256 x) internal pure returns (uint256) {\n        return x + 1;\n    }\n}\n`,
      "B.sol": `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\nimport "./A.sol";\n\ncontract UseB {\n    function useOneSol() public pure returns (uint256) {\n        return LibRef.refTargetSol(1);\n    }\n}\n`,
    },
    editedPath: "B.sol",
    editedContent: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\nimport "./A.sol";\n\ncontract UseB {\n    function useOneSol() public pure returns (uint256) {\n        return LibRef.refTargetSol(1);\n    }\n\n    function useTwoSol() public pure returns (uint256) {\n        return LibRef.refTargetSol(2);\n    }\n}\n`,
    targetName: "refTargetSol",
  },
  {
    language: "sql",
    files: {
      "a.sql": `CREATE FUNCTION ref_target_sql(x int) RETURNS int\nBEGIN\n  RETURN x + 1;\nEND;\n`,
      "b.sql": `CREATE VIEW use_one_sql AS\nSELECT ref_target_sql(1) AS value;\n`,
    },
    editedPath: "b.sql",
    editedContent: `CREATE VIEW use_one_sql AS\nSELECT ref_target_sql(1) AS value;\n\nCREATE VIEW use_two_sql AS\nSELECT ref_target_sql(2) AS value;\n`,
    targetName: "ref_target_sql",
  },
  {
    language: "svelte",
    files: {
      "A.svelte": `<script>\n  export let label = "a";\n</script>\n\n<p>{label}</p>\n`,
      "B.svelte": `<script>\n  import A from "./A.svelte";\n</script>\n\n<A label="one" />\n`,
    },
    editedPath: "B.svelte",
    editedContent: `<script>\n  import A from "./A.svelte";\n</script>\n\n<A label="one" />\n<A label="two" />\n`,
    targetName: "A",
  },
  {
    language: "swift",
    files: {
      "A.swift": `func refTargetSwift(_ x: Int) -> Int {\n    return x + 1\n}\n`,
      "B.swift": `func useOneSwift() -> Int {\n    return refTargetSwift(1)\n}\n`,
    },
    editedPath: "B.swift",
    editedContent: `func useOneSwift() -> Int {\n    return refTargetSwift(1)\n}\n\nfunc useTwoSwift() -> Int {\n    return refTargetSwift(2)\n}\n`,
    targetName: "refTargetSwift",
  },
  {
    language: "toml",
    files: {
      "a.toml": `[panel]\nid = "one"\n`,
      "b.toml": `[card]\npanel = "panel"\n`,
    },
    editedPath: "b.toml",
    editedContent: `[card]\npanel = "panel"\n\n[tile]\npanel = "panel"\n`,
    targetName: "",
  },
  {
    language: "vb",
    files: {
      "A.vb": `Public Module A\n    Public Function RefTargetVb(ByVal x As Integer) As Integer\n        Return x + 1\n    End Function\nEnd Module\n`,
      "B.vb": `Public Module B\n    Public Function UseOneVb() As Integer\n        Return A.RefTargetVb(1)\n    End Function\nEnd Module\n`,
    },
    editedPath: "B.vb",
    editedContent: `Public Module B\n    Public Function UseOneVb() As Integer\n        Return A.RefTargetVb(1)\n    End Function\n\n    Public Function UseTwoVb() As Integer\n        Return A.RefTargetVb(2)\n    End Function\nEnd Module\n`,
    targetName: "RefTargetVb",
  },
  {
    language: "vue",
    files: {
      "A.vue": `<script>\nexport default { name: "A", props: { label: String } }\n</script>\n\n<template>\n  <div>{{ label }}</div>\n</template>\n`,
      "B.vue": `<script>\nimport A from "./A.vue";\nexport default { components: { A } }\n</script>\n\n<template>\n  <A label="one" />\n</template>\n`,
    },
    editedPath: "B.vue",
    editedContent: `<script>\nimport A from "./A.vue";\nexport default { components: { A } }\n</script>\n\n<template>\n  <A label="one" />\n  <A label="two" />\n</template>\n`,
    targetName: "A",
  },
  {
    language: "xml",
    files: {
      "a.xml": `<panel>\n  <id>one</id>\n</panel>\n`,
      "b.xml": `<card>\n  <ref href="./a.xml#panel" />\n</card>\n`,
    },
    editedPath: "b.xml",
    editedContent: `<card>\n  <ref href="./a.xml#panel" />\n  <ref href="./a.xml#panel" />\n</card>\n`,
    targetName: "panel",
  },
  {
    language: "yaml",
    files: {
      "a.yaml": `panel: &base\n  id: one\n`,
      "b.yaml": `card:\n  source: ./a.yaml\n`,
    },
    editedPath: "b.yaml",
    editedContent: `card:\n  source: ./a.yaml\n\ntile:\n  source: ./a.yaml\n`,
    targetName: "panel",
  },
  {
    language: "zig",
    files: {
      "a.zig": `pub fn refTargetZig(x: i64) i64 {\n    return x + 1;\n}\n`,
      "b.zig": `const a = @import("a.zig");\n\npub fn useOneZig() i64 {\n    return a.refTargetZig(1);\n}\n`,
    },
    editedPath: "b.zig",
    editedContent: `const a = @import("a.zig");\n\npub fn useOneZig() i64 {\n    return a.refTargetZig(1);\n}\n\npub fn useTwoZig() i64 {\n    return a.refTargetZig(2);\n}\n`,
    targetName: "refTargetZig",
  },
]

/**
 * LANE -> THE CORPUS DIRECTORY THIS LANE'S SPAN FIXTURES LIVE IN (`validation/m14/fixtures/<dir>`).
 *
 * Written out in full rather than inferred, because the two names DO differ for two lanes and a
 * derivation would have to encode the exceptions anyway: the analyzer is `real-makefile-analyzer.ts`
 * and the corpus directory is `make`; the analyzer is `real-objective-c-analyzer.ts` and the
 * directory is `objc`. `verify-refresh-resolution.ts` asserts every entry resolves to a directory,
 * so this map is a claim about the tree that a rename in either place fails.
 */
export const LANE_CORPUS_DIR: Record<string, string> = {
  bash: "bash", c: "c", clean: "clean", clojure: "clojure", cpp: "cpp", csharp: "csharp",
  css: "css", dart: "dart", elixir: "elixir", erlang: "erlang", fsharp: "fsharp", go: "go",
  graphql: "graphql", groovy: "groovy", haskell: "haskell", hcl: "hcl", html: "html",
  java: "java", javascript: "javascript", json: "json", julia: "julia", kotlin: "kotlin",
  lua: "lua", makefile: "make", markdown: "markdown", nim: "nim", "objective-c": "objc",
  perl: "perl", php: "php", powershell: "powershell", protobuf: "protobuf", python: "python",
  r: "r", ruby: "ruby", rust: "rust", scala: "scala", scss: "scss", solidity: "solidity",
  sql: "sql", svelte: "svelte", swift: "swift", toml: "toml", typescript: "typescript",
  vb: "vb", vue: "vue", xml: "xml", yaml: "yaml", zig: "zig",
}
