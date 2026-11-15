"""PY-D28 (round 14) — a MODULE-level `__getattr__(name)` PROVIDES names, and the file spells them.

PEP 562 lets a module answer attribute reads with a function. `hasattr(module, "X")` is TRUE for every
name that function returns, and `from module import X` succeeds, so the name is part of the module's
public surface whether or not anything binds it. The analyzer published no declaration for any of them,
so a module's OWN export edge could not resolve against its own file: the verdict's last 7 unexplained
rows were all `exports`, and two of them are `tree_sitter_clean/__init__.py -> HIGHLIGHTS_QUERY` and
`-> TAGS_QUERY`, whose file states the provision in its own source.

MEASURED over the corpus with CPython's own `ast`, BEFORE this rule existed, in two passes
(`.tmp-py/price-module-getattr-exports.py` for the classification of the 7 rows, then
`.tmp-py/price-module-getattr-round14.py` for this rule's exact shape — the second pass is the
authority, and the two disagree on two names because the first hardcoded the parameter spelling and
counted the `else: raise` arm of a provide-or-die guard as an inverted one):

  26 of 11,245 files define a module-level `__getattr__`; 6 of them spell literal names, 20 spell none.
  Those 6 files hold 14 literal names. 1 is already statically bound in its own file (cython's `gs`),
  2 were treated as already in their file's import channel (`_text.py`'s `codecs`,
  `Build/__init__.py`'s `build_ext`), so round 14 published 11 symbols — and BOTH are bound by a
  FUNCTION-LOCAL import, which says nothing about the module namespace: round 15 narrowed the guard
  to module scope and the walk now reads `14 - 1 = 13`. 2 of the 14 are the verdict's `__all__` rows.

THE SHAPES THIS FILE PINS, and why each one is here:

  POSITIVE   `attr == "SPELLED"` and `attr in ("TUPLE_A", "TUPLE_B")` / `attr in {"C_EARLY", …}` —
             the three spellings the corpus writes. The SET spelling is `_text.py`'s, and the first
             version of the rule refused it.
  PARAMETER  the parameter is annotated AND named `attr`, not `name`: 18 of the 26 corpus files name
             their parameter something else (`_text.py` writes `importable_name`) and 6 annotate it
             (`def __getattr__(name: str)`), so a rule that hardcoded either would have published
             nothing from those files. `_text.py` does both.
  DEDUPE     `STATIC_TOO` is bound by an assignment AND provided here: ONE symbol, at the
             declaration's line — the module half publishes per NAME against what the file declared.
  LOCAL      THREE rows, and they pin the guard's SCOPE rather than a spelling. `SHADOWED_BY_LOCAL_
             IMPORT` is provided here and a function-local `from .impl import SHADOWED_BY_LOCAL_IMPORT`
             binds the same name — the corpus shape (`cython/Cython/Build/__init__.py` writes `from
             .Distutils import build_ext`) — and it IS published, because a local import binds a LOCAL
             and states nothing about the module namespace. `ALIASED_LOCAL_IMPORT` is the same thing
             spelled with `as`. `MODULE_SCOPED_IMPORT` is the OTHER direction and the one the guard is
             FOR: the file imports the same name at module scope, so the channel already routes it and
             publishing a second declaration of that spelling would put two declarations in one scope
             — NOT published. Round 14 declared the first two as an excluded pair (PY-D31); round 15
             priced the narrowing (`build_ext` and `codecs`, 2 of the 14 priced names, and ZERO binder
             rows — so the narrowing moves no round-12 number) and fixed it, which is why the pair is
             now published and only the module-scope row stays excluded.
  INVERTED   `attr in ("NOT_PROVIDED",): raise AttributeError` names what the module does NOT
             provide. Publishing it would declare a name the module refuses. Its name is deliberately
             NOT in `__all__`, and that is the fixture runner's export invariant talking: an `exports`
             edge whose target is no top-level symbol of the file is a violation, so a fixture may not
             assert one as expected behaviour. The corpus case is real anyway (1 of the verdict's 7
             rows is `declarative/__init__.py -> instrument_declarative`, a name the file's own
             `__all__` lists and nothing supplies) and it is recorded where it belongs — as a declared
             residual with its count, PY-D30.
  NOT-A-NAME `attr == "not-a-name"` is a literal but not an identifier, so it is not a name the store
             can hold.
  NAME GATE  `__getattr__unrelated` (a DIFFERENT name) provides nothing, and the CLASS-body
             `__getattr__` method below is a method's protocol, not a module provision.
"""

