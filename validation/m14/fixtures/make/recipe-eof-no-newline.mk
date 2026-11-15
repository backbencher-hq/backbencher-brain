# MAKE-G5, partially closed: the recipe line that ends the FILE, with no newline after
# it. GNU make 4.3 runs such a line (verified), and the pinned grammar turned it into an
# ERROR node and lost it, because upstream ends every recipe line with a MANDATORY
# newline token.
#
# There is deliberately no trailing newline on the last line of this file -- that is the
# case under test. `expectNoParseErrors` in the expectation is what makes it a real test:
# the analyzer's error recovery would produce the expected symbol anyway, so without that
# assertion this fixture would pass on a broken grammar. It did, the first time.
#
# No prerequisite on purpose. A bare-word prerequisite is published as `uses`, which is a
# separate question from this one, and a fixture that pins it would be asserting something
# this patch did not measure.
#
# The prefix is declared because the fix is an EXTERNAL terminator the scanner emits at
# `lookahead == 0`, and tree-sitter does not consult the scanner after an internal
# `token.immediate` prefix. So this case is closed for a declared prefix and still open for
# a tab -- one fixture per case, because claiming the other would be claiming a fix that is
# not there.
#
# 0 of the 100 pinned corpus files lack a trailing newline, which is why the corpus could
# not see this at all.

.RECIPEPREFIX = >

build:
>	gcc -o build