"""Two classes may share a name; a class's bases belong to its DECLARATION.

The third genuine analyzer defect the independent oracle found, and the subtlest of the three
because it does not add or remove an edge — it points an existing edge at the wrong class.

`basesByClass` was keyed by class NAME. In a file that declares the same class name more than
once, every lookup merged them, so a `class C` that extends NOTHING inherited the bases of an
unrelated `class C(Base)` declared elsewhere in the file and published overrides to them.

CPython is the referee and it disagrees. For this file it reports:

    L7   class C(bases: ['Base'])
    L11  class C(bases: None)

and the lane emitted `C.m -> Base.m` at the line of BOTH `m` definitions — so a class
extending nothing claimed to override a method it does not inherit. Read the wrong way, that
edge says `C` has a base; read as a graph it says `C` participates in an inheritance it was
never part of, and every traversal from it lands in the wrong subtree.

The converse is pinned too, because the fix is a scope and a scope has two sides: the class
that DOES extend `Base` must keep its override. A change that simply stopped emitting when a
name repeats would pass the forbid rows and lose a real edge.

`ObjectProxy` in the middle is the #299 rebind: `class ObjectProxy(ObjectProxy)` shadows an
IMPORT of the same name, so the base is external and the class overrides nothing. The leaf is
still recorded in metadata — nothing is lost — but the `extends` edge and any self-override are
correctly absent, and the same exclusion has to apply to BOTH derivations. Reading overrides
from base metadata without re-applying it made every such class publish `C.m -> C.m`, which is
how this fixture caught a regression in the fix for this very defect.
"""

from decimal import Decimal


class Base:
    def m(self):
        return 1


class ObjectProxy(ObjectProxy):
    """The #299 rebind: the base is the IMPORT, not a local namesake."""

    def m(self):
        return 2


def make():
    class C(Base):
        def m(self):
            return 3

    class C:
        def m(self):
            return 4

    return C()


class Unrelated:
    def m(self):
        return Decimal(1)