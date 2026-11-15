# A rule whose TARGET is an expression still has prerequisites.
#
# `$(BIN): $(OBJS) | builddir` declares no literal target name — `$(BIN)` is the
# VALUE of BIN — so the analyzer had no target to hang the dependency on, and the
# code iterated the list of literal targets, which is EMPTY. The whole rule
# published NO prerequisite edges: the first prerequisite group, the order-only
# group, and both.
#
# The owner falls back to the module, because dropping the dependency loses real
# information while attributing it to the file that declares the rule is not a
# claim the tree contradicts. Found by script/m12/make-contract-probe.ts, a gate
# that had existed for this lane and had never been run.
#
# The LABEL is the other half: both OBJS and builddir are declared in THIS file,
# so both edges are `references`. Asserting `uses` here would re-encode the
# conflation this lane removed.

BIN = build/bin
OBJS = main.o util.o

.PHONY: all
all: $(BIN)

$(BIN): $(OBJS) | builddir
	$(CC) -o $@ $(OBJS)

builddir:
	mkdir -p $(@D)
