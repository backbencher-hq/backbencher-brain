# Negative.mk — negative fixture: invalid syntax + noise traps
# Line numbers matter: the ground truth references exact lines.

# Comments, blank lines, and .PHONY meta-directives must not create symbols.
.PHONY: not_a_real_target

# A bare command with no rule header is a parse error (engine-owned).
	echo "orphan recipe"

# A rule with an unclosed conditional (ERROR recovery region).
ifdef BROKEN
broken_target:
	@echo "never closed"
# (no endif)

# Unterminated variable reference in a value.
BROKEN_VAR := $(strip

# Automatic variables are builtins: $@ $< $^ $(@D) must not become symbols.
ok-rule:
	@echo $@ $< $^ $(@D) $*
