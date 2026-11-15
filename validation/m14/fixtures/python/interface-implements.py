# PY-27 — `implements`: python states interface conformance in the BASE LIST.
#
# Every shape below is legal python, and every shape is decided by the header
# rather than by a naming convention. CPython 3.10.12 is the referee; the probe
# that produced these rows is written out at PY_INTERFACE_STDLIB_LEAVES in
# src/ast/real-python-analyzer.ts.
#
# The three rows that matter most are the ones that must NOT fire:
#   * `Plain(object)` with an @abstractmethod is NOT an interface. Measured:
#     type(ProductBuilder) is `type`, `__abstractmethods__` does not exist on it,
#     inspect.isabstract is False, and it INSTANTIATES. An @abstractmethod on a
#     class whose metaclass is `type` is a marker and nothing else.
#   * `Local` is a class, not an interface: inheriting from it is ordinary class
#     inheritance whatever its methods look like.
#   * `RebindsMarker` inherits a name the file bound to its OWN class, so it is
#     inheriting a class. Positional, because python is: the base expression is
#     evaluated against the module globals as they stand on that line.

import abc
from abc import ABC, abstractmethod
from typing import Protocol


class Repository(ABC):
    def save(self):
        raise NotImplementedError


class Service(Repository):
    def save(self):
        return None


class Reader(Protocol):
    def read(self):
        ...


class ConcreteReader(Reader):
    def read(self):
        return ""


class MetaclassShape(metaclass=abc.ABCMeta):
    def go(self):
        return None


class InheritsMetaclassShape(MetaclassShape):
    def go(self):
        return None


class Plain:
    @abstractmethod
    def never_enforced(self):
        ...


class InheritsPlain(Plain):
    def other(self):
        return None


class Local:
    def thing(self):
        return None


class InheritsLocal(Local):
    def other(self):
        return None


class AboveTheRebind(ABC):
    # Declared BEFORE the local `class ABC` below, so this base IS the stdlib class: the
    # binding the base expression sees on this line is `from abc import ABC` at L20.
    #
    # The two classes here are one rule pinned from both sides, and the fixture prose
    # stated it before the file showed it: the row set used to hold only the negative half
    # (the forbid on `BelowTheRebind`), which a rule keyed on the SPELLING passes for the
    # wrong reason. The two classes were reordered to match the prose, so the pair now fails
    # whichever half of the positional test is dropped.
    def still_the_stdlib(self):
        return None


class ABC:
    # A LOCAL class with the stdlib's name. From here DOWN the name `ABC` is this class, so
    # a base written below is ordinary class inheritance whatever the import above says —
    # python evaluates the base expression against the module globals as they stand on that
    # line, which is the whole reason this rule is positional.
    def looks_like_the_marker(self):
        return None


class BelowTheRebind(ABC):
    def now_the_local_class(self):
        return None