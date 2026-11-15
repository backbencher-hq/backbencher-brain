"""CPython refuses to compile this class body, so it has no members at all.

Kept as its own fixture, separate from `lambda-scope-is-not-class-scope`, for one reason: that
fixture's ground truth is read out of the interpreter with `vars()`, and this file cannot be
imported — so a combined file would have had its real rows resting on an opinion.

The construct:

    class C:
        from_comp = [(r := i * 2) for i in range(3)]

    SyntaxError: assignment expression within a comprehension
                 cannot be used in a class body

Python binds a comprehension's named expression in the ENCLOSING scope, so `r` here would bind
into the class — and Python refuses that rather than give it the surprising meaning. The class
does not exist, so `C.from_comp` does not exist and `C.r` certainly does not.

tree-sitter is error-tolerant and parses it anyway. The lane was publishing BOTH `from_comp`
and `r` as members of a class that cannot be constructed. `from_comp` is defensible — it is
the assigned name and the assignment is right there in the source — while `r` is a member of
nothing, which is the same fabrication as the lambda parameter in the sibling fixture and the
same fix.
"""


class C:
    from_comp = [(r := i * 2) for i in range(3)]
