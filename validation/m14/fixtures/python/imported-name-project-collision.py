"""THE `importedName` CLAIM — the bare imported name the PROJECT cannot verify.

A bare name that a file imports (`from typing import Optional`) occupies that file's scope. The
PROJECT cannot check the claim "this name is the binding the import introduces" against its symbol
table, because the symbol table answers a different question ("does the project DECLARE a name
spelled `Optional`?"). What the project CAN check is the FILE'S OWN import evidence, and the
arbiter checks exactly that.

The claim is `metadata.importedName = {specifier, name}`: the module the name came from, and the
name. It is read by the arbiter only where the name model has nothing, and it never resolves.

THE CLASS THE CLAIM IS FOR. A bare imported name reaches `ext?` ("a claim no check can reach") for
ONE reason: the generic external marker is verified against the SYMBOL key space, and the arbiter's
project-absolute refiner then DEMOTES it because the claim's SPECIFIER names a module the PROJECT
ITSELF SHIPS — the project might ship that module, so "this is outside the project" cannot be
checked here. The rows below are written so that a project containing a `typing.py` (or a
`typing/` directory) puts `typing` in that set, and a project that does not contain `json` does
not.

So this fixture is read TWO ways, and both are the lane's contract:

  · WITHOUT a project index (the fixture runner's case) the claim is ABSENT — the emission is
    fail-closed, so every sampled and index-less run is byte-identical to the behaviour before the
    claim existed. The expectation pins the import-evidence markers (the claim's PRECONDITION) and
    pins the ABSENCE of the claim.
  · WITH a complete project index (the probe's case) the claim is PRESENT on the `typing` row and
    ABSENT on the three rows whose shape or specifier puts them outside its class.

THE THREE NEGATIVES, each a way a blanket claim would lie:

  * `json` — the project ships no module named `json`, so the generic external marker VERIFIES the
    row (extOK). Claiming there would DISPLACE a verified external claim: the erosion the parked
    arm measured (extOK −16,025).
  * an ALIAS (`from os import path as os_path`) — the gate's import-evidence map holds the
    IMPORTED ITEM (`path`), while the edge this claim would ride names the ALIAS (`os_path`). A
    claim on it would be REFUTED: the bindFAIL class the parked arm measured (361 rows).
  * a NAMESPACE import (`import xml.etree`) — the import edge's target is `xml.etree:*`, whose
    `*` item the gate's evidence map skips; the analyzer now PUBLISHES THE ROOT the import binds
    (`importedBindings`), so the map can hold it, and the shape guard is what withholds the claim.
"""

from typing import Optional
from json import JSONDecoder
from os import path as os_path
import xml.etree


def read_optional(value: Optional) -> Optional:
    """POSITIVE (with a project that ships a `typing` module): the claim rides this name."""
    return value


def read_decoder(value: JSONDecoder) -> JSONDecoder:
    """NEGATIVE: the project ships no module named `json`, so the external marker verifies it."""
    return value


def aliased(value):
    """NEGATIVE: an ALIASED import — the gate's evidence map holds the item, not the alias."""
    return os_path.join("a", "b")


def aliased_name(value: os_path):
    """NEGATIVE: the ALIAS as a bare name — the row the alias guard is about."""
    return value


def namespaced():
    """NEGATIVE: a NAMESPACE import binds a module root, and the evidence map has no entry."""
    return xml.etree


def namespace_name(value: xml):
    """NEGATIVE: the module ROOT as a bare name — the row the namespace guard is about."""
    return value
