"""M60 #902 — the callee a call NAMES, and the callees that name nothing.

`callLeafName` used to fall through to `namedChild(0)` for any callee shape it did not
list, so a parenthesised conditional callee `(f if flag else g)()` published
`calls -> f` — the `if` branch, not the callee. The differential's oracle names a callee
only for an identifier or an attribute, so the fabricated edge was the python lane's one
UNEXPLAINED edge on cython:python.

Shapes and what each must publish:
  control     `f()`                  -> calls f  (the lane walks call sites at all)
  grouped     `(f)()`                -> calls f  (grouping is transparent)
  conditional `(f if flag else g)()` -> nothing  (the callee is whichever branch runs)
  lambda      `(lambda: f)()`        -> nothing  (f is the lambda's BODY, not the callee)
  lambda_param`(lambda y: y)(2)`     -> nothing  (y is the lambda's PARAMETER — the real
                                        corpus form; see the note below)
  nested      `f()()`                -> calls f ONCE, from the INNER call; the outer
                                        call's callee is the inner call's RESULT

The full-corpus draw (cython, 475 files) measured FIVE fabricated edges from this one
fallback, and THREE of them were lambdas — whose first named child is a PARAMETER when
the lambda takes one: `(lambda y_global: ...)(2)` named `y_global` (tests/run/
extra_walrus.py:136) and `(lambda z: ...)(x)` named `z` (same file, line 151). A
parameter published as a called function is the sharpest statement of what the fallback
did, so the parameterless and parameterised lambdas are both pinned.
"""
def f():
    return 1


def g():
    return 2


def control():
    f()


def grouped():
    (f)()


def conditional(flag):
    (f if flag else g)()


def lam():
    (lambda: f)()


def lam_param():
    (lambda y: y + 1)(2)


def nested():
    f()()


def repeated_chain():
    table.update().prefix_with("A").prefix_with("B")
