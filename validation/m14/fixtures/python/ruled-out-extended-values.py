# fixture: python/ruled-out-extended-values
# THE CLASSIFICATION FIXTURE for the four EXTENDED relationship values, in ONE file.
#
# The lane's bar is the all-out-of-all rule: `n/n` where `n` is the language's OWN
# expressible set, and every value outside `n` must be RULED with a citation rather
# than left unclassified. For python the four extended values are:
#
#   decorates  IMPLEMENTED — a decorator is APPLIED TO a declaration
#   renders    RULED grammar-absence — no `jsx_*`/element/component node in the pinned grammar
#   mixes_in   RULED grammar-absence — no `mixin*` node and no mixin field in the pinned grammar
#   part_of    RULED grammar-absence — no `part_*` node in the pinned grammar
#
# A ruling that is only PROSE is not a ruling: it is not checkable, and a reader cannot
# tell a language that CANNOT express a construct from a lane that merely did not
# implement it. So this fixture puts the three ruled-out values NEXT TO the python
# constructs that are their nearest neighbours, and asserts BOTH directions:
#
#   POSITIVE — the nearest python construct IS published, with the RIGHT label:
#              multiple inheritance -> `extends` (one row per base, python's ONE clause)
#              a module import       -> `imports`
#              a decorator           -> `decorates`
#
#   NEGATIVE — the ruled-out value is NOT emitted, EVEN WHERE THE NEAREST CONSTRUCT IS
#              PRESENT. This is the half a prose ruling cannot fake: an implementation
#              that quietly started emitting `mixes_in` for a second base would pass
#              every positive row in this file, and fail these.
#
# THE THREE DECOYS ARE HERE ON PURPOSE, and each is named in the expectation:
#   1. `class Combined(Base, Mixin)` — python's multiple inheritance. The NEAREST thing
#      to a mixin composition, and the reason `mixes_in` is a genuine ruling rather than
#      an oversight: python's source CANNOT say which base is the mixin, because the
#      grammar has ONE superclass clause and no mixin clause. Both bases are `extends`.
#   2. `with open(path) as handle:` — python's CONTEXT MANAGER statement. It shares the
#      keyword `with` with Dart's `class C with M` and nothing else; a naive prefix test
#      on `with` would have "found" a mixin clause here. It is the decoy that makes the
#      ruling checkable.
#   3. `TEMPLATE = "<h1>{{ title }}</h1>"` — a template. python's templates are STRING
#      LITERALS, so the rendered tree is not in the AST at all; the nearest construct
#      that produces an object from a name is a CALL, and it is published as `calls`.
#
# The `part_of` ruling's nearest construct is the module import, and an import names a
# module and creates binding scope — a part shares the library's single scope and
# imports nothing — so it is published as `imports` and never as `part_of`.
import os


class Base:
    def name(self):
        return "base"


class Mixin:
    def label(self):
        return "mixin"


class Combined(Base, Mixin):
    """TWO bases, python's ONE superclass clause. Two `extends` rows, zero `mixes_in`."""

    def describe(self):
        return self.name() + self.label()


TEMPLATE = "<h1>{{ title }}</h1>"
"""A python template is a STRING LITERAL: the rendered tree is not in the AST, so there
is nothing for a `renders` edge to point at. The nearest python construct that produces
an object from a name is a CALL."""


def helper(value):
    return value


def read(path):
    with open(path) as handle:
        return helper(handle.read())


def logged(fn):
    return fn


@logged
def write_row(path):
    return os.path.join(path, "row")
