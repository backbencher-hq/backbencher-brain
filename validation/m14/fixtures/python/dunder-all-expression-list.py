"""`__all__ = "a", "b"` is the same declaration as `__all__ = ["a", "b"]`.

The third spelling, and the one PY-14's tuple fix left behind. The grammar gives a
bare comma-separated RHS its OWN node — `expression_list` — so it is neither the
`list` nor the `tuple` the allowlist read, and a module that declares its public
surface this way published NOTHING.

CPython 3.10's own standard library is where the measurement lives: `__all__` is
assigned in 238 files and 9 of them use this spelling. `asyncio/coroutines.py` line
1 is exactly this:

    __all__ = 'coroutine', 'iscoroutinefunction', 'iscoroutine'

which is 3.8% of the standard library's declared public surfaces, invisible for a
reason that has nothing to do with the author. On the pinned bb_tests corpus the
count is 0 — no `__all__` there is spelled this way — and that 0 is reported as 0
rather than folded into the stdlib number.

What is NOT read stays unread, and is pinned as a boundary below rather than left as
prose: a comprehension and a concatenation both require evaluating an expression, and
this lane does no data flow.
"""

import collections


def coroutine(func):
    """Named by the expression_list spelling below."""
    return func


def iscoroutinefunction(obj):
    """Also named by it."""
    return False


class _Hidden:
    """Never named, so never exported."""


# THE SPELLING. `from asyncio.coroutines import *` binds these three names.
__all__ = "coroutine", "iscoroutinefunction", "_Hidden"

# DECLARED BOUNDARY, forbidden below: a CONCATENATION is a binary expression, not a
# literal, and evaluating `A + B` is a data-flow question.
__all__ = "coroutine" + ("iscoroutinefunction",)

# DECLARED BOUNDARY, forbidden below: a COMPREHENSION has no statically knowable
# member list even when every element happens to be a string.
__all__ = [name for name in dir(collections)]