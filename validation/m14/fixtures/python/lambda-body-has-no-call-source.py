# PY-31 — a lambda is a function scope, and this analyzer publishes no symbol
# for one, so nothing inside it can be attributed.
#
# `uses` already declined every member read inside a lambda (a read needs a
# symbol to source from). `calls` did not, and a call inside a lambda sitting
# directly in a CLASS BODY or at MODULE scope was attributed to that class or
# that module: `ShareableList -> decode`, which is a false statement about a
# class — a class body does not call anything, and `ShareableList.decode` is not
# a thing a reader of the graph can go and look at.
#
# MEASURED over 678 real python files (python-codesql + CPython 3.10 stdlib):
# 113 call nodes inside a lambda body, across 43 files, every one attributed to a
# class or to the module.
#
# The lambda INSIDE a def is that def's business and is deliberately untouched:
# the calls contract has always attributed a nested body's calls to the enclosing
# function, so `key=lambda k: k.strip()` inside `sorted(...)` still publishes
# `f -> strip`.

import re


class Handlers:
    TABLE = {
        "a": lambda v: v.rstrip(b"\x00").decode("utf-8"),
        "b": lambda v: v.rstrip(b"\x00"),
    }

    def render(self, value):
        return value

    def build(self):
        helper = lambda value: self.render(value)
        return sorted(self.TABLE.items(), key=lambda item: item[0].lower())


at_module = lambda value: value.strip().upper()
also_at_module = [x for x in ()]