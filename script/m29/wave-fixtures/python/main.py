"""PINS the python wave fixture pack (M29.R2 wave 1, owner-approved set)."""
from typing import List


class Greeter:
    """A class with a method used elsewhere."""

    def __init__(self, items: List[str]) -> None:
        self.items = items

    def greet(self) -> str:
        return f"hello {len(self.items)}"


def main() -> int:
    g = Greeter(["a", "b"])
    print(g.greet())
    return len(g.items)


CONSTANT = 42
