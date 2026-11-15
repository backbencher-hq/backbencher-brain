# An assignment's NAME, and the operator that must not become part of it.
#
# The grammar's `word` node is inconsistent about the operator: for
# `CGO_ENABLED?=1` it spans `CGO_ENABLED?`, while for `CC:=1` it spans `CC`.
# Capturing that node verbatim produced 55 symbols named `CGO_ENABLED?` and
# `BUILD_TAGS+` over the corpus, and therefore 112 edge ends that dangled by
# construction — every reference below names the CLEAN identifier, so a symbol
# called `CGO_ENABLED?` can never be the target of it.
#
# All five operators appear, and all five must yield the bare name. `::=` is
# deliberately absent: it is not a GNU Make operator, and the corpus has none.

CGO_ENABLED?=1
BUILD_TAGS+=tracing
STRICT:=1
RECURSE::=2
SHELL_CMD!=echo hi

# Each reference below must resolve to the symbol declared above. If a name kept
# its operator, every one of these five edges would dangle.
lint: $(CGO_ENABLED) $(BUILD_TAGS) $(STRICT) $(RECURSE) $(SHELL_CMD)
	@echo "$(CGO_ENABLED) $(BUILD_TAGS) $(STRICT) $(RECURSE) $(SHELL_CMD)"
