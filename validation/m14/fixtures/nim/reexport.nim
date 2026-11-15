## NIM re-export fixture — the `exports` edge.
##
## ## The construct: the `export` STATEMENT
##
## `doc/grammar.txt` spells it
## `exportStmt = 'export' optInd expr ((comma expr)* / 'except' optInd (expr^+ comma))`,
## and the grammar agrees: `export_statement` holds either an `expression_list`
## of operands or, after `except`, an `except_clause` naming the operands the
## author REFUSES to re-publish.
##
## ## Every spelling the statement has, all of them below
##
##   bare list          `export foo, Bar`         — two operands
##   with `except`      `export hidden except helper, another` — the two after
##                                                      `except` are NOT published
##   qualified          `export common_parser.Parser` — published by its LEAF
##   aliased            `export Payload as Renamed`  — `Renamed` is local; `Payload`
##                                                      is what leaves the module
##   module path        `export std/strutils`      — a MODULE, published whole
##
## ## Why the `except` case is a FORBID and not an absence
##
## A reader that walks every identifier under the statement lists the excluded
## names as exported, which is the precise inverse of the construct: `except` is
## the author saying "this one does NOT leave the module". The form is real and
## not a curiosity — `nim/compiler/nifstreams.nim` writes
## `export nifpools, lineinfos except info, NoLineInfo, tagId, …`, nine names
## withheld. So the forbid below is the half of this fixture that a
## name-collecting implementation cannot pass.
##
## ## The `*` marker is a DIFFERENT fact and must not appear here
##
## `proc visible*()` sets visibility and is published as `visibility: "public"`
## plus `metadata.exported`, which the store persists into `brain_symbol.visibility`
## and which gravity already reads (measured: 28,900 `exported_symbol` nodes in
## 1,335 corpus files). An `exports` EDGE for it would state that fact a second
## time for no query a reader could not already ask. The forbid on `visible`
## pins that judgement, so a later "let us emit `exports` for `*` too" change has
## to argue with this fixture rather than slip through.

import std/[strutils, os]

type Payload = object
  n: int

proc visible*(): int = 1
proc hidden(): int = 2
proc helper(): int = 3
proc another(): int = 4

export foo, Bar
export hidden except helper, another
export common_parser.Parser
export Payload as Renamed
export strutils
export std/os