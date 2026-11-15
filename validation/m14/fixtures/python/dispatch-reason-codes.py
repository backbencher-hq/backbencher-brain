"""Every `calls` edge now says HOW its target is chosen. This is the fixture for it.

Python resolves a callee at RUNTIME, through the receiver's type and the MRO. The
lane was already emitting the honest NAME — PY-11's measurement is that dropping an
uppercase callee lost 889 of 1,152 edges, 77.2% of them for classes the file
explicitly imports — but it emitted the name with nothing distinguishing the three
situations that produce it, so a consumer reading `calls f -> g` could not tell a
call it can trust from one it cannot.

M14 §4 is the contract that says so: any relationship at confidence < 1.0 must carry
a machine-readable reason code, not just a number. Measured over the 679-file
INCOMING_PY corpus before this: 29,877 `calls` edges at 0.9 and **0** of them
carrying one.

The partition those codes express, on that same corpus:

    in-file-callee          the leaf names a symbol this parse declared
    dispatch-on-parameter   `self.m()` — the receiver is the implicit first
                            parameter, so the target class is decided by whoever
                            constructed the instance. NO static target.
    dispatch-on-receiver    `recv.m()` where recv is a local — the receiver's type
                            is not written down. NO static target.
    external-member-call    `os.path.m()` — the receiver is rooted at a module THIS
                            file imported, so the member is reachable through the
                            import edge even though its definition is not in view.
    bare-name-callee        `f(...)` — the name is a value.

Everything below is emitted in every case. What changes is that the uncertainty is a
field a consumer can filter on rather than an absence it has to guess at — and this
file is here so a future change that collapses the three classes back into one, or
renames a code, fails a test instead of shipping.
"""

import os


class Store:
    """A class whose methods DO exist in this file, so `self.*` resolves in-file."""

    def save(self, record):
        """In-file target: `Store.save` is declared above."""
        return record

    def load(self):
        """Also declared here."""
        return self.stash  # member read, not a call


class Widget:
    """A class that does NOT declare `render`, so `self.render()` has no in-file target."""

    def draw(self):
        # dispatch-on-parameter: `render` is declared by a base this file has not
        # read, and WHICH base is decided by the instance's type at runtime.
        self.render()

        # dispatch-on-receiver: the receiver is a local, and its type is nowhere.
        other = Store()
        other.save({"a": 1})

        # external-member-call: `os` names a module this file imported, so `os.path` is
        # a member chain the import edge already reaches and `join` is behind it.
        return os.path.join("a", "b")


class Client:
    """Instantiation plus a constructor the file declared, and one it did not."""

    def __init__(self, store):
        # `Store` is declared in THIS file, so `Store(...)` is an `instantiates`
        # edge naming a constructor this parse can see.
        self.store = Store()
        # dispatch-on-parameter: `submit` is a method of something else entirely.
        self.store.save(self.submit)
        return store


class Base:
    """A base whose method IS declared in this file."""

    def handle(self):
        """Declared here, so the subclass edge below is MRO-verifiable."""


class Derived(Base):
    """A subclass that redeclares it."""

    def handle(self):
        """Overrides a method the lane READ, at 0.95 with reasonCode `mro-base-declares-method`."""