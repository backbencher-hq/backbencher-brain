"""PEP-695 type parameters are TYPES the signature introduces, and they bind nowhere else.

`def first[U]` declares `U` in the def's own lexical scope. The annotation references it, the
reference is honest, and no project-wide declaration can exist for it — publishing a file-scope
symbol would be a lie about scope, and two `def f[T]` in one file would publish two symbols of one
name, which the store can only call ambiguous.
"""

import typing

T = typing.TypeVar("T")


def identity(value: T) -> T:
    """CONTROL: a module-level TypeVar is NOT a PEP-695 parameter — the position stays the reason."""
    return value


def first[U](items: list[U]) -> U:
    """Both positions, one parameter: the annotation's and the return's."""
    return items[0]


class Box[V]:
    """A CLASS-scoped parameter, referenced from a method one scope deeper."""

    def get(self, item: V) -> V:
        return item


def bounded[W: int](value: W) -> W:
    """A BOUNDED parameter: the bound (`int`) is not the name, and the name is still the name."""
    return value
