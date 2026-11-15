# PY-33 — a guessed override must not name `object` for a method `object` lacks.
#
# `object` is the CLOSED root of the python class hierarchy: `dir(object)` is 23 names
# and every class inherits them whether or not it writes `object` in its base list.
# That makes it the one external base whose members are knowable without reading a
# module — so a guess naming it is a checkable claim, and for a method `object` does
# not have it is a FALSE one.
#
# MEASURED, not argued (script/m14/python-guess-accuracy.ts, which imports each
# guessed base and asks `hasattr(base, method)` on CPython 3.10.12):
#
#   python-codesql, 184 files. Before: 41 guessed edges, TRUE 1 / FALSE 23 /
#   UNKNOWN 17, accuracy over decided edges 4.2%. Seventeen of the twenty-three
#   FALSE were `object.<method>` — one per method of a unittest.TestCase subclass
#   whose only base is `object`.
#   After: 24 guessed edges, TRUE 1 / FALSE 6 / UNKNOWN 17.
#
# The three classes below are the shape at three distances from `object`, so the
# fixture pins the BOUNDARY and not just the refusal:
#
#   Plain        base is `object` and defines `describe`  -> object has no
#                `describe`, so NO edge. This is the forbid.
#   DunderOwner  base is `object` and defines `__str__`     -> object DOES have
#                `__str__`, so the 0.5 guess survives. A fix that refused every
#                `object` guess would pass the forbid above and lose this edge,
#                which is why both rows are here.
#   External     base is unreadable from this file          -> unchanged, the
#                family's external tier still applies. The fix is narrow on purpose:
#                every OTHER external base keeps the 0.5 guess, because for those the
#                question is genuinely open. Here it is not.


class Plain(object):
    def __init__(self, name):
        self.name = name

    def describe(self):
        return self.name


class DunderOwner(object):
    def __str__(self):
        return "dunder-owner"


class External(ExternalBase):
    def handle(self):
        return ExternalBase.handle(self)