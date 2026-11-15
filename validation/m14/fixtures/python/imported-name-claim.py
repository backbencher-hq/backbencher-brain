# fixture: python/imported-name-claim
# D7 depth (charter §18.19) — the `importedName` claim. A bare name the file IMPORTS from a
# stdlib-rooted specifier occupies THIS FILE's scope; it names a binding, not a project declaration.
# The claim `{specifier, name}` is verified by the gate from the run's own import evidence and rides
# the binding family (bindOK, verifiedBy importEvidence) — never resolved.
#
# THE RESTRICTION IS PART OF THE CLAIM: only specifiers whose ROOT is in the committed
# `python-stdlib` vocabulary are cited. A third-party root can be the project's own code in its
# checkout (kotlinx precedent) and a project/relative import is local — both stay UNMARKED (the
# fixture pins that negative), they are named classes in the D7 ledger, not laundered.
from tempfile import mkstemp            # stdlib-rooted from-import: mkstemp is claimable ONLY if unclaimed
from .helpers import local_thing        # relative specifier: UNMARKED
from requests.adapters import HTTPAdapter  # third-party root: UNMARKED


def claimed_use():
    return mkstemp()


def orphan_use():
    return not_imported_anywhere()


def relative_use():
    return local_thing()


def third_party_use():
    return HTTPAdapter()
