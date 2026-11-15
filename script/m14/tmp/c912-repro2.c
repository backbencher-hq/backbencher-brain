/* #912 repro attempt: a macro-driven initializer list with an #include inside
 * it, whose `};` recovery then loses, leaving the next definition's header as an
 * ERROR holding `static block` and a call-shaped declarator. */
struct cfunction { const char *name; int arity; };

#define ENTRY(func, name, arity) { name, arity }

static const struct cfunction function_list[] = {
#include "entries.h"
  ENTRY(f_one, "one", 1),
  ENTRY(f_two, "two", 2),
};

#undef LIBM_DD
#undef LIBM_DA

// a hack comment
static block gen_last_1(void) {
  block last_var = 0;
  return last_var;
}
