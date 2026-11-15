# Two reference forms that are easy to miss because they are not `$(VAR)`.
#
# `$(VAR:.c=.o)` is a `substitution_reference` — a SIBLING of
# `variable_reference`, not a child of it. An analyzer that reads only the
# latter loses every substitution reference in the corpus (9 of them).
#
# `$@` / `$<` / `$^` are `automatic_variable`s. They name something no file can
# declare, which is exactly what the `uses` class exists for: they are published
# rather than dropped, and labelled as automatic rather than as a builtin.

SRC = a.c b.c
OBJ = $(SRC:.c=.o)

.PHONY: all
all: $(OBJ)
	@echo "target=$@ first=$< all=$^ stem=$(@D)"

# `$$` is Make's ESCAPED dollar, so `$$?` is the SHELL's exit-status variable,
# not a Make automatic one. The edge is real information but calling it a Make
# builtin would be a category error, so it is labelled `shell_variable`.
	@echo "status=$$?"

# A variable_reference whose NAME is a concatenation has no `word` of its own:
#   variable_reference -> concatenation -> word `FLAVOUR_` + variable_reference `$(FLAV)`
# The name is built at expand time, so no file can declare it and there is nothing
# for `references` to point at -- but the READ is real, and it is the only thing
# connecting the two concrete declarations below to the reference that selects
# between them. The corpus differential reported 2 of these MISSING when the
# 100th corpus file (phpmyadmin/docs/Makefile) entered the set, and the oracle
# derived them without consulting the analyzer.
FLAVOUR_a = -D flavour=a
FLAVOUR_b = -D flavour=b
FLAV = a
OPTS = $(FLAVOUR_$(FLAV))
