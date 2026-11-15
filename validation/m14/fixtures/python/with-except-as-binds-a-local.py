"""PY-D10-round-10 — the `as` TARGET of a `with` / `except` is a LOCAL binding.

Round 7 documented these two cases as collected while both read field names this grammar does not
have, so neither ever fired. The rows below are the falsifier: the same endpoints with the reason
code that only a local binding can produce.
"""


def with_target():
    with open("x") as handle:
        handle()
        typed: handle = None


def except_target():
    try:
        return None
    except Exception as failure:
        failure()
