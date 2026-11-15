"""PY-D22 (round 11) — a comprehension's `for` TARGET and a lambda's PARAMETER are bindings of
their OWN scope, so a read of one inside that scope is a LOCAL read, never a project-wide name.

The corpus rows this was priced on are all this shape: `[comp(page) for comp in comparison]`,
`any(is_excluded(name) for is_excluded in self._excluders)`, `[handler_type(...) for handler_type in
handler_types]` — each published `bare-name-callee`, a claim that the name belongs to no scope in
the project while the source binds it in the same expression.

The precision rows are the other half, and they are why this is a LEXICAL test rather than a
name test: the same name read OUTSIDE the comprehension is not bound by it (python 3 gives a
comprehension its own scope), and a name the comprehension does not bind is not bound at all.
"""


def call_inside_a_comprehension(comparison):
    return [comp(page) for comp in comparison]


def call_outside_the_comprehension(comparison):
    comps = [comp for comp in comparison]
    return comp(comps)


def check_inside_a_comprehension(comparison):
    return [isinstance(page, comp) for comp in comparison]


def nested_clauses(mapping):
    return [v2(k) for k, v in mapping.items() for v2 in (k, v)]


def uses_a_lambda():
    return lambda q_: q_()


def not_bound_by_the_scope(comparison):
    return [other(page) for _comp in comparison]


MODULE_HANDLERS = [module_target(NAME_OF_NOTHING) for module_target in HANDLERS_SET]
