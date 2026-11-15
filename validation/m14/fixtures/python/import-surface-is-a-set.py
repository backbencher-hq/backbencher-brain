"""ROUND 18 — THE IMPORT SURFACE IS A SET: every item of every statement is published, and the two
item classes that used to vanish before any row existed are back.

Three defects made one file's import surface unreadable as a set, and this fixture pins all three
from the SOURCE, so it fails whichever one is reverted:

  1. `from __future__ import annotations, division` reached NO row and NO edge. tree-sitter-python
     gives that construct a node type of its own (`future_import_statement`) and hard-codes the
     module in the grammar rule, so the walk's dispatch — `import_statement` and
     `import_from_statement` only — never walked it.

  2. `from datetime import UTC, datetime` dropped the ITEM `datetime`: the item loop skipped the
     module BY TEXT (`c.text !== moduleName`), so an item that spells the module name looked like the
     module node and was thrown away. The row (and the edge) then said this file imports `UTC` and
     not `datetime`, while `datetime.date(...)` in such a file names a name bound by nothing.

  3. `from model import marker_one as m1, marker_two` published a binding the store could not keep:
     the row id was per STATEMENT (`module:line`) while the projection is per ITEM, so
     `INSERT OR REPLACE` kept the LAST item and every item before it was overwritten. Measured over
     2,000 corpus files: 11,903 item rows projected, 8,903 ids written.

`clock:clock` is the shape defect 2 needs and cannot be faked: the module and the item are the SAME
word, so a text-based skip and a node-based skip disagree here and nowhere else. `os:*` is the
control that keeps a plain namespace import reading exactly as it did.
"""

from __future__ import annotations, division

from collections import OrderedDict as OD, defaultdict
from datetime import UTC, datetime
from clock import clock
from models import marker_one as m1, marker_two
import os


def local_route():
    """The un-aliased namespace import still emits its edge — the control for the three news above."""
    return os.path.join("a", "b")
