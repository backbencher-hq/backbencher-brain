"""PY-D17 — A CLAUSE THE PARSER FLAGGED NAMES NO TYPE, and the clean clauses beside it keep theirs.

THE FABRICATION. `double[:]` is VALID CPython: an annotation is an arbitrary expression, and
`double[:]` is a slice of the name `double`. tree-sitter's python grammar rejects it, so the whole
parameter list of `garbled` below collapses into ONE `typed_parameter` that swallowed the second
parameter — and the analyzer read the resulting `constrained_type` and published
`references garbled -> o`, in which a PARAMETER is claimed to be a type. Same class as PY-D11
(a keyword argument's NAME published as a type) and as the empty-identifier guard.

WHAT THE FIX REFUSES AND WHAT IT KEEPS, checked in both directions:
  - `garbled` (the CLAUSE contains a parser error): NO reference at all. The cost is declared —
    the well-formed-looking `double`/`Optional` inside that same clause go with it, because a name
    read out of a structure the parser got wrong is luck, not reading.
  - `clean_subscript` / `clean_union`: ordinary annotations whose clauses parse cleanly keep
    `Optional`, `list`, `Sequence`, `Mapping`, `dict` — the fix must not become a blanket silence.
  - `slice_alone_keeps_its_type`: `def slice_alone_keeps_its_type(d: double[:]) -> None` still
    publishes `double`. In its tree the `type` clause is `(type (identifier))` and the ERROR is a
    SIBLING of it, so the clause is honest and the name at that position IS `double`. Refusing it
    would be the over-claim direction of the same mistake.
"""

from typing import Optional, Sequence
from typing import Mapping


def garbled(d: double[:], o: Optional[double[:]]):
    """FORBIDDEN: `references garbled -> o` (a parameter published as a type)."""
    return None


def clean_subscript(o: Optional[list[int]]):
    """KEPT: a clean clause still names `Optional` and `list`."""
    return None


def clean_union(x: "Sequence[str]", y: Mapping[str, dict]):
    """KEPT: a clean clause still names `Sequence`, `Mapping` and `dict`."""
    return None


def slice_alone_keeps_its_type(d: double[:]) -> None:
    """KEPT: the clause is clean here (the ERROR is its sibling), so `double` IS a type name."""
    return None


# THE SAME RULE ON THE CALL SIDE. A region the parser flagged yields no CALLEE either, and this is
# the minimized shape of the ASN.1 corpus case (`otp/lib/asn1/test/asn1_SUITE_data/*.py`, documents
# carrying a `.py` extension): the malformed annotation immediately above leaves what follows inside
# a region tree-sitter could not read, and `SIZE(1)` therefore sits in it. Without the guard the
# analyzer published `calls module -> SIZE`, a callee read out of a region it did not understand.
malformed_annotation: double[:]
SIZE(1)
