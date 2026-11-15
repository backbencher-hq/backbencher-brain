# fixture: python/owner-member-absent
# D7 depth (charter §18.32) — the `ownerMemberAbsent` claim, INDEXED ARM ONLY and FAIL-CLOSED.
# A calls/uses row carries metadata.owner (the receiver type is PROVEN), production's owner channel
# DECLINED it, and "this owner type declares no member with this name (INHERITANCE-CLOSED)" is a
# fact the project index can verify. The claim {owner, member} is never a resolution: it rides the
# ext/claimed family and the arbiter reads it only where the name model has nothing.
#
# PYTHON_DECLARATION_SPEC has a baseResolver, so the absence test is INHERITANCE-CLOSED: members of
# Widget AND Base are declared, and only a name absent from the whole closure is claimable. A
# QUALIFIED base (`unittest.TestCase`) names a class in ANOTHER module, so a local class of the same
# leaf name is a DIFFERENT class: the lane keeps the qualified identity, never resolves the two
# together, and withholds the claim while the project declares that leaf (see the probe's cases 9-10).
class Base:
    def inherited_method(self):
        return 1


class Widget(Base):
    def direct_method(self):
        return 2


def absent_member(w: Widget):
    return w.missing_method()          # CLAIMED when the index is complete


def inherited_member(w: Widget):
    return w.inherited_method()        # UNMARKED: inherited member is declared


def direct_member(w: Widget):
    return w.direct_method()           # UNMARKED: declared on the owner


def unknown_owner(x: UndeclaredType):
    return x.any_method()              # UNMARKED: owner type unknown (no owner metadata at all)
