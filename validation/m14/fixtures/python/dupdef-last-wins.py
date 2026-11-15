"""M60 #748 — the M49 dup-key family ruling (Option A) in python: a container
scope binds the LAST definition of a name, and the shadowed body contributes
nothing at all.

WHAT THE RUNTIME DOES. `def` is a binding statement, and python binds the LAST
definition of a name in one container scope. A module that defines `top` twice
has ONE module attribute `top` — the second function object; the first body was
compiled but its name is unreachable by the time the module finishes executing.
The same holds inside a class body: the class namespace keeps the last `foo`,
and every earlier def of that name is absent from the class the runtime builds.

WHAT THE LANE DID. Both defs produced a symbol and both bodies' edges were
emitted, so the payload split a call graph and a cyclomatic count across a body
that can never run. The corpus could not see it: MEASURED, 0 duplicate-name
scopes across python's two pinned corpora (cython 475 + requests 37 files) — the
C4 blind-spot class #748 came from, which is why the rule is pinned here instead.

THE RULING (family Option A, the rule js/ts/vue pinned for duplicate keys):
ONE symbol per (container, name), keyed to the LAST declaration, phantom body
edges dropped. Container identity is the scope NODE, not the class NAME — the
sibling class `D` may reuse `foo` freely.

WHY THE BODIES CARRY MORE THAN CALLS. A skipped subtree must be skipped by every
pass, not only the structural one, so the phantom class-body def also carries a
member READ (self.dead_read — the uses pass) and a declared-type annotation
(DeadType — the references pass), and the phantom module-level def carries a
decision point (the `if` — the file complexity). Each is a separate assertion
against a keep-both reading.
"""


def phantom_marker():
    return 1


def winner_marker():
    return 2


class DeadType:
    """Never reached: only the shadowed def annotates with it."""


def top():
    if phantom_marker():
        return phantom_marker()


def top():
    return winner_marker()


class C:
    def foo(self):
        self.dead_read
        local: DeadType = None

    def foo(self):
        self.live_read
        return winner_marker()


class D:
    def foo(self):
        self.d_read
        return winner_marker()


# --- The other half of the ruling: a DECLARATION CHAIN is not a rebinding. ---
# `@overload` stubs and property accessors exist to COEXIST, and the family
# ruling keeps them (ts/dupkey's "class-body overloads and get/set pairs
# untouched"). MEASURED on the pinned corpora: 21 of the 25 duplicate-name
# scopes are chains — 5 @overload groups in cython's Shadow.py, 9 in requests,
# and 7 accessor chains — so a BLANKET last-wins would delete real symbols and
# real setter bodies from both corpora. Every pin below therefore holds the rule
# in BOTH directions.
from typing import overload


@overload
def chained(value: int) -> int: ...


@overload
def chained(value: str) -> str: ...


def chained(value):
    return winner_marker()


class P:
    @property
    def size(self):
        return self._size

    @size.setter
    def size(self, value):
        self._size = value


# --- And the third shape: BRANCH ALTERNATIVES are not shadows either. ---
# Exactly one of these two runs, and which one is a runtime fact the source does
# not settle, so neither may be dropped. This is the CORPUS shape: 3 of the 4
# duplicate-name sites in cython that a block-blind rule removed are this one
# (Dependencies.record_results under `if os.environ.get('XML_RESULTS')`,
# runtests.skip_test under `try/except/else`, Pythran.pythran_is_numpy_func_
# supported under `if pythran is None`) — and removing them cost 2 real edges.
if alt_flag:
    def alt(value):
        return phantom_marker()
else:
    def alt(value):
        return winner_marker()
