# The BUILTIN / EXTERNAL / PROJECT split, which decides the relationship LABEL.
#
# A Make prerequisite is usually a FILE and a Make variable is often set by the
# command line, the environment, or another makefile. GNU Make also ships
# builtins that no file can declare. Publishing any of those as a project-internal
# `references` asserts a declaration that does not exist — over the corpus, 231
# unresolved edge ends were file paths, 187 external variables and 160 builtins.
#
# So: `references` only when THIS file declares the target, `uses` for everything
# else. The two classes appear on the SAME recipe line so the fixture fails if
# they are ever collapsed back together.

# --- declared in this file: these are `references` ---
CC = gcc
SRC = main.c util.c
OBJ = $(SRC:.c=.o)

# --- NOT declared here, and NOT builtins: these are `uses` ---
build: $(OBJ) $(DESTDIR)usr/bin/app
	@echo "$(CC) $(OBJ) $(DESTDIR)"

# --- BOTH expansion forms name the SAME variable ---
# `${VAR}` is GNU Make's second expansion form and is just as common: 68
# occurrences across 14 of the 99 corpus files. Handling only `$(` published every
# one of those prerequisites as `uses <target> -> ${VAR}` while the variable it
# names was declared elsewhere, so the same fact appeared TWICE under two
# spellings and the wrapper form dangled. Both forms below must normalise to the
# bare name and both must be `references`, because CC and OBJ are declared above.
build-braces: ${CC} ${OBJ}
	@echo "${CC} ${OBJ}"

# --- GNU Make builtins: `uses`, and labelled as builtins ---
info:
	@echo "dir=$(CURDIR) make=$(MAKE) files=$(MAKEFILE_LIST)"

# --- a foreach binder is a LOCAL, not an external variable ---
.PHONY: foreach-binder
foreach-binder:
	@echo $(foreach mod,$(SRC),echo $(mod))
