"""The relation-level OWNER channel: WHICH member edges name their receiver's class.

The store resolves a bare member name by a ranking over every same-named declaration in
the project — same file first, then lexicographic symbol id — and that ranking is a
tie-break, not a fact about python: `render` and `save` are methods on many classes at
once. `resolveMemberTargetsByOwner` (`src/ast/member-owner-resolution.ts`) is the rule
that replaces the ranking for a member edge whose RECEIVER the analyzer can name: it
walks the receiver's class and that class's `super_types` ancestors and binds the member
where it is actually declared. php is the lane that proved the lever (PHPD42); this file
is the python half, and it pins the SIGNAL the pass reads (`metadata.owner`) rather than
the pass itself — the store-level measurement lives in `store-heritage-seam.mts`.

The boundary is narrow ON PURPOSE, and the negative rows below are the point of the file.
An owner is published only when the receiver is EXACTLY the implicit first parameter,
spelled `self` or `cls` — the same spelling the `dispatch-on-parameter` reason code
already trusts:

    self.render()        owner = enclosing class   (the receiver IS the instance)
    cls.build()          owner = enclosing class   (a classmethod's `cls`)
    self.store.save()    NO owner                  (`save` is a member of the VALUE of
                                                    `self.store`; labelling it with the
                                                    ENCLOSING class would resolve `save`
                                                    to a method of the outer class — a
                                                    confident wrong edge, which is the
                                                    exact failure the channel removes)
    other.save()         NO owner                  (a local; type written down nowhere)
    self.thing() in a
    module-level def     NO owner                  (`self` is an ordinary parameter; there
                                                    is no enclosing class to name)

Everything here is emitted whatever the owner says; the channel changes only which of
these rows the STORE can bind to the declaration the receiver actually is.
"""


class Store:
    """A concrete class whose `save` IS declared here, so a wrong owner would bind to it."""

    def save(self, record):
        """The method `self.store.save()` must NOT be resolved to via the outer class."""
        return record


class Widget:
    """The positive class: `self.render()` and `self.host` are members of Widget."""

    def __init__(self):
        self.store = Store()
        self.host = "widget"

    def draw(self):
        # POSITIVE (self.): the receiver IS the instance, so the enclosing class is its
        # type and the store can walk `draw`'s class for `render`.
        self.render()
        # NEGATIVE (deep chain): `save` belongs to the VALUE of `self.store`. Publishing
        # Widget as the owner would let the store bind `save` to a method of Widget if it
        # had one — a wrong edge dressed as a resolution. It carries no owner.
        self.store.save({"a": 1})
        # POSITIVE (member read): the receiver IS the instance; `host` is Widget's own
        # instance attribute (a Property symbol owned by Widget).
        return self.host

    def render(self):
        """Declared here, so the `self.render()` edge resolves through the owner channel."""
        return 1


class Builder:
    """A classmethod's `cls` is the class, so `cls.text()` carries the same owner."""

    @classmethod
    def make(cls):
        # POSITIVE (cls.): the implicit first parameter of a classmethod.
        return cls.text()

    @classmethod
    def text(cls):
        """Declared here, so the `cls.text()` edge resolves through the owner channel."""
        return "builder"


def free(self):
    """A module-level function that happens to name its parameter `self`.

    There is no enclosing class, so no owner can be named and none is published. This is
    the row that stops the channel from keying on the parameter's SPELLING alone.
    """
    return self.thing()
