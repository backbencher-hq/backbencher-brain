"""A lambda is a function scope: a name bound inside one is not a class member.

The second genuine analyzer defect the independent oracle found, and the worse of the two:
it FABRICATED a member rather than missing one. In `cython/tests/run/extra_walrus.py` a class
body holds

    x1 = (lambda y_global: (y_global := y_global + 1) + y_global)(2) + y_global

and the walrus target — a **lambda parameter** — was published as a member of the class.
`C.y_global` does not resolve in Python. The name belongs to the lambda.

The ground truth here is not a matter of opinion or of convention. This file's members were
read out of CPython itself, with `vars()` on the imported module:

    C      -> ['from_comprehension', 'via_lambda', 'walrus_direct', 'walrus_in_lambda']
    D      -> ['meth']
    Holder -> ['Nested']

`walrus_direct` IS a member, because a named expression written directly in a class body
genuinely does create a class attribute in Python. So the rule cannot be "no walrus in a class
body" — it has to be a SCOPE test, which is why the guard asks whether a binding scope encloses
the node rather than what the node looks like.

The four cases below pin that scope test from both sides. Three are members a lazier fix would
have dropped, and one is a name a lazier fix would have kept:
  * a walrus inside a METHOD is a local of that method — `D` has `meth` and nothing else;
  * a walrus inside a COMPREHENSION is a local of the comprehension, even though Python binds
    a comprehension's named expression in the enclosing scope;
  * a comprehension's own variable is not a member;
  * a class nested in a class body is a member (see `nested-class-containment`), so the two
    fixtures agree on where the line is.

The class-BODY comprehension case is deliberately NOT here, because CPython refuses to compile
it — `lambda-scope-rejects-comprehension-walrus.py` pins that separately, since a fixture whose
ground truth cannot be read out of the interpreter is a fixture asserting an opinion.
"""


class C:
    (walrus_direct := 1)

    via_lambda = (lambda p: p + 1)(2)
    (walrus_in_lambda := (lambda q: (q := q + 1))(2))
    from_comprehension = [i * 2 for i in range(3)]


class D:
    def meth(self):
        (walrus_in_method := 5)
        return walrus_in_method

    def comp(self):
        (from_comp := [i for i in range(3)])
        return from_comp


class Holder:
    class Nested:
        pass

    def make(self):
        class Local:
            pass

        return Local()