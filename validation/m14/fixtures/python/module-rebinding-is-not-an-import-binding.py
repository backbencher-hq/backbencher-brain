"""A MODULE-LEVEL REBINDING OF AN IMPORTED NAME IS NOT THE IMPORT BINDING.

`import os` then `os = build_client()` at module scope rebinds `os`: by the time `use()` runs, the
name is the client object, not the module, so `os.getenv(...)` is a member call on a value whose type
the file only states by inference. The import-evidence claim must NOT be attached there — the import
is still written in the file, which is exactly the shape a naive rule would certify.

`from pathlib import Path` followed by a module-level `Path = Partial(Path)` (the partial-application
idiom) is the same fact for a from-imported name, and it is the corpus shape this row exists for.

The positive control at the bottom is the half that proves the fixture is not passing vacuously: a
DIFFERENT imported name that is never rebound keeps its claim.
"""

import os
from pathlib import Path
from json import loads

os = build_client()
Path = partial(Path)


def use():
    return os.getenv("PY_MODULE_REBINDING")


def build(path: Path) -> str:
    return str(path)


def parse(text):
    return loads(text)


def positive(text):
    """POSITIVE CONTROL: `loads` is imported and never rebound here."""
    return loads(text)
