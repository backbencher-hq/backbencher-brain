"""A name that LOOKS like an interface, in a file that never bound any of them, stays `extends`.

The other `implements` fixture proves the rule fires. This one proves the rule does not fire
when the evidence is absent, which is the half a "does it work" test never covers and the
half that keeps the new type from becoming a fabrication.

Everything below is spelled like a proven interface and proven by nothing: this file imports
no interface module at all. Python does not require one either — a name is a name until
something binds it — so `class C(ABC)` here is a perfectly ordinary class called `ABC`, and
`class D(abc.ABC)` is a base in some module this analyzer has not read.

Measured context, from the same corpus the rules were derived over:
  * 27 base occurrences of `Protocol` in the corpus are exactly this shape — 24 inside
    CPython's own `typing.py`, which DEFINES the class `Protocol` and then inherits from it,
    plus asyncio's local `protocols` module. Every one of them is a correct `extends`.
  * `ABC` is a legal python class name and users define it. Keying the proof on the spelling
    instead of on the binding would relabel all of these.

THE TWO GUARDS THIS FILE EXISTS TO MAKE LOAD-BEARING:

  * the root-import condition on a dotted base (`abc.ABC` proves itself only once this file
    has bound `abc`). Mutant M6 deleted that condition and every python fixture passed,
    because the only dotted base the other fixture held was `abc.ABC` — which matches the
    specific string anyway, so deleting the condition changed no outcome anywhere. A
    condition nothing tests is not a verified condition.
  * the shape guard that stops the bare-name proof from firing on a DOTTED base. In a file
    holding `from typing import Protocol` and `class C(vendor.Protocol)`, the bare route
    fires first and relabels a third-party class that shares a leaf with the stdlib one.
    `typing.Protocol` and `vendor.Protocol` share a leaf and nothing else.

A file with no interface import is also the cheapest possible regression test: if any rule in
`collectInterfaceBindings` or `interfaceBaseKind` ever stops consulting the bindings, every
row below flips at once.
"""

from vendor.abc import ABC as VendorABC  # a class called ABC, in a module called vendor
from vendor.typing import Protocol as VendorProtocol
import collections  # binds the ROOT but imports no interface name


class Local:
    """An ordinary base, declared here. Nothing about this file makes it an interface."""


class Shadow(Local):
    pass


class BareABC(ABC):
    """`ABC` here is undefined in this module. Publishing `implements` would name a symbol
    the analyzer has never seen and that this file does not import."""


class BareProtocol(Protocol):
    """Same, for `Protocol`."""


class BareMapping(Mapping):
    """Same, and the most tempting of the three: `Mapping` is the most frequent
    `collections.abc` import in the whole corpus, so a rule keyed on the spelling rather
    than on the binding would relabel this."""


class DottedABC(abc.ABC):
    """Spelled exactly like a self-proving dotted base, and `abc` is NOT bound here — the
    only import is `collections`. This is the row M6 needs."""


class DottedProtocol(typing.Protocol):
    """`typing` is not bound here either."""


class DottedMapping(collections.abc.Mapping):
    """THE CONTRAST ROW, and the positive one.

    `abc.ABC` above stays `extends` because this file never binds `abc`. THIS one emits
    `implements`, because `import collections` is above and `collections.abc.X` is the
    standard library's own namespace - there is no plausible user module named `collections`
    to shadow it, which is exactly the argument that makes `abc.ABC` self-proving once `abc`
    is bound. Two dotted bases of identical shape in one file, opposite verdicts, and the
    only difference is whether the root was bound.

    This row exists because writing the fixture with `import collections` and then expecting
    `extends` was wrong, and the analyzer was right: a fully qualified stdlib path is a
    statement about the standard library, not about a name this file happens to have bound."""


class VendorDotted(VendorProtocol):
    """The dotted form of a name this file DID import — from `vendor`, not from `typing`.
    Importing a name proves what it was imported FROM; it does not turn it into the stdlib's
    interface. This is the row that keeps the binding honest."""


def uses_something() -> object:
    return Shadow()