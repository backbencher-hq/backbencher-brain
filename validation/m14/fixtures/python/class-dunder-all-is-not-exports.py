"""A class `__all__` is a class ATTRIBUTE. `import *` never reads it.

Two defects in one construct, and they point in OPPOSITE directions — which is why they
survived a full review cycle together and why the differential reported only one of them.

    class CythonDotParallel:
        __all__ = ['parallel', 'prange', 'threadid']   # cython/Cython/Shadow.py:786

**The false edge.** `__all__` is the MODULE's export contract. `from shadow import *` reads the
module binding and looks nowhere else, so a class body that assigns `__all__` publishes nothing.
The lane read the assignment wherever it found it and emitted `exports Shadow -> parallel`,
`-> prange`, `-> threadid`: a public surface on `Shadow` that the author never wrote. Those edges
existed for the whole life of the feature, and the independent oracle AGREED with them — because
my oracle derived exports from any `__all__` assignment too, with the same unstated assumption.
Two derivations agreeing is evidence only if the assumption behind them is checked by something
outside both. Here nothing was, and the report was clean: 96 agreed `exports`, 0 missing, 0
unexplained, on a graph that was wrong.

So the first half of this fixture is `forbid` rows for names that must never be exported, and the
reason they are here is a process failure as much as a code one: a differential cannot find a
shared blind spot, only a fixture pinned on the SEMANTICS can.

**The missing edge.** `__all__` in a class body is still a real member — it is in that class's
`__dict__` like any other — and the lane published no `contains` for it either, because the
`__all__` branch returned before reaching the class-member path. That one the differential DID
catch, as the single remaining `missing` row, which is the only direction of that report that
means something is absent rather than over-claimed.

**The boundaries that must survive.** A function-local `__all__` is a local and publishes
nothing. A module-level `__all__` inside `if __name__ == "__main__":` is still module scope and
does publish: `if` does not open a scope, so a fix that gated on "the node is at column 0" or on
"not inside any control-flow construct" would keep these two rows wrong.
"""


class Namespace:
    __all__ = ["alpha", "beta"]

    def go(self):
        return 1


def scope_is_not_module():
    __all__ = ["local_only"]
    return local_only


def entry_point():
    return Namespace


if __name__ == "__main__":
    __all__ = ["entry_point"]

__all__ = ["Namespace"]