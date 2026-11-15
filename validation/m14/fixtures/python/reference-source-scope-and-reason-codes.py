"""A relationship's SOURCE is a scope in the graph, so it has to be a scope that EXISTS.

Two things are pinned here and they are the same defect class.

PY-24 — `references` sourced to a NESTED def. Python binds `def inner` inside `def outer`
as a LOCAL of `outer`: `outer.inner` does not resolve and nothing in the graph holds a
symbol for it. This analyzer publishes no symbol for it either — its own rule is that a
def inside a def is not a symbol, which is what makes nested-function call and member-read
edges attribute to the enclosing function. The type-reference walk had its own resolver
that did not apply that rule, so the annotation on a nested def's parameter published
`references inner -> SomeType` naming a scope nothing can be traversed from.

The three below are all nested in `outer`, and all three annotate their first parameter.
MEASURED on python-codesql before the fix: 18 such edges, 2.8% of the type, every one in
scripts/regression_test_python.py, where `fetch_native`, `fetch_pandas` and `fetch_arrow`
annotate `rel: duckdb.DuckDBPyRelation`.

`method` below is NOT nested and its annotation stays sourced to `method` — the fix is a
scope test, not "annotations belong to the outermost function".

PY-25 — every edge below is emitted at a confidence under 1.0, and every one of them
carries a `reasonCode` saying which reading was taken. docs/M14-HONESTY-CONTRACT §4 rule 1
requires a machine-readable reason code on any relationship whose confidence is below 1.0;
before this, 17,468 of 19,801 measured edges (88.2%) carried a bare number and 41 of those
(0.2%) had a code. `calls`, `uses`, `instantiates` and `references` are the four types
affected, and all four are pinned here so that dropping any one of the codes fails.
"""

from typing import Protocol


class Payload(Protocol):
    def kind(self) -> str:
        ...


def outer(source: SourceType, flag: bool):
    """The scope every nested annotation below belongs to."""

    def nested_a(target: NestedType):
        return target

    def nested_b(target: NestedType):
        return target

    class Nested:
        def method(self, arg: MethodParamType):
            return self.value

    def plain_reader(self):
        return self.value

    return nested_a, nested_b, Nested, plain_reader


class Owner:
    def method(self, arg: MethodParamType):
        return self.value

    def uses_member(self):
        return self.value

    def makes_one(self, kind: Payload):
        return kind.kind()

    def plain_reader(self):
        return self.value


def annotated(arg: FreeFunctionParamType) -> FreeFunctionReturnType:
    return arg


class Factory:
    """Gives the fixture an `instantiates` row: an uppercase callee that is a class
    declared in this file, which is the only shape python's lane claims an
    instantiation for (PY-D3) and therefore the only one whose code can be pinned."""

    def build(self, kind: Payload) -> Owner:
        return Owner()
