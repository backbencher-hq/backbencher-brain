# PY-28 — the SOURCE of a `references` edge must be a symbol the graph holds.
#
# The pre-fix resolver returned the name of the NEAREST enclosing
# `function_definition`. For a nested def that is a name nothing published: this
# analyzer emits a def only when no function scope is open, so a def inside a def
# is a local and there is no node to traverse from.
#
# Measured before the fix, through the production path: 18 `references` edges on
# python-codesql (2.8% of the type) carried a source that was not a symbol of the
# file, and 60 on CPython's stdlib (4.8%). The corpus shape is
# `scripts/regression_test_python.py`, which annotates `fetch_native`,
# `fetch_pandas` and `fetch_arrow` — three nested defs inside `test_tpch` — with
# `rel: duckdb.DuckDBPyRelation`. The stdlib shape is `ast.py`, whose
# `_convert`, `_convert_num`, `_convert_signed_num` and `_format` are nested
# inside the `literal_eval` method.
#
# Same class of defect as PY-4, which returned the keyword `global` as a scope
# for the same reason. The fix mirrors the analyzer's own scope rule: the
# published owner is the OUTERMOST def on the path, a class clears the function
# scope so a def in a class body is a Method, and a statement with no enclosing
# def at all belongs to the MODULE.

import duckdb


class Loader:
    def load(self) -> duckdb.DuckDBPyConnection:
        def nested_helper(rows: duckdb.DuckDBPyRelation) -> duckdb.DuckDBPyRelation:
            deeper: duckdb.DuckDBPyConnection = None
            return rows
        return nested_helper(None)

    def convert(self, rel: duckdb.DuckDBPyRelation) -> duckdb.DuckDBPyConnection:
        pass


annotated: duckdb.DuckDBPyConnection = None


def module_level(rows: duckdb.DuckDBPyRelation) -> duckdb.DuckDBPyRelation:
    def also_nested(value: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
        pass
    return also_nested(None)