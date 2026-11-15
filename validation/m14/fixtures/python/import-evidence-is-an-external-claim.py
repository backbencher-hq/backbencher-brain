"""THE FILE'S OWN IMPORT IS THE EVIDENCE THAT A NAME IS NOT LOCAL.

`from pathlib import Path` binds `Path`, `import os` binds `os`, `import numpy as np` binds `np`.
A type written `Path`, a call written `os.path.exists`, a read written `sys.stderr`, a base written
`OrderedDict` — each of those names is supplied by a module this file imported, and no declaration
in the project can answer it. The analyzer now states that on the key the arbiter reads
(`metadata.isExternalTarget`, with `externalReason` and `externalSpecifier` recording WHY and WHICH
module), and the target stays the LEAF in every case: the route is evidence, not the endpoint.

The forbid rows below say what the claim is NOT attached to, because each of those shapes is a way
a blanket marker would lie:

  * a RELATIVE import (`from .local import LocalBase`) names this project, not an outside module;
  * a name the file DECLARES is a declaration even when an import of the same spelling precedes it;
  * a name the enclosing FUNCTION binds (`def h(Path)`) is a local by python's LEGB rule;
  * a member read whose receiver is a local (`rows.count`) has no imported root;
  * a bare callee nothing imports (`helper()`) is the structurally closed class — no claim;
  * a receiver that is an EXPRESSION (`re.sub(...).strip()`) starts with an imported name but its
    member belongs to the expression's result, so it is not evidence of anything.
"""

import os
import sys
import re
import json
from json import JSONDecoder
from pathlib import Path
from typing import Protocol
from collections import OrderedDict

import numpy as np

from .local import LocalBase


class Service(Protocol):
    """A structural interface whose base is the stdlib `typing.Protocol`."""

    def run(self):
        ...


class Base(OrderedDict):
    """An imported stdlib class as the base."""


def read(p: Path) -> Path:
    """A type annotation naming an imported class, twice."""
    return p


def path_exists(path):
    """A call through an imported module's attribute chain."""
    return os.path.exists(path)


def parse_json(text):
    """The same through a different module."""
    return json.loads(text)


def write_err(text):
    """A member READ through an imported module."""
    print(text, file=sys.stderr)


def make_array(x) -> np.ndarray:
    """An annotation through an import ALIAS."""
    return x


def local_base(x):
    """NEGATIVE: a relative import names this project."""
    return LocalBase(x)


def shadowed(JSONDecoder):
    """NEGATIVE: the name is a LOCAL of this function, not the import."""
    return isinstance(None, JSONDecoder)


def local_receiver(rows):
    """NEGATIVE: a member read whose receiver is a local."""
    return rows.count


def bare():
    """NEGATIVE: nothing in this file imports `helper`."""
    return helper()


def expression(t):
    """NEGATIVE: the receiver is the RESULT of re.sub, not the module `re`."""
    return re.sub(r"x", "", t).strip()


class JSONDecoder:
    """NEGATIVE: declared HERE, after the import of the same spelling, so the claim is refused."""


def uses_declared(d: JSONDecoder):
    """NEGATIVE: the file DECLARES this name, so the import is not the binding it is."""
    return d


def shadowed_root(os):
    """NEGATIVE: `os` is a PARAMETER here, so the route root is a local, not the import."""
    return os.getenv("PY_IMPORT_EVIDENCE")