import os
from os import path as MODULE_SCOPED_IMPORT

__all__ = ["SPELLED", "TUPLE_A", "C_EARLY", "STATIC_TOO"]

STATIC_TOO = 1


def __getattr__(attr: str) -> object:
    if attr == "SPELLED":
        return lambda: "spelled"
    if attr in ("TUPLE_A", "TUPLE_B"):
        return lambda: "tuple"
    if attr in {"C_EARLY", "C_LATE"}:
        return lambda: "set"
    if attr == "STATIC_TOO":
        return 2  # the file declares this one with an assignment; the guard keeps the ONE symbol
    if attr == "SPELLED":
        # A SECOND SITE for a name already provided above: ONE module Variable, not two. The module
        # half of the walk publishes per NAME (the rule round 12 measured), while the class half
        # publishes per SITE because a member is addressed by name AND line. No corpus file has two
        # sites for one provision name (14 priced names, 14 ruled rows), so this branch exists to give
        # that dedupe a falsifier at all.
        return lambda: "second-site"
    if attr == "SHADOWED_BY_LOCAL_IMPORT":
        from .impl import SHADOWED_BY_LOCAL_IMPORT

        return SHADOWED_BY_LOCAL_IMPORT
    if attr == "ALIASED_LOCAL_IMPORT":
        from os import sep as ALIASED_LOCAL_IMPORT

        return ALIASED_LOCAL_IMPORT
    if attr == "path":
        # THE GUARD'S OWN CASE, and the only one that must stay excluded: `path` is bound by a
        # MODULE-scope import above, so the channel already routes this name and a second
        # declaration of the same spelling in the same scope is the ambiguity the guard stops.
        # `from os import path as MODULE_SCOPED_IMPORT` puts the ITEM name (`path`) in the channel
        # and not the alias — the asymmetry the guard's construction has, measured in round 14 and
        # left alone here on purpose: the ITEM is what the file imports, so it is a module name.
        return MODULE_SCOPED_IMPORT
    if attr in ("NOT_PROVIDED",):
        raise AttributeError(attr)
    if attr == "not-a-name":
        return None
    raise AttributeError(f"module {__name__!r} has no attribute {attr!r}")


def __getattr__unrelated(this_name: str) -> object:
    if this_name == "READ_BY_THE_WRONG_FUNCTION":
        return 1
    raise AttributeError(this_name)


class Holder:
    # THE CLASS GATE, spelled so it can be pinned INDEPENDENTLY of the parameter rule. A class-body
    # `__getattr__` is an instance protocol and the provision reader must never run for it; the walk
    # says that by calling the reader only while no class is open. Writing the method WITHOUT `self`
    # is what makes this row a test of THAT gate and not of the first-parameter rule: the compared
    # name is the method's own first parameter, exactly as it is in a module-level `__getattr__`, so a
    # walk that dropped the class gate would collect it and publish a module Variable. (Python allows
    # the shape syntactically — a method with no `self` fails only when CALLED on an instance — and
    # nothing in the corpus writes it; it exists here to give the gate a falsifier.)
    def __getattr__(item):
        if item == "CLASS_BODY_PROVISION":
            return 1
        raise AttributeError(item)


def reads_the_provisions():
    return SPELLED(), TUPLE_A(), C_EARLY(), STATIC_TOO
