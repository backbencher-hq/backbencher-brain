"""PY-15: the framework marker's measured coverage, and the dialect it must not claim.

3,271 corpus `.py` files carry 160 distinct non-stdlib import roots. Seven of the
nine roots this analyzer's marker table declared never fired once — `celery`,
`django`, `fastapi`, `flask`, `sqlalchemy`, `starlette`, `tornado`, all zero —
while only `pytest` (1,010 sites) and `aiohttp` (1) matched anything. The corpus's
own dominant framework, `ansible`, was absent from the table at 3,452 sites.

This file pins three things at once:

  1. the four roots added with the census, detected by IMPORT ROOT and not by text;
  2. the ORDERING rule, which `detectedFrameworks` cannot express — the array is
     compared as a SET by the fixture matcher, so the primary pick is the only
     place the declaration order is observable, and a file importing both an
     application framework and a test runner must still report the application one;
  3. the Cython boundary, by EXHAUSTION rather than by a forbid row: `detected-
     Frameworks` is pinned to the exact expected set, so a Cython marker added to
     the table later changes this set and fails here on purpose. Cython is the
     corpus's second-largest root (260 lower-case + 169 capitalised sites) and it
     is a DIALECT — and no lane in this repository publishes a `dialect` field, so
     recording it as a framework would be a false claim rather than a small one.
"""

import ansible.module_utils.basic
import Cython
import setuptools
import sphinx
import pytest
import unittest
