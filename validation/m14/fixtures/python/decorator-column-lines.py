# fixture: python/decorator-column-lines
# M59 (#825): a decorated definition's line belongs to the NAME (the def
# line), never to the decorator. Imported names carry their own item lines.
import os
from typing import (
    Optional,
    List,
)


def plain():
    return helper()


def chained(items):
    return (
        items
        .strip()
        .upper()
    )


@paramatize("x", [1])
def decorated(x):
    return x
