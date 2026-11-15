"""AN ALIASED IMPORT PUBLISHES THE NAME THE FILE ACTUALLY BINDS.

`import typing as t` binds `t`. The file's own words for the module are then `t.Callable` in an
annotation, `t.Protocol` in a base list, `t.Self` in a return position — while the `imports` edge's
target is the `module:*` pair the store keys on (`typing:*`). So the alias was on NO relation at
all, and every `t.X` endpoint read as a name bound by nothing:

    references create -> Self        [qualified: "t.Self"]     <- UNEXPLAINED
    extends    HasCurrent -> Protocol [qualified: "t.Protocol"] <- UNEXPLAINED

The analyzer already parsed the alias (`ImportInfo.alias`); it simply never published it. It now
rides the edge as `metadata.importedAs`, for `import X as Y` and for `from X import Z as W` alike —
where the second shape lost the binding one layer deeper still, because the item list recorded the
IMPORTED name `Z` and never the bound `W`.

WHAT THIS FIXES, AND WHAT ROUND 17 CLOSED ON TOP OF IT. Round 7 made the alias knowable to a
consumer that reads the edge's metadata (the resolution verdict now classifies `t.Protocol` as
`qualified-external` — a dotted route rooted at a module this file imported — instead of counting
it as a defect). Round 17 carried the same fact to the ROW the STORE reads: the from-import row now
publishes `itemBindings` (`[{name, as}]`, one entry per aliased item) and
`src/ast/pool-worker.ts`'s projection emits `alias`, so `brain_import.imported_as` is written for
`from X import Z as W` — the half that stayed NULL, and which the `expectImports` rows below
pin.

The plain (non-aliased) imports below are the control in BOTH channels: an un-aliased import binds
the name the target already spells, so `importedAs` must NOT be invented on the edge and
`itemBindings` must stay EMPTY on the row — a key that merely repeats the imported name is noise a
consumer has to filter.
"""

import typing as t
import os
import sys as system
from collections import OrderedDict as OD
from typing import Protocol
from dataclasses import dataclass, field as dataclass_field

# ROUND 17's falsifier lives in the expectation file: `expectImports` asserts `itemBindings` on the
# row ABOVE this comment — `[{"name": "OrderedDict", "as": "OD"}]` for the aliased item and `[]`
# for the un-aliased one — so the mutant `round17/item-bindings-publication-dropped` (which removes
# the publication in `real-python-analyzer.ts`) is caught HERE rather than only by the standalone
# seam pin, which the mutant battery does not run.


def build(seed: t.Callable[[], int], table: OD[str, int]) -> t.Self:
    """`t.Callable` / `OD[...]` / `t.Self` are the alias-bound annotations this fixture exists for."""
    return seed() and table


class HasCurrent(t.Protocol):
    """`t.Protocol` in a base list: the alias-bound route the verdict classified as a defect."""

    def current(self) -> int: ...


class Plain(Protocol):
    """The control: `Protocol` is imported un-aliased, so the bound name IS the imported name."""
