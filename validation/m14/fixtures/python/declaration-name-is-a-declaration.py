"""VERIFY_PY10 — a DECLARATION is a declaration, whatever it is named.

`DENYLISTED_SYMBOL_NAMES` gated the name on every `class_definition` and every
`function_definition`, which is the one position where the gate could not do any good: if
the grammar produced a `def X` node then `X` IS a declaration. One of its four entries is
a legal method name that a real framework ships:

    django/template/loader_tags.py:71    def super(self):

`super` is a builtin FUNCTION, so the gate skipped the whole `function_definition` branch —
not only the symbol, but `ctx.currentFunction = "super"` and the exit frame that restores
it. The walk then descended into that method with `currentFunction === undefined` and
`currentClass === "BlockNode"`, which is the shape of a class body. Four measured
consequences, all from that one line, all reproduced below:

  LOSS        the method symbol and its `contains` edge. `super` is not a scratch name in
              django — `{{ block.super }}` is the documented template API for it.
  FABRICATION the method LOCAL `scratch` published as a class member, because a local
              assignment inside a mis-scoped method reaches the class-body Property branch.
  DANGLING    `uses` edges sourced to a symbol that was never published. `extractMemberUses`
              is a SECOND walk with no denylist, so it bound the owner the main walk
              refused to bind. An edge naming a nonexistent symbol is the "stored and
              compared against nothing" shape.
  MISATTRIB   `calls` edges sourced to the CLASS instead of the method.

BLAST RADIUS measured before the change: every `def`/`class` declaration in all 5,364
code-bearing corpus files whose name is in that set. Exactly ONE — the `super` above.
Zero named `self`, `cls`, `this`, `None`, `True` or `False`. So the fix is zero-delta on
5,363 files of 5,364.

`direct`, `self` and `this` are here as CONTROLS: all three were in the removed set, all
three are ordinary identifiers, and all three must still publish. A fixture that only pins
the defect can be satisfied by refusing every removed name, which is the over-correction
this one is written against.

`None`, `True` and `False` are NOT here, and their absence is a finding rather than an
omission. They are python KEYWORDS, so `def None(self)`, `def True(self)` and
`def False(self)` are SyntaxErrors — CPython's own `ast` says so, which is the referee:

    >>> ast.parse("def None(self): pass")     SyntaxError: invalid syntax
    >>> ast.parse("def True(self): pass")     SyntaxError: invalid syntax
    >>> ast.parse("def False(self): pass")    SyntaxError: invalid syntax
    >>> ast.parse("def cls(self): pass")      LEGAL
    >>> ast.parse("def self(self): pass")     LEGAL
    >>> ast.parse("def this(self): pass")     LEGAL
    >>> ast.parse("def super(self): pass")    LEGAL

Two drafts of this fixture declared `True` and then `None`, and both were caught by the
grammar returning an ERROR node with no identifier — which agrees with the denylist
probe's independent measurement of 0 such declarations across all 5,364 corpus files.
So three of the removed set's seven names could never have matched anything at all, and
the gate's only live entry was the one real method this fixture is about.
"""


class Holder:
    def direct(self):
        return self.value

    def cls(self):
        return self.direct()

    def self(self):
        return self.cls()

    def this(self):
        return self.self()

    def super(self):
        """django's BlockNode.super — a real method, reachable as {{ block.super }}."""
        scratch = self.helper()
        return scratch + self.other()

    def helper(self):
        return 1

    def other(self):
        return 2