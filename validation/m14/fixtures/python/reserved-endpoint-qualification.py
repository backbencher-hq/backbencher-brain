"""A member whose name collides with a reserved scope name must publish a QUALIFIED endpoint.

Standing rule R7 (`validation/m60/ledger.json`) forbids an edge endpoint equal to the
placeholder literal `unknown`, and `unknown` is a member of the indexer's own
`GENERIC_SOURCE_NAMES` (`src/ast/parallel-indexer.ts:3519`). So an edge whose endpoint is the
bare word `unknown` cannot be told apart from a synthetic scope by anything downstream.

This is not a hypothetical shape. CPython's own `uuid.py` has it:

    class SafeUUID(Enum):
        safe = 0
        unsafe = -1
        unknown = None

    def uuid1(...):
        ...
        if is_safe is SafeUUID.unknown:

`SafeUUID.unknown` is a real member of a real class, reachable in Python with no lookup
machinery. Measured over the whole derived corpus (5,984 python files through production
`parseFile`), 7 emitted edges carried a reserved endpoint and all 7 came from this construct:
1 `contains` and 6 `uses`, four of them in `uuid.py` itself.

The edge is NOT dropped. The containment and the read are both true, and `SafeUUID.unknown`
is the name Python gives it. What changes is that the endpoint is published qualified by its
owner, which is how every other member edge in this analyzer is already shaped, so resolution
finds the member instead of the store's synthetic-scope list matching first.

THE FORBID ROWS ARE THE POINT. `self.unknown` is instance state this analyzer has never seen
declared, so no owner can be invented for it and the bare spelling stands. A fix that
qualified every reserved-looking leaf would pass the two positive rows and fabricate an owner
on those, which is the fabrication rule R7 exists to prevent.
"""

from enum import Enum


class SafeUUID(Enum):
    """The stdlib shape, reproduced exactly: an enum member NAMED `unknown`."""

    safe = 0
    unsafe = -1
    unknown = None


class Signed(Enum):
    """PY-27: a SIGNED numeric value is still a constant.

    `-1` parses as a `unary_operator` wrapping an `integer`, not as an `integer`, so the
    enum-member rule missed it and `SafeUUID.unsafe` was absent from the graph — in
    CPython's own stdlib. Measured over the derived population: 1 site in 253 enum members
    across 132 enum classes, so the number is small and the member is still a real member
    of a real stdlib class. Found by the INDEPENDENT DIFFERENTIAL, not by a gate: the oracle
    derives the class body from the tree and reported `missing contains SafeUUID -> unsafe`
    while every fixture was passing.

    The operator token is an ANONYMOUS child — `child(0) = "-"` with `isNamed === false` —
    so a scan over named children finds no operator and excludes every signed numeric. That
    is the third time in this session an off-by-a-child mistake turned a real construct into
    a measured zero (see the two recorded in script/m14/python-construct-census.mts)."""

    negative = -1
    positive = +3
    ratio = -0.5


class NotConstant(Enum):
    """BOUNDARY: `~x` and `not x` are also `unary_operator` nodes and NEITHER is constant.

    A fix that accepted any unary_operator would publish members for these and invent an enum
    surface the source does not declare."""

    inverted = ~1
    negated = not True


class Plain(Enum):
    """A member with an ordinary name keeps its bare endpoint — the 88,535 `contains` edges
    that resolve at 100.0% must not all be rewritten in order to fix 7."""

    safe = 0


class Holder:
    """`self.unknown` is instance state, never declared here, so never qualified."""

    def __init__(self):
        self.unknown = None

    def read(self):
        return self.unknown

    def read_enum(self):
        return SafeUUID.unknown

    def set_it(self):
        self.unknown = 1


class Reading:
    def outer(self):
        return SafeUUID.unknown


def make():
    h = Holder()
    h.unknown = 1
    return h