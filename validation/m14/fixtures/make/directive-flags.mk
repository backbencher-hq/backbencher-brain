# Every construct on this file is one the analyzer MODELLED but that no fixture
# and no corpus file exercised. `private` / `override` / `undefine` /
# `unexport` / `shell_assignment` / `vpath` all had code paths and zero tests,
# and three of those paths were wrong. This file is the test.

EXPORTED = yes
export EXPORTED
unexport EXPORTED

private SECRET = hidden
OVERRIDDEN := base
override OVERRIDDEN := forced
GONE = 1
undefine GONE
DYNAMIC != echo computed
vpath %.c src

all: $(SECRET) $(OVERRIDDEN)
	@echo $(DYNAMIC) $(GONE)
