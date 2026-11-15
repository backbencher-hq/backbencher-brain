"""`__all__` is python's public surface, and it is the only one that is DECLARED.

A python module has no `export` keyword. What it has is `__all__` — a list of
names the author states are the module's public surface, and which every real
packaging tool, linter and documentation generator reads. It is the closest thing
python has to an export declaration, and it is entirely explicit.
"""


def public_function():
    """In `__all__`, list spelling."""


def _private_function():
    """In `__all__`, tuple spelling. The underscore is NOT the filter — see below."""


def also_public():
    """In the SECOND `__all__` — which is read too, not shadowed by the first."""


def from_the_second_list():
    """In the second `__all__` only."""


class PublicClass:
    """A class named in `__all__`."""


# A tuple is the other ordinary spelling, and it is what older python uses. A
# lane that read only `list` loses this whole declaration.
__all__ = ("public_function", "PublicClass", "also_public")

# The SET is the claim, not the order, and a leading underscore is not a filter.
# `_private_function` is exported because the AUTHOR put it in `__all__`; a rule
# that filtered on the underscore would drop it, and would agree with a correct
# lane only by accident.
_EXPORTED_BY_TUPLE = "_private_function"
__all__ = ["_private_function", "from_the_second_list"]

# DECLARED BOUNDARY, and pinned by forbidRelationships below: an `__all__` built
# by CONCATENATION or by a NAME is not read. The analyzer derives exports
# syntactically — a list or tuple literal assigned directly to `__all__` — so
# evaluating `_A + _B` or `__all__.extend(_C)` is a data-flow question and not a
# read. This is a missing edge rather than a wrong one, and the measurement
# behind the decision is in reviews/python/master-review.md: over 400 pinned
# corpus files, 16 `__all__` assignments, of which 3 were tuples (now read) and
# the rest list literals.
__all__ = ["also_public"] + ("from_the_second_list",)
__all__.extend(["never_read_either"])
