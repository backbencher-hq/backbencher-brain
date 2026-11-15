"""PY-D23 (round 12) — a MODULE-scope binding written by a statement that is not an assignment.

`for key, value in PAIRS:` binds two names in the module namespace; `with open(...) as fh` and
`except ValueError as err` do the same at the scope they are written in. None of these was
published, so a read of one had no declaration to resolve against — the measured corpus row is
`wagtail/wagtail/snippets/api/v3/router.py:76`, which reads `mixin` inside a module-level `for`
loop over `mixins` and was UNEXPLAINED until this round.

The function-scope half is the same shapes INSIDE a `def`: those bind LOCALS, which are not
symbols on this family's contract, so their counts must stay ZERO and their reads must keep
`local-callee` / `local-binding-target`. The class-scope `for` is the third scope: it binds a
class attribute, which is a member.
"""

PAIRS = ((1, 2), (3, 4))

for key, value in PAIRS:
    pass

# TWO MODULE-SCOPE SITES, ONE NAME. The module half publishes per NAME (round 12's price: 70 names
# in the corpus have more than one module-scope binder site), so this is ONE symbol. The class half
# below publishes PER SITE, because a class member is addressed by name AND line — and that
# difference is measured, not stylistic.
for single in PAIRS:
    pass

for single in PAIRS:
    pass

with open("x") as fh:
    pass

try:
    pass
except ValueError as err:
    pass

ANNOTATED: fh = None


class Holder:
    for x in PAIRS:
        pass

    # THE SECOND SITE of the same class-body name. Round 12 deduped this on `(class, name)` and
    # published ONE member at the first target; the differential's truth side derives members from
    # the source per site and reported the second as MISSING, which is how the inconsistency with
    # every other class-member path (`Y = 1` twice is two Properties) was found.
    for x in PAIRS:
        pass


def reads_the_module_binders():
    return key(value), fh, err


def locals_stay_locals():
    for m, n in PAIRS:
        m(n)
    with open("x") as local_fh:
        local_fh()
    try:
        pass
    except ValueError as local_err:
        local_err()
    return m, n, local_fh, local_err
