# `$(call NAME)` is a call, and a bare top-level expression is still a place
# references live.
#
# Two separate defects are pinned here.
#
# 1. A macro must be a FUNCTION. `$(call mk)` that resolves to a `constant` is a
#    callee that cannot be called, so the `define` declares a Function.
#
# 2. References used to be collected only beneath a `variable_assignment` and a
#    `rule`. A bare top-level expression is a `function_call` DIRECTLY under
#    `makefile`, so that line contributed nothing at all — and it is the idiom
#    nomad/GNUmakefile uses to reify its package targets. The corpus has one such
#    site and it produced zero edges before the fix.

define mk
	@echo "packing $(1)"
endef

define two_args
	@echo "$(1) and $(2)"
endef

# a plain call inside a recipe
pkg:
	$(call mk,pkg)

# a nested call: foreach > eval > call
$(foreach t,alpha beta,$(eval $(call mk,$(t))))

# positional parameters are NOT declarations: $(1) must not become a symbol
combined:
	$(call two_args,$(1),$(2))
