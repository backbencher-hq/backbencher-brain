"""PY-D19 (round 10) — `from M import *` is a BINDING RULE, and the analyzer states it.

The relation carries `starImport: true`; the name it can bind is NOT invented as a symbol, and the
resolution verdict declares it external only when every star-imported module is out of view.
"""

from dataclasses import *

import os


def build():
    return make_dataclass("C", ["n"])


def routed():
    return os.path.join("a", "b")
