# PY-30/PY-32 — three literal-vs-computed boundaries, all found by measurement.
#
# 1. An enum member's NAME is a declaration whatever its VALUE is.
#    `pstats.SortKey` is `class SortKey(str, Enum)` with members whose value is a
#    comma-separated list (`CALLS = 'calls', 'ncalls'`), and the analyzer published
#    5 of its 9 members, so 4 `contains` edges the tree supports were missing.
#    CPython: `pstats.SortKey.__members__` lists all nine, so `SortKey.CALLS`
#    resolves. Found by the DERIVATION paydown, not by a fixture — the oracle
#    reported them as missing and the analyzer was wrong.
#
# 2. `__all__ = 'a', 'b'` is the same declaration to `from mod import *` as
#    `__all__ = ['a', 'b']`, and the bare spelling parses as `expression_list`.
#    9 of 19 module-scope `__all__` sites in 678 corpus files used it and
#    published nothing.
#
# 3. What stays declined is the same rule read the other way: a name set that is
#    COMPUTED at run time is not a literal, and the analyzer declines rather than
#    publish half of it.

from enum import Enum


class Colour(Enum):
    RED = "r"
    SHADED = 1, 2
    PAIRED = ["a", "b"]
    BARE = "x", "y"


def bare_one():
    return None


def bare_two():
    return None


def added_later():
    return None


__all__ = "bare_one", "bare_two"


__all__ += ["added_later"]


__all__ = list(__all__) + ["declared_but_never_published"]