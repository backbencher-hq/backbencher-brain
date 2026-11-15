/* #912 draft v6. */
typedef struct block block;

#define CFUNC(func, name, arity) \
  {.fptr = { .a ## arity = func }, name, arity}

#define LIBM_DD(name) \
  CFUNC(f_ ## name, #name, 1),
#define LIBM_DD_NO(name) LIBM_DD(name)
#define LIBM_DA(name, type) LIBM_DD(name)
#define LIBM_DA_NO(name, type) LIBM_DD(name)

struct cfunction { const char *name; int arity; };

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

// This is a hack to make last(g) yield no output values,
// if g yields no output values, without using boxing.
static block gen_last_1(void) {
  block last_var = 0;
  return last_var;
}

/* CONTROL A — the same tree shape with NO declaration word before the call. */
FOREACH(item) {
  handle(item);
}

/* CONTROL C — a clean `static block f(void)` definition. */
static block gen_last_0(void) {
  return (block)0;
}

/* CONTROL B — `#define osX ((cast)expr)` inside a table. */
#define SYSCALL void *
#define WINAPI
static const void *aSyscall[] = {
  { "CloseHandle",       (SYSCALL)CloseHandle,       0 },
#define osCloseHandle ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)

  { "CreateFileW",       (SYSCALL)CreateFileW,       0 },
};
