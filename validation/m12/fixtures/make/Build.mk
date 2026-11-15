# Build.mk — positive fixture: variables, rules, defines, conditionals, includes
# Line numbers matter: the ground truth references exact lines.

CC      := gcc
CFLAGS  = -Wall -O2
DEBUG   ?= 0
OBJS    += main.o util.o
VERSION != git describe --tags

define HELP
This is the help text
for the project
endef

BIN := bin/app
SRCS := $(wildcard src/*.c)

.PHONY: all clean test

all: $(BIN) ## Build everything

$(BIN): $(OBJS) | builddir
	$(CC) $(CFLAGS) -o $@ $(OBJS)

builddir:
	mkdir -p $(@D)

main.o: src/main.c include/main.h
	$(CC) $(CFLAGS) -c src/main.c -o $@

util.o: src/util.c
	$(CC) $(CFLAGS) -c src/util.c -o $@

clean:
	rm -f $(OBJS) $(BIN)

test: all
	./run-tests.sh --verbose

ifdef DEBUG
debug-build: $(BIN)
	@echo "debug build enabled"
else
release-build: $(BIN)
	@echo "release build"
endif

ifeq ($(CC),gcc)
gcc-ok:
	@echo "using gcc"
else ifeq ($(CC),clang)
clang-ok:
	@echo "using clang"
else
other-cc:
	@echo "using other compiler"
endif

include config.mk
-include optional.mk
sinclude local.mk

ifneq ($(DEBUG),0)
with-debug: $(BIN)
	@echo "debug flag set"
else
without-debug: $(BIN)
	@echo "no debug flag"
endif

ifndef NO_TEST
run-tests: test
	@echo "running tests"
endif

override CFLAGS += -Wextra

export BUILD_ENV := production
unexport INTERNAL_VAR
undefine OBSOLETE_VAR

run: $(BIN)
	./$(BIN) --flag=1
