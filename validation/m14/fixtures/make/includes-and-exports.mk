# Includes and exports, including the three shapes one directive can take.
#
# The include SOURCE must be this file's module, not a hardcoded name: with a
# constant source, every makefile that includes `hooks` produced the same edge
# and two files could not be told apart in the graph.
#
# A target IS an export — an including makefile invokes it by name — so the
# file's public surface is answerable. And `export NAME` with no `=` wraps a
# `list` and is the ONLY place that name appears, so without that branch the
# export is invisible entirely.

MODULE := demo

# a literal include path: a `word` node
-include hooks

# an optional include
include extra.mk

# a computed include: a `shell_function` node, whose target is not knowable at
# parse time. The expression is recorded and flagged rather than dropped, because
# an unresolved import is a fact and a silently absent one is not.
-include $(shell echo generated.mk)

# a bare export: no `=` at all, so there is no assignment node to walk into
export EXPORTED_BARE
export EXPORTED_WITH_VALUE := 1

PUBLIC_TARGET: $(EXPORTED_BARE) $(EXPORTED_WITH_VALUE)
	@echo done
