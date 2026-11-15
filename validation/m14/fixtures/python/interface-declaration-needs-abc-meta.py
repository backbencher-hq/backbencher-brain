"""`implements` needs an ABCMeta-shaped HEADER — PY-29.

`python/interface-implements` pins the three ways a base is DECLARED an interface
(`ABC`, `Protocol`, `metaclass=ABCMeta`) and the positional binding rule. This file
pins the boundary that file could not state as a row, because the boundary is not
about which base was named: it is about a class that NAMES AN INTERFACE AND DECLARES
NONE.

CPython is the referee, and it is unambiguous. `__abstractmethods__` is computed by
`ABCMeta.__new__`, so an `@abstractmethod` on a class whose metaclass is `type` is a
marker the interpreter does nothing with:

    class ProductBuilder(object):      # metaclass is `type`
        @abc.abstractmethod            # __abstractmethods__ == frozenset()
        def build(self): ...          # ProductBuilder()  ->  INSTANTIATES

Four of these exist in one real corpus file — swift-corpus's
`swift_build_support/products/product.py` declares `class ProductBuilder(object)` at
L544 with `@abc.abstractmethod` at L562/587/597/606 — so the shape is not exotic, and
before this fixture it produced a FABRICATED `implements` edge at confidence 1.0 with
`evidenceClass: structural` for every subclass of such a class.

The other half is the ORDER the decorator used to be recorded in. The pre-pass set
`hasAbstractDecorator` on the FIRST class in the file that did not already have it,
rather than on the class the decorator decorates, so in a file where a plain class
precedes the class carrying `@abstractmethod` the plain class became "an interface" and
a subclass of IT got the fabricated edge instead.

Both are pinned as forbid rows. The rows below the forbids are there so that deleting
the rule cannot satisfy them either: the ABCMeta-shaped shapes must still fire.
"""

import abc
import typing
from abc import ABC, ABCMeta, abstractmethod
from typing import Protocol, TypeVar

RuntimeT = TypeVar("RuntimeT")


# =============================================================================
# MUST NOT: a bare `@abstractmethod` with no ABCMeta-shaped header.
# CPython: metaclass=type, __abstractmethods__ == frozenset(), constructs fine.
# =============================================================================
class NoopAbstract(object):
    @abc.abstractmethod
    def build(self):
        ...


class SubNoopAbstract(NoopAbstract):
    def build(self):
        return 1


# The same shape under the two other abstract-decorator spellings. `abstractproperty`
# and `abstractclassmethod` are aliases CPython folds into `abstractmethod` at class
# creation, so they are the same no-op on the same class.
class NoopAbstractDecorators(object):
    @abc.abstractproperty
    def name(self):
        ...

    @abc.abstractclassmethod
    def create(cls):
        ...


class SubNoopAbstractDecorators(NoopAbstractDecorators):
    def name(self):
        return "x"

    @classmethod
    def create(cls):
        return cls()


# =============================================================================
# MUST NOT: the ORDER half. `Plain` is declared BEFORE `RealContract`, so a
# decorator-attribution rule that records the flag on the first class in the file
# makes `Plain` an interface and takes this fabricated edge in its place.
# =============================================================================
class Plain(object):
    def helper(self):
        return 0


class RealContract(ABC):
    @abstractmethod
    def contract(self):
        ...


class SubPlain(Plain):
    pass


# =============================================================================
# MUST FIRE: the three header shapes `python/interface-implements` already pins,
# repeated here so that deleting the header test cannot pass this file by leaving
# nothing to delete.
# =============================================================================
class AbcBase(ABC):
    @abstractmethod
    def go(self):
        ...


class SubAbcBase(AbcBase):
    def go(self):
        return 2


class MetaclassBase(metaclass=ABCMeta):
    @abstractmethod
    def go(self):
        ...


class SubMetaclassBase(MetaclassBase):
    def go(self):
        return 3


class ProtocolBase(Protocol):
    def close(self) -> None:
        ...


class SubProtocolBase(ProtocolBase):
    def close(self) -> None:
        ...


# =============================================================================
# MUST FIRE: a QUALIFIED `Protocol` base under a subscript. `Protocol[RuntimeT]` is
# the ordinary way to parameterise a protocol, and its base node is a `subscript`
# whose head is `dotted_name("typing.Protocol")`. The pre-pass used to read
# `b.type === "attribute"` for "qualified", so this head was classified as a BARE name
# and resolved against whatever this file last bound `Protocol` to — which on this
# line is the stdlib class, so the edge happens to be right here, and the rule that
# produced it is the one that is wrong: it reached the right answer through a
# positional binding test on a name that had been spelled qualified.
# =============================================================================
class ParameterisedBase(typing.Protocol[RuntimeT]):
    def run(self, payload: RuntimeT) -> None:
        ...


class SubParameterisedBase(ParameterisedBase):
    def run(self, payload: RuntimeT) -> None:
        ...


# =============================================================================
# MUST NOT: `Protocol` imported from a project module is that project's own type.
# The stdlib spelling is the only one this rule claims, so an unqualified `Protocol`
# bound by anything but `from typing import …` is ordinary inheritance.
# =============================================================================
class NotStdlibProtocol:
    def call(self) -> None:
        ...


# =============================================================================
# BOUNDARY, pinned so it stays visible: an ABC-shaped class with NO abstract member
# is still treated as declaring an interface. CPython instantiates it
# (`__abstractmethods__` is empty), so this lane's `implements` is a DECLARED
# interface relationship and not an enforced one — see the limitations section of
# docs/analyzers/real-python-analyzer.md. `python/interface-implements` already
# depends on this reading for its `Qualified(abc.ABC)` row; it is pinned here by
# name so that a future move to the enforcement reading has to break this row on
# purpose.
# =============================================================================
class EmptyAbc(ABC):
    ...


class SubEmptyAbc(EmptyAbc):
    pass