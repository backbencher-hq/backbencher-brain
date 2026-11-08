# PINS the make wave fixture pack (M29 wave 3, language-onboarding protocol).
# A makefile is a build DSL: targets are rules, variables are substitution
# templates, and there is no call graph. The pack is authored so the analyzer's
# real symbol surface can be measured, not so call hierarchy can be claimed.

GREETING := hello

greet:
	@echo "$(GREETING) from make"

all: greet
	@echo done

.PHONY: greet all
