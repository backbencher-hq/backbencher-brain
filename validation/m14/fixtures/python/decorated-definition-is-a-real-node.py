"""THE DECORATED-DEFINITION FORM IS A REAL GRAMMAR NODE, NOT RECOVERED TEXT.

The python grammar's PRODUCTION build carries `decorated_definition`,
`decorated_definition_repeat1` and `decorator` in its node-type inventory (274 ids,
123 unique named), and the analyzer's walk keys on `n.type === "decorated_definition"`
(src/ast/real-python-analyzer.ts:6090).

THIS FIXTURE IS THE PROOF THAT THE CONSTRUCT REACHES THE ANALYZER AS A NODE AND NOT
AS RECOVERED TEXT, and it is proof in BOTH directions:

  THE POSITIVE ROWS can only be produced by the `decorated_definition` node, because
  a text scan cannot tell a decorator from a decorator-LIKE STRING — and the negative
  rows below are exactly that difference.  A text-recovery implementation would
  publish a `decorates` row for the `@also_not` inside the string literal, and it
  would put the row on the `def` line instead of the `@` line.

  ⇒ THE LINE IS THE DISCRIMINATOR: the analyzer's contract is that the edge names the
  DECORATOR's own line, never the `def`/`class` line (the M59 contract — the other
  half of it pins the declaration's SYMBOL range to the def line).  A recovery-text
  implementation gets the line wrong in every row, so these three line numbers are
  the part of this fixture that a text implementation cannot pass.

  ⇒ AND THE LOCAL CASE: a decorator applied to a def inside a FUNCTION BODY publishes
  NO row, because a def inside a def is a local on this family's contract (PY-28) and
  publishes no symbol — a decorator is part of the DECLARATION's identity, not a fact
  about the body that contains it, so it is not re-attributed to the enclosing symbol.
"""
import functools

NOTE = "@not_a_decorator"
TEMPLATE = """
@also_not
def shadow():
    pass
"""


def tagged(label):
    """A decorator WITH AN ARGUMENT — the argument is not a second dependency."""
    def wrap(fn):
        return fn
    return wrap


@tagged("row")
def write_row(path):
    return path


@functools.cache
class Cache:
    pass


class Holder:
    @tagged("method")
    def method(self):
        return 1


def outer():
    @tagged("local")
    def local_row():
        return 2
    return local_row
