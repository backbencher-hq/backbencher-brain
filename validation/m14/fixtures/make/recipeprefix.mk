# MAKE-G2, closed: `.RECIPEPREFIX`. GNU Make 3.82+ lets a makefile choose the
# character that introduces a RECIPE line, and the pinned grammar hardcoded it to a
# tab, leaving `// TODO external parser for .RECIPEPREFIX` where the value belonged.
# A file that set it therefore had every recipe line parsed as an ERROR node and the
# analyzer reported a build file that does nothing. 0 of the 100 pinned corpus files
# set it, so only a synthetic fixture can hold the feature down at all.
#
# The prefix goes on RECIPE lines only, NOT on rules. That is not an inference: GNU
# Make 4.3 rejects the prefixed rule outright, because `>` being the recipe prefix
# makes `>build:` a recipe, and a recipe may not come before the first target --
#
#     $ printf '.RECIPEPREFIX = >\n>build:\n>\techo hi\n' | make -f -
#     recipe commences before first target.  Stop.
#
# so an earlier version of this patch that also accepted `>build:` was accepting
# input make refuses, and its rule branch is what made the case below ambiguous.
# What make does accept is a comment between two prefixed recipe lines, which is
# why it is here: that is the exact case the ambiguous branch swallowed, publishing
# the following `clean:` as a `recipe_line` inside `build`.

.RECIPEPREFIX = >

CC = gcc
SRC = main.c
build: $(SRC)
>	$(CC) -o build $(SRC) $@ $<

# An ordinary comment between two prefixed recipe lines. Make continues the recipe
# across it, and so must the grammar.

>	@echo still building

clean:
>	rm -f build
