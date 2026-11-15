## NIM nested-routine + doc-example fixture — three defects this lane fixed.
##
## 1. A NAMED nested routine is a declaration. `proc recentlyOpenedAdd` inside
##    `proc closeTab` is a Nim closure: it has a stable name, the parent calls it
##    by that name, and it calls itself by that name. The analyzer published the
##    `calls` EDGES and no symbol for either end, so the graph asserted edges it
##    could not walk. Measured over 4,555 corpus files: 653 `calls` edges named
##    a declaration the tree carried and the run published nowhere.
##    The lua lane already publishes this shape with `scope` set to the parent;
##    this pins the same convention for Nim.
##
## 2. A doc example's TYPE declarations are declarations. A `## runnableExamples:`
##    block is compiled by the Nim compiler as its own unit, so
##    `type Sub1 = ref object of Base` inside one is real, and it yields a real
##    `extends` edge. Measured: 9 `object_declaration.inherits` occurrences on the
##    corpus parse tree had an owner symbol published nowhere, every one of them
##    inside a `runnableExamples` block.
##
## 3. A doc example's VALUE declarations are NOT. `var base: Base = Sub1()` is a
##    local of the example exactly as `var` in a routine body is a local of that
##    routine — `LocalsAreNotSymbols`. Publishing them would be the same defect in
##    the opposite direction, so the negative half of this fixture forbids them.

import std/[strutils, tables]

type
  Base* = ref object of RootObj
  Node* = ref object of Base
    payload: string

# ── 1. a NAMED nested routine ────────────────────────────────────────────────
proc closeTab*(tab: int) =
  proc recentlyOpenedAdd(filename: string) =
    # the parent calls it BY NAME, so the call edge must have a symbol to land on
    if filename.len == 0:
      return
    discard filename
  recentlyOpenedAdd("one")
  recentlyOpenedAdd("two")

# an UNNAMED nested routine is the anonymous inner body entity the family rule is
# actually about, so it stays suppressed — the forbid half pins that
proc hostWithAnonClosure*() =
  discard proc (q: int): int = q

# ── 1b. a PARENLESS UFCS call of a NESTED routine ───────────────────────────
# `strip`'s body reads `s.trimmed`, which invokes the nested `trimmed` as
# `trimmed(s)`: Nim writes that call with no parentheses and no call node, so the
# callee is a member leaf. The analyzer asks "does THIS FILE declare a callable
# by this name", and `trimmed` is declared here — inside `strip` — so the test
# must consult the nested set as well as the module-scope one. Found by
# script/m14/nim-truth-oracle.ts on nim/lib/packages/docutils/rst.nim:3493,
# where `p.s.idxImports[origFilename.rmSpaces]` is the same shape and the
# routine lives at rst.nim:3491 inside `proc dirImportdoc`.
proc strip*(s: string): string =
  proc trimmed(): string = s.strip()
  s.trimmed

# ── 2/3. a doc example ──────────────────────────────────────────────────────
proc describe*(n: Node): string =
  ## Returns a short label for the node.
  runnableExamples:
    type
      Shape = ref object of RootObj
      Circle = ref object of Shape
    var s = Circle()
    var label = "circle"
    var exampleOnlyLocal = 42
    discard s
    discard label
    discard exampleOnlyLocal

# ── 3. the same construct at MODULE scope still publishes its values ────────
var moduleLevelCounter* = 0
const moduleLevelLimit* = 10
