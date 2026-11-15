"""An edge endpoint has to name something a consumer can REACH.

`class C(unittest.TestCase)` publishes `extends C -> TestCase`. `TestCase` is a
member of a module this file imported, not a name this file declares — so the edge
joins to nothing inside the parse, and the qualifier that would make it reachable
(`unittest`) was discarded by the leaf reduction. Same shape for a member read:
`pa.Table` published `uses build_table -> Table`, and `Table` is pyarrow's.

Measured over the 679-file INCOMING_PY corpus, before the `qualified` spelling was
recorded:

    extends    484 edges    84 (17.4%) resolved to a symbol the parse declared
                          400 (82.6%) resolved to nothing at all
    uses     14,580 edges  4,553 (31.2%) in-file, 9,069 (62.2%) to nothing

After, with the written spelling on the edge (`script/m60/python-resolution-census.ts`):

    extends    484 edges    84 in-file, 344 (71.1%) reachable through the import root
    uses     14,580 edges  4,553 in-file, 9,069 (62.2%) reachable through the receiver

The leaf is still the TARGET — that is the member, and it is what a reader wants to
see. The written spelling is what makes it findable, and it is the same field `calls`
has carried since PY-11.

A base spelled as a bare identifier gains nothing from this and records none: there is
no receiver to record. That is why the `Local` rows below carry no `qualified`.
"""

import unittest
import pyarrow as pa


class SiblingCase(unittest.TestCase):
    """The real shape: the base is a MEMBER of an imported module."""


class Bare:
    """A base named by a bare identifier — no receiver, so no spelling to record."""


class Derived(Bare):
    """Extends a class declared in this file."""


def read_rows(table: pa.Table) -> int:
    """A member read through an import ALIAS, which is the common form."""
    return table.num_rows


def read_local(rows) -> int:
    """A member read through a parameter, whose type is written down nowhere."""
    return rows.num_rows