# Library.mk — positive fixture: pattern rules, functions, define bodies, eval/call
# Line numbers matter: the ground truth references exact lines.

SRC_DIR  := lib
BUILD_DIR := build
LIB      := $(BUILD_DIR)/libcore.a
OBJS     := $(patsubst %.c,$(BUILD_DIR)/%.o,$(SRC_FILES))

SRC_FILES = $(wildcard $(SRC_DIR)/*.c)

define COMPILE_RULE
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	$(CC) $(CFLAGS) -c $$< -o $$@
endef

$(eval $(call COMPILE_RULE,core))

$(LIB): $(OBJS)
	$(AR) rcs $@ $(OBJS)

.PHONY: lib clean_lib

lib: $(LIB)

clean_lib:
	rm -rf $(BUILD_DIR)

tags:
	$(shell ctags -R . 2>/dev/null || true)

print-%:
	@echo $*=$($*)

verify: $(LIB)
	$(call RUN_TESTS,core)
