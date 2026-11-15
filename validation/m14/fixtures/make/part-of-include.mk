# `include` is the textual-inclusion construct: make splices the included
# file into the SAME make instance's scope, which is the single-shared-scope
# fact `part_of` asserts. The edge's target is the INCLUDED FILE'S MODULE
# SYMBOL (its basename), never the written path — a path target resolves 0
# rows. The path is kept in metadata.partPath where a reader can check it
# against the source line.
#
# Three near misses must be counted and must NOT fire:
#   * `$(shell cat x.mk)` — a command substitution READS a file, it does not
#     splice it into this make instance's scope;
#   * an `include` inside `$(eval …)` — runtime-generated text, not a node
#     this parse can see as an include_directive;
#   * a commented-out include — the grammar hands it to the walk as a
#     comment, and a comment includes nothing.

include part-of-library.mk

# a command substitution, not an inclusion
DEPS := $(shell cat part-of-library.mk)

# runtime-generated: the eval EXPANDS text and re-parses it at run time; the
# include below is born inside a variable, so this parse sees a string.
EVALUED := $(eval include part-of-generated.mk)

# commented out: `# include part-of-commented.mk` is a comment, not a directive

literal-target:
	@echo $(DEPS)
