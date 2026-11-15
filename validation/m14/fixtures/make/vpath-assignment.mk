# MAKE-G1, closed: `VPATH =` is the ASSIGNMENT spelling of the search path.
#
# The sibling `vpath %.c src` DIRECTIVE has been recorded all along, so the two
# spellings of one feature were deliberately asymmetric — and the asymmetry was not
# cosmetic. Because `VPATH` was never declared, a reference to it fell to `uses`:
# the class this lane reserves for names that nothing can declare. Yet in a file
# that sets `VPATH = …`, this file IS the thing that declares it. `EXPORT_DIRS` on
# line 7 reads the search path and was published as a read of something undeclared.
#
# So `VPATH` is now a `constant` — a GNU Make builtin whose value a makefile may
# set, exactly like `CURDIR` or `MAKEFILE_LIST` — and the reference to it is a
# `references` edge. The directories are kept as a LIST in metadata, because the
# value is colon-separated on the page and a consumer asking "where does this
# makefile look for a prerequisite?" wants the list rather than the spelling.

VPATH = src:include:vendor
CFLAGS = -I$(VPATH)

.DEFAULT_GOAL := all
all: foo.o bar.o
