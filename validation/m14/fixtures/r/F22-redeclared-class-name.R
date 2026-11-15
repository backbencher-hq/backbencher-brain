# A class NAME is not a class DECLARATION, and this file is where the two come apart.
#
# `R6Class("AC", …)` is an ordinary constructor call evaluated top to bottom, and
# `inherit = AC` inside it is an ordinary lookup at that point in the file. So
# `BC` at line 22 inherits the `AC` bound at line 21 — the second declaration, whose
# member set is `{second_only}` — and not the union of both, which is `{first_only,
# second_only}`.
#
# The defect this pins, in the shape it appeared in the corpus: R6's own test suite
# declares a class named `AC` NINETEEN times in one file
# (R6/tests/testthat/test-clone.R), each with a different member set, and the pass
# compared `BC`'s members against the union of all nineteen. So `BC -overrides-> y
# (overrides AC)` at R6/tests/testthat/test-portable-inheritance.R:219 read as
# fabricated, because the first `AC` in that file declares no `y`.
#
# Under `union` the second line below makes `BC` override `first_only`, a member
# the base in scope does not have. Under `last` the answer is the same BY COINCIDENCE
# for the first four cases; the case at line 65 onward is the one that separates the
# two, and the comment there says how. An earlier draft of this file asserted the
# separation without constructing it, and the mutant battery said so.
AC <- R6Class("AC", public = list(first_only = function() 1))
AC <- R6Class("AC", public = list(second_only = function() 2))
BC <- R6Class("BC", inherit = AC, public = list(first_only = function() 3, second_only = function() 4))

# The mirror: `DC` at line 28 inherits the `AC` bound at line 21 as well, because
# nothing between them rebinds it. So `DC` also overrides `second_only` and not
# `first_only`, and the two derived classes agree even though they are eight lines
# apart and there is a fourth class declaration in between.
DC <- R6Class("DC", inherit = AC, public = list(first_only = function() 5, second_only = function() 6))

# `EC` inherits a name this file NEVER binds. There is no declaration of `Ghost` at
# any line, so no declaration precedes line 37 and the pass declines to assert an
# edge at all. `EC` still gets its `extends`, because `extends` records the NAME
# written in the source and does not need a declaration; the asymmetry is the point,
# and the count of these declines is published as
# `ambiguity.overridesBasesNotDeclaredEarlierInFile` so it cannot be mistaken for
# "this corpus contains no undeclared inheritance".
EC <- R6Class("EC", inherit = Ghost, public = list(first_only = function() 7, second_only = function() 8))

# A class that inherits nothing and shares every member name with a class that
# does is not an override. `Standalone` co-exists with `BC` and declares the same
# member; co-existence in a file is not inheritance, and F12 pins the same fact for
# three distinct class names. Here the names are IDENTICAL, so this is the case
# where a name-keyed pass has no way to tell the two classes apart.
Standalone <- R6Class("Standalone", public = list(first_only = function() 9, second_only = function() 10))

# THE CASE THAT SEPARATES `preceding` FROM `last`.
#
# Cases 1-4 cannot separate them, and it is worth being exact about why: every derived
# class in this file sits BELOW the LAST declaration of its base, so `preceding` and
# `last` name the same declaration and agree. That is a coincidence of these four cases,
# not a property of the rule, and an earlier draft of this fixture claimed otherwise --
# `--mutants` reported `src-overrides-base-is-last-declaration` SURVIVED all 22 fixtures,
# which was the fixture being wrong rather than the mutant being unfalsifiable.
#
# So here the base is redeclared AFTER the derived class. `FC` at line 66 inherits the
# `AC` bound at line 65, whose member set is `{alpha_only}`. The declaration at line 67
# binds `AC` again with `{omega_only}` and never had a chance to be in scope at line 66.
#
#   preceding  -> base is line 65 -> `overrides FC -> alpha_only`, and NOT omega_only
#   last       -> base is line 67 -> `omega_only` is absent, so the pass emits NOTHING
#   union      -> base is both     -> alpha_only is present, so it agrees with preceding
#
# So this one line rejects `last` and still does not reject `union`; cases 1 and 2 reject
# `union` and not `last`. The file needs both, which is why it is 67 lines and not 20.
AC <- R6Class("AC", public = list(alpha_only = function() 11))
FC <- R6Class("FC", inherit = AC, public = list(alpha_only = function() 12))
AC <- R6Class("AC", public = list(omega_only = function() 13))
