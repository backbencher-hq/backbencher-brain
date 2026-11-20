"""A class VARIABLE is not a method, and cannot be overridden.

The fourth genuine analyzer defect the independent oracle found, and the most damaging shape of
the four: it FABRICATED an edge **and marked it verified**. The override check asked whether the
base declared *a symbol with that name*, and a class variable satisfies that:

    class Base:
        attr = None            # a class variable, not a method

    class Derived(Base):
        def attr(self): ...    # a method

published `overrides Derived.attr -> Base.attr` at **0.95 with no `reasonCode`** — which reads as
a verified fact and is not one. There is no method to override: `Base.attr` is the value `None`.

CPython settles it, and not as a matter of convention. `ast` over this file reports `Base`'s
members as `attr(var)` and `CONSTANT(var)` and `Derived`'s as `attr(def)` and `CONSTANT(def)`,
and python keeps those two kinds apart in the class `__dict__` — a variable and a method with the
same name are different members, and only one of them is inheritable in the sense `overrides`
describes.

The corpus makes this common rather than exotic. Cython declares class state at class level, so
`Cython/Compiler/Nodes.py` has `code_object = None` in `FuncDefNode` at L1996 and a `code_object`
property in `CFuncDefNode` — which is how the oracle surfaced this as 20 fabricated *verified*
edges concentrated in a single file. Confidence is what makes it the worst of the four: a
fabricated edge at 0.5 is visibly uncertain, and this one was fabricated at 0.95.

The three `Real` rows at the bottom are the other side of the line. A base that really does
declare the method must keep its override, so a fix that simply stopped matching on name — or
stopped matching at all — would pass every forbid here and lose real edges.
"""

from decimal import Decimal


class CythonStyle:
    """The shape Cython uses: instance state declared as class-level variables."""

    code_object = None
    is_cyfunction = False

    def compile(self):
        return self.code_object


class Derived(CythonStyle):
    code_object = None
    CONSTANT = 42

    def compile(self):
        return 1

    def is_cyfunction(self):
        return True


class Real:
    def target(self):
        return 1

    @property
    def decorated(self):
        return 2


class RealChild(Real):
    def target(self):
        return 3

    @property
    def decorated(self):
        return 4


class RealGrandparent:
    def mro_target(self):
        return 1


class RealIntermediate(RealGrandparent):
    pass


class RealMroChild(RealIntermediate):
    def mro_target(self):
        return 2