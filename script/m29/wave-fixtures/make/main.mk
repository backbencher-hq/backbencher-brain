# PINS the make wave fixture pack (M29 wave 3, language-onboarding protocol).
# A makefile is a build DSL: the callable unit is a macro invoked with
# $(call NAME,...); a rule target is a dependency node, not a function.

define greet
	@echo "$(1) from make"
endef

GREETING := hello

all:
	@$(call greet,make)
	@echo "$(GREETING)"

.PHONY: all
