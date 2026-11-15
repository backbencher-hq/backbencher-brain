"""A QUALIFIED stdlib marker stays qualified under a subscript — PY-29.

`python/interface-implements` pins that a base spelled `abc.ABC` is the stdlib class
whatever else the file binds the bare name to, and it pins the positional rule for a
BARE name. Neither row can falsify the subscript case, because in that file the bare
name is bound to the stdlib on every relevant line — so the two readings agree and the
fixture cannot tell which one produced the edge.

This file removes the agreement. It imports `typing` and does NOT import `Protocol`
from it, and it declares a LOCAL class named `Protocol`, so:

  * the qualified reading says `typing.Protocol[RuntimeT]` is the stdlib protocol, and
    the class declares an interface;
  * the bare reading says the base is the local class three lines below, and the class
    declares nothing.

`Protocol[RuntimeT]` is a `subscript` node whose head is `dotted_name("typing.Protocol")`,
and the pre-pass read "qualified" as `b.type === "attribute"`. `extractClass` already
reads that head as qualified for `qualifiedBases` — the same rule, one position over, in
the same file — so the pre-pass was the odd spelling out. This fixture is what makes the
difference observable.
"""

import typing
from typing import TypeVar

RuntimeT = TypeVar("RuntimeT")


# A LOCAL class with the stdlib's name. Nothing in this file binds `Protocol` to the
# stdlib, so any rule that reads the bare name here is wrong, and `InheritsTheLocalProtocol`
# below is ordinary inheritance that must produce no edge.
class Protocol:
    def local(self) -> None:
        ...


class QualifiedProtocolBase(typing.Protocol[RuntimeT]):
    def run(self, payload: RuntimeT) -> None:
        ...


class SubQualifiedProtocolBase(QualifiedProtocolBase):
    def run(self, payload: RuntimeT) -> None:
        ...


class QualifiedAbcBase(typing.Generic[RuntimeT]):
    def run(self, payload: RuntimeT) -> None:
        ...


# A subclass of a class whose ONLY qualification is a dotted non-marker head. This is
# the row that pins WHICH dotted head matters: a rule that accepts any qualified base
# as an interface marker makes `QualifiedAbcBase` one, and this edge appears.
class SubQualifiedAbcBase(QualifiedAbcBase):
    def run(self, payload: RuntimeT) -> None:
        ...


class InheritsTheLocalProtocol(Protocol):
    ...