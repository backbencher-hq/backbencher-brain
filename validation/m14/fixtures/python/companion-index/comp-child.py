"""The consumer half: three classes, one per outcome the companion tier can produce.

PY-7. Every base here is declared in ANOTHER file (`comp-base.py`) or NOWHERE at all, so nothing
about any of them is decidable from this tree alone. That is what makes this fixture the only
place the second tier of the `overrides` contract can be observed — and the contract is three
tiers, so all three have to appear, or a change that collapses them into one another would pass.

  `Redirect`  over a base the index KNOWS. Two methods, and they resolve differently:
      `send`     the base really declares it, so the edge is promoted to a verified override.
      `__init__` the base does NOT declare it — `Mixin` has two members and neither is named
                `__init__`. So there must be NO override edge at all. Before the fix the lane
                guessed `Redirect.__init__ -> Mixin.__init__` at 0.5: a fabricated edge, at a
                confidence a reader cannot discount, on a method that does not exist. That is
                not hypothetical — `RedirectSession.__init__ -> SessionRedirectMixin.__init__` is
                in the requests corpus today, and a census of 3,271 files found **76% of the
                guesses whose base is in the corpus name a method the base does not declare**.

  `Orphan`   over bases the index does NOT know. `FirstUnknown` is declared in no file of the
                fixture project, so nothing has been learned and the question is genuinely open.
                This is where tier 3 belongs and where it must SURVIVE: a fix that suppressed
                every unreadable-base guess would delete the tier instead of demoting it, and
                23.6% of the corpus's guesses are legitimately in this position — the base is in
                a dependency, not in the repo. Deleting them would be the unilateral move a shared
                family contract exists to prevent.

  `Local`    inherits nothing and declares a method, so it must publish no override edge at all.
              It is here so a fix cannot be implemented as "emit fewer overrides" and pass.

  `ClosureOwner`  declares a method named `inner` — the name of the NESTED function inside
              `Mixin.helper` in `comp-base.py`. This is the row that makes `scopeNodes` in
              `PYTHON_DECLARATION_SPEC` observable at all, which the first version of this
              fixture failed to do. `scopeNodes` only affects the PROJECT INDEX, not the
              analyzer's own symbol extraction, and the analyzer already excludes closures from
              class members — so a forbid row on `contains Mixin -> inner` tested nothing and
              passed with `scopeNodes` deleted. The index is the only thing that can see it, and
              the index is only visible through what it lets a SUBCLASS conclude. Drop
              `scopeNodes` and `Mixin` appears to declare `inner`, so this edge is promoted to a
              verified override of a closure. With it, `Mixin` declares only `send` and `helper`,
              the name is unknown, and nothing is published.
"""


class Redirect(Mixin, SecondUnknown):
    def send(self):
        return 3

    def __init__(self):
        self.value = 4


class Orphan(FirstUnknown, SecondUnknown):
    def go(self):
        return 5


class Local:
    def standalone(self):
        return 6


class ClosureOwner(Mixin):
    def inner(self):
        return 7