"""PY-11: a class this file does not define is still a callee.

Measured over 300 pinned corpus files: 1,152 uppercase callees, 263 of which
became `instantiates`, and 889 of which produced NO relationship at all — 77.2%
of them — of which 368 named a class the file EXPLICITLY IMPORTS.
`module = AnsibleModule(...)` is the shape, once per file, across a corpus.

The distinction this file pins is the one the pre-fix lane collapsed:

  * a class DECLARED IN THIS FILE and called is `instantiates` — the analyzer can
    read the constructor and the attributes it assigns;
  * a class NOT DECLARED IN THIS FILE and called is `calls` — the analyzer cannot
    read it, and claiming `instantiates` would publish attribute evidence it does
    not have.

Both are relationships. The pre-fix lane published the first and dropped the
second, so the largest call shape in python had no edge in the graph at all.
"""

from collections import OrderedDict
from acme.registry import Registry


def build_cache():
    """A lowercase callee declared here, for contrast."""
    return OrderedDict()


registry = Registry("acme")
cache = build_cache()
DEFAULT_NAME = "acme"
