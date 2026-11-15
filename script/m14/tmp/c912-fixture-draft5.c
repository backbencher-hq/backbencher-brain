#define SYSCALL void *
#define WINAPI

struct cfunction { const char *name; int arity; };
typedef struct block block;

/* CONTROL C — a clean `static block f(void)` definition: published by the
 * ordinary route, no recovery metadata, and must not be claimed twice. */
static block gen_last_0(void) {
  return (block)0;
}

/* CONTROL B — sqlite os_win.c/os_unix.c, 33 measured sites: `#define osX
 * ((cast)expr)` inside a table parses as an ERROR holding a CALL, and the next
 * entry supplies the `{` that makes it definition-shaped. Must stay refused. */
static const void *aSyscall[] = {
  { "CloseHandle",       (SYSCALL)CloseHandle,       0 },
#define osCloseHandle ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)

  { "CreateFileW",       (SYSCALL)CreateFileW,       0 },
};

#define CFUNC(func, name, arity) \
  {.fptr = { .a ## arity = func }, name, arity}

#define LIBM_DD(name) \
  CFUNC(f_ ## name, #name, 1),
#define LIBM_DD_NO(name) LIBM_DD(name)
#define LIBM_DA(name, type) LIBM_DD(name)
#define LIBM_DA_NO(name, type) LIBM_DD(name)

static const struct cfunction function_list[] = {
#include "libm.h"
  CFUNC(f_negate, "_negate", 1),
#define BINOP(name) CFUNC(f_ ## name, "_" #name, 3),
BINOPS
#undef BINOP
  CFUNC(f_dump, "tojson", 1),
};
#undef LIBM_DDDD_NO
#undef LIBM_DDD_NO
#undef LIBM_DD_NO
#undef LIBM_DA_NO
#undef LIBM_DDDD
#undef LIBM_DDD
#undef LIBM_DD
#undef LIBM_DA

/* CONTROL A — the same tree shape (a call whose own parameter list ends at the
 * body's `{`), with NO declaration word in the damaged region's tail. */
FOREACH(item) {
  handle(item);
}

// This is a hack to make last(g) yield no output values,
// if g yields no output values, without using boxing.
static block gen_last_1(void) {
  block last_var = 0;
  return last_var;
}
