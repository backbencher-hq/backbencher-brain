"""A class nested in a class body is a member of it; a class nested in a METHOD is not.

Found by the independent oracle, and it is the first genuine ANALYZER defect in this review
— every earlier disagreement turned out to be the instrument's own. The differential reported
66 `contains` edges the tree supports and the analyzer did not emit, across 24 corpus files
(`_Multipart._Part` in `urllib/parse.py`, `CryptFacade._CryptData`, and a dozen class-in-class
test fixtures). No fixture, mutant or completeness gate had seen it, because `contains` is
derived from `ownerName` and a nested class simply had none.

The distinction this file pins is the whole content of the fix:

  * `Outer.Inner` is reachable from `Outer` in Python with no lookup machinery, so a class
    written in a class body is a MEMBER of it — the nesting is containment, not a lexical
    coincidence;
  * a class written inside a METHOD is a LOCAL of that method. `Outer.Deep` does not resolve,
    so publishing `contains Outer -> Deep` would put a name on the outer class's surface that
    the source does not give it. That is the forbid row below, and it is the half of the
    change that is easy to get wrong in the eager direction.

The third property is load-bearing elsewhere and is pinned here rather than in a store test:
a nested class carries `ownerName`, so the indexer's owner-qualified `nameToSymbol` key
resolves it, which is the same dependency `python/owner-name-stripped` exercises.
"""


class Outer:
    """A class in a class body is a member."""

    class Inner:
        """Reachable as `Outer.Inner`."""

        attribute = 0

        def method(self):
            return 1

    def outer_method(self):
        """A class in a METHOD is a local, not a member of `Outer`."""

        class Local:
            def local_method(self):
                return 2

        return Local()


class Sibling:
    """A module-level class is ownerless — Python has no module declaration."""


def factory():
    """A class in a plain function is a local of it."""

    class AlsoLocal:
        pass

    return AlsoLocal()
