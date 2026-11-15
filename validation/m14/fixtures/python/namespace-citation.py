# fixture: python/namespace-citation
# D7 depth — the python-stdlib CITATION. An external claim whose target's namespace root is a
# CPython standard-library module is citable through the EXISTING `namespace` claim kind: the
# analyzer declares the root on the edge (`metadata.languageNamespace: ["typing"]`), the arbiter
# checks the TARGET's root against that list and counts a match as a verified external claim
# (extOK, verifiedBy namespace). The vocabulary is `python-stdlib` in script/m14/citations.ts.
#
# PROPERTY 1, stated here because it decides the NEGATIVE: the namespace claim NEVER consults the
# symbol table — the declared list is the SOLE authority. So the only refutation expressible through
# this claim is a target whose root is NOT in the declared list (an undeclared root). A
# "project declares this name" refutation is NOT expressible through the namespace claim by design;
# that negative belongs to the importedName claim kind, not to this fixture.
from typing import Union              # cited: target `typing:Union`, root typing ∈ vocabulary
from django.db import Model           # NOT cited: target `django.db:Model`, root django ∉ vocabulary


def annotated(x: Union[int, str]) -> None:
    return None


def uses_model(m: Model) -> None:
    return None
