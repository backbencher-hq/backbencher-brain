"""A BARE-NAME CALLEE BOUND IN AN ENCLOSING FUNCTION IS `local-callee`, AND ONE THAT IS NOT IS NOT.

The resolution verdict (script/m14/python-endpoint-resolution.ts) named this lane's largest honest
hole: 4,837 `calls` edges whose callee binds to nothing the project declares. Reading the top names
showed the cause was ONE fact, not many — `run_eval` is a NESTED `def` inside `main`, this lane
publishes no symbol for a nested def (the JS-family contract: locals, params and lambda params are
not symbols), and `django_capture_on_commit_callbacks` is a pytest-INJECTED PARAMETER. Both are the
same shape: the callee is bound in an ENCLOSING FUNCTION's scope, so no project-wide declaration
exists for the edge to reach and no store work can invent one.

Python's LEGB rule makes that a statement about the language rather than a guess about intent: a
name bound in an enclosing function resolves to THAT binding, and a module-level name of the same
spelling is shadowed for the whole body — so `local-callee` is the MORE correct answer, not a
fallback for a failed lookup.

THIS FILE PINS BOTH DIRECTIONS, because only one of them is the defect the reason code exists to
remove and the other is the fabrication it must not commit:

  local-callee       nested def, injected parameter, local assignment — bound in the enclosing scope
  bare-name-callee   a MODULE-LEVEL def (which the graph DOES declare, so it must stay resolvable),
                     a name nothing binds, and a name a `global` statement rebinds elsewhere
                     (`global counter` means a write to `counter` is NOT a local binding)

The `forbid` rows are the over-claim direction: a rule that answered `local-callee` from the name's
SHAPE, or from a `global`-declared name, would mark a resolvable module-level call unresolvable and
would be hiding real resolution work behind a label.
"""

from typing import Callable

counter = 0


def module_level():
    """Module scope: the graph declares this, so a call to it must stay resolvable."""
    return 1


def make_handler():
    return module_level


def outer(injected_param: Callable[[], int]):
    def nested_helper():
        return 1

    handler = make_handler()
    nested_helper()          # local-callee — a nested def
    injected_param()         # local-callee — an injected parameter (the pytest fixture shape)
    handler()                # local-callee — a local assignment
    module_level()           # bare-name-callee — a MODULE-LEVEL def, NOT local
    never_bound_anywhere()   # bare-name-callee — nothing binds it anywhere


def writes_a_global():
    global counter
    counter = 5
    counter()                # bare-name-callee — a global statement rebinds it elsewhere


def outer_scope_probe():
    def inner():
        only_inner = module_level
        return only_inner

    only_inner()             # bare-name-callee — bound in `inner`, NOT in this scope
    return inner
