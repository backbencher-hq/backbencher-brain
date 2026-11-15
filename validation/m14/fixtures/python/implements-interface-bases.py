"""Python expresses interface conformance inside the BASE LIST - there is no `implements` clause.

Measured over the whole derived corpus (5,984 python files through production `parseFile`):
the grammar produces 117 node types and NONE of `interface_declaration`,
`protocol_declaration`, `abstract_class_declaration`, `implements_clause` or
`trait_declaration`, against 21,008 `class_definition` nodes. So the construct cannot arrive
as its own grammar node. It arrives as a base, and the analyzer was publishing every base as
`extends` - which is correct for `class C(Base)` and wrong for `class C(Mapping)`.

The distinction this fixture pins, in full:

  * a base this file PROVES is an interface emits `implements`, and does NOT emit `extends`.
    One base, one edge, most specific true label. This is the C# lane's identical call on the
    identical construct (real-csharp-analyzer.ts:1371-1380).
  * the proof is the file's OWN IMPORT, never the spelling. `ABC` is a legal name a user can
    define, so the third class below — one that declares its own class called `ABC` — must
    keep `extends`. That row is the whole reason the rule is an import test.
  * an ALIASED import proves the alias. `from abc import ABC as BaseABC` binds `BaseABC`,
    and a fix that looked for the name `ABC` would miss it and then relabel nothing at all.
  * `typing_extensions` proves `Protocol` exactly as `typing` does. Measured: pydantic
    writes `from typing_extensions import Protocol` in 21 of its base lists, so accepting
    only `typing` misses the corpus's largest source of Protocol declarations.
  * `typing.Generic` is NOT an interface and stays `extends`. Measured at 291 base
    occurrences across the corpus — more than `ABC` and `Protocol` combined — and it is a
    type-parameter marker. This row is why `implements` is 10 edges at NFILES=200 and not
    301.
  * `.register(X)` is homonym-proofed. Measured over 5,984 files: 493 `X.register(Y)` calls
    and ONE with a provably-abstract receiver. `site.register` alone is 241.
  * `metaclass=ABCMeta` DECLARES an interface and emits nothing, because the interface being
    declared IS the class: there is no second endpoint in the source, and a self-edge would be
    a fabrication.
"""

import abc
from abc import ABC, ABCMeta, abstractmethod
from abc import ABC as BaseABC
from collections.abc import Mapping, Sequence
from typing import Protocol
from typing_extensions import Protocol as BackportProtocol
from typing import Generic, TypeVar

T = TypeVar("T")


# --- emits `implements`: each proof route, one class -------------------------

class FromAbc(ABC):
    """`ABC` is proven by `from abc import ABC`: an abstract base class."""

    @abstractmethod
    def run(self):
        ...


class AliasedAbc(BaseABC):
    """The ALIAS form. The binding is `BaseABC`, not `ABC`."""

    @abstractmethod
    def run(self):
        ...


class FromCollectionsAbc(Mapping):
    """`collections.abc` is the standard library's interface catalogue. Every one of its 25
    exported names is an abstract base class — measured against CPython's own
    `_collections_abc.py`: 7 declare `metaclass=ABCMeta`, 18 inherit it from a base that
    does, and the module's one non-ABC class is not exported."""

    def __getitem__(self, key):
        raise KeyError(key)

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0


class Structural(Protocol):
    """A protocol is an interface: conformance is structural and may be declared."""


class Backported(BackportProtocol):
    """`typing_extensions` proves `Protocol` exactly as `typing` does."""

    def close(self):
        ...


class Dotted(abc.ABC):
    """Self-proving once the ROOT is bound: `import abc` is above."""


class Unbound(vendor_base.Protocol):
    """THE ROW THAT KILLS A MUTANT. `vendor_base.Protocol` is spelled exactly like the proven
    dotted forms, and this file never imports `vendor_base` — so it is not self-proving and
    the base is a user module's own class called `Protocol`.

    This class is here because mutant M6 removed the `importRoots.has(root)` condition and
    every one of the 21 python fixtures still passed: the only dotted base the fixture held
    was `abc.ABC`, which is genuinely provable, so dropping the condition changed no outcome
    anywhere. An instrument needs a case where the dropped condition is the ONLY thing
    standing between it and a fabricated edge, or the condition is untested rather than
    verified. Without this class M6 was a surviving mutant."""


class MixedBase(Sequence, Marker):
    """Two bases, TWO LABELS: one `implements` and one `extends`. The mix is what makes the
    relabel visible from the outside — an implementation that emitted both labels for both
    bases would publish four edges here, and one that relabelled everything would publish
    two `implements`."""


# --- stays `extends`: the spelling is not proof ------------------------------

class ABC:
    """A USER class named ABC. Legal python, and the reason the rule is an import test.

    `from abc import ABC` is in force in this file, so a proof keyed on the NAME rather than
    on the binding would relabel this class's base row too. It must stay `extends`.
    """

    pass


class Marker:
    pass


class NotAnInterface(Marker):
    """An ordinary class base."""


class GenericOnly(Generic[T]):
    """`Generic` is a type-parameter marker, not an interface.

    Measured at 291 base occurrences across the corpus — more than ABC and Protocol combined.
    Labelling it `implements` would have made `implements` the largest type in this analyzer
    and been wrong about every one of them.
    """


# --- declares an interface; emits nothing ------------------------------------

class DeclaresAbstract(metaclass=ABCMeta):
    """`metaclass=ABCMeta` says THIS CLASS is the interface. There is no second endpoint in
    the source, so no edge is published; a self-edge would be a fabrication. Measured: 85
    such classes in this corpus."""

    @abstractmethod
    def run(self):
        ...


class LocalAbstract(metaclass=abc.ABCMeta):
    """Same, spelled dotted."""


# --- virtual registration: conformance with no inheritance -------------------

class RowLike:
    """Registered against a proven interface rather than inheriting it."""


Sequence.register(RowLike)

# NOT a conformance declaration: `register` here is a method of an instance the analyzer
# has read nothing about, and the receiver is not proven to be an abstract base class.
# Measured: 492 of the corpus's 493 `.register(` calls are of this shape, `site.register`
# (241) and Flask's `blueprint.register` among them. An implementation keyed on the spelling
# would fabricate all 492.
_registry = {}
_registry.register(RowLike)