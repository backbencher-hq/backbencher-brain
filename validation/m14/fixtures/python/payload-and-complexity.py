"""M14 python fixture — pins the managed-OO family contract (PYD1 wave).

Authored BEFORE the analyzer run; the expectation reflects the verified
family contract (csharp/dart/php/ruby/swift/objc precedent), not whatever
the analyzer happens to emit.
"""
import enum
from enum import Enum

from shared import BaseRepo


class Order:
    """Simple value object instantiated by the repository."""

    def __init__(self, sku: str, qty: int, price: float):
        self.sku = sku
        self.qty = qty
        self.price = price


class OrderStatus(Enum):
    """Real Enum base — constant-value members become EnumMember symbols."""

    PENDING = 0
    PAID = 1

    def classify(self, code: int) -> str:
        if code == OrderStatus.PENDING:
            return "pending"
        elif code == OrderStatus.PAID:
            return "paid"
        return "unknown"


class BaseRepo:
    """External-ish base for the extends pin."""


class OrderRepository(BaseRepo):
    """Repository: attribute writes, member reads, branching, calls."""

    def __init__(self, clock, rate: float):
        self.clock = clock
        self.rate = rate
        self.orders: list[Order] = []
        self.label = "orders"

    def add(self, sku: str, qty: int, price: float) -> Order:
        order = Order(sku, qty, price)
        self.orders.append(order)
        return order

    def total_for(self, sku: str) -> float:
        subtotal = 0.0
        for o in self.orders:
            if o.sku == sku:
                subtotal += o.qty * o.price
        while subtotal > 1e9:
            subtotal /= 2.0
        return subtotal * self.rate

    def describe(self, sku: str, sep = "-") -> str:
        status = OrderStatus.PENDING
        if status == OrderStatus.PAID:
            status = OrderStatus.PENDING
        return f"{self.label}:{sku}:{status}"


class Looped(Looped):
    """Self-shadowing base (real IpythonMagic.py idiom): the extends edge
    MUST be suppressed by the #299 name-collision rule."""

    pass


# --- PYD1 F6 coverage wave: every analyzer-referenced node type exercised ---
# (each form below was probe-verified against the pinned tree-sitter-python)

import sys as system  # aliased_import
from . import sibling  # relative_import
from glob import *  # wildcard_import
import json  # plain import_statement

MAX_RETRIES = 3  # module Variable (uppercase module constant)
_flags: set[str] = set()  # annotated assignment


def _walk_all(items: list[str], *extra, verbose: bool = False, **opts) -> dict[str, int]:
    """Covers: default_parameter, list_splat_pattern, dictionary_splat_pattern,
    set_comprehension, dictionary_comprehension, list_comprehension,
    generator_expression, boolean_operator, tuple, slice, subscript, set,
    lambda, ternary, assert, try/except, with, match/case, yield, await."""
    assert MAX_RETRIES > 0, "retries must be positive"
    counts = {name: len(name) for name in items}
    squares = [n * n for n in counts.values() if n > 0]
    uniq = {n for n in items}
    pair = (len(items), len(uniq))
    window = items[0:2]
    key = list(counts.keys())[0]
    late = lambda x: x or "none"
    verbose and print(window, pair, key, uniq, squares)
    try:
        with open("/dev/null") as fh:
            _ = fh.read(1)
    except (OSError, ValueError):
        pass
    match pair:
        case (0, _):
            return {}
        case (n, m) if n == m:
            counts["unique"] = n
    combined = [*items, *uniq]
    flat = "prefix" "suffix"  # concatenated_string (adjacent literals)
    banner = f"{key}: {flat}"  # f-string (interpolation + concatenated_string)
    tags = {"a", "b"}  # set literal
    status = "ok" if combined else "empty"
    yield from (k for k in counts)

    async def _drain():
        await _walk_all([])
        return True

    return counts


class Dispatcher:
    """Covers decorated_definition + decorator (classmethod) and augmented
    assignment (self.tick += 1)."""

    TICKS = 0
    _memo = None  # PYD3: underscore class-var -> protected Property

    @classmethod
    def reset(cls):
        cls.TICKS = 0

    def bump(self):
        self.tick = 0
        self.tick += 1

    def decide(self, flag) -> str:
        return "yes" if flag else "no"


class Colors(Enum):
    """PYD4: auto()-valued members are EnumMember symbols (canonical idiom)."""

    RED = enum.auto()
    BLUE = 2


class Decorated:
    """PYD5: a nested def is NOT a symbol — its body's member reads keep the
    OUTER function as source (same owner the calls contract uses)."""

    def run(self):
        name = self.base_name
        def step():
            return self.helper()
        return step

    def helper(self):
        return 1


class Aliased(type_alias_statement := __import__("types").SimpleNamespace):
    """type_alias_statement via PEP 695 would need py3.12 syntax; the grammar
    still parses this assignment default through named_expression."""

    pass


type Row = dict[str, int]  # PEP 695 type alias (type_alias_statement)
