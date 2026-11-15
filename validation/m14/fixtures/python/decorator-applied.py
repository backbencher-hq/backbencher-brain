# fixture: python/decorator-applied
# A decorator is an APPLIED dependency. One `decorates` row per decorator per
# decorated symbol: source = the declaration that carries it, target = the
# decorator's NAME AS WRITTEN (dotted chain kept, a call's arguments stripped),
# line = the decorator's own line. The rows are NEW — before this emission python
# kept decorator names on symbol metadata and emitted nothing to the graph.
import functools


def single(fn):
    return fn


def first(fn):
    return fn


def second(fn):
    return fn


class Registry:
    def route(self, path):
        return lambda fn: fn


app = Registry()


@single
def one():
    return 0


@first
@second
def two():
    return 1


@app.route("/x")
def three():
    return 2


@functools.wraps(single)
def four():
    return 3


@first
class Decorated:
    @second
    def method(self):
        return 4


from dataclasses import dataclass


@dataclass
class Model:
    pass
