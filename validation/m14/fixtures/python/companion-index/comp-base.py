"""The base half of a CROSS-FILE override fixture, so it has to be its own file.

PY-7. A sub-directory under `validation/m14/fixtures/python/` is a PROJECT: the runner builds a
`ProjectIndex` over every source in the directory and hands it to the analyzer as
`AnalyzeContext.projectIndex` AND `AnalyzeContext.overrideCompanion`. That is the only way to test
the second tier of the three-tier `overrides` contract, because the question tier 2 answers —
"does a base this file has never read declare this method?" — has no answer inside one tree. The
Solidity suite found the same thing the hard way: two mutants survived their first run because the
runner called `analyze()` with no context, so they were no-ops against zero rows.

`Mixin` declares `send` and NOTHING ELSE. That is the whole design, and it is not arbitrary: it
is the shape of `requests`' `SessionRedirectMixin`, whose seven members are all about redirects
and which defines no `__init__` at all. A base that declared everything would let a broken
resolution pass by luck, because every guess would happen to be true.

`helper`'s body defines a nested function on purpose. `PYTHON_DECLARATION_SPEC` carries
`scopeNodes: ["function_definition", "lambda"]` so that nested name is NOT indexed as a member of
`Mixin` — a closure is not an inherited method, and indexing it as one would make a base appear to
declare methods it does not have, which is how a real override gets suppressed on the strength of
a fabricated member.
"""


class Mixin:
    def send(self):
        return 1

    def helper(self):
        def inner():
            return 2

        return inner