/* #912 draft. */
typedef struct block block;
struct cfunction { const char *name; int arity; };
#define SYSCALL void *
#define WINAPI

/* ---- CONTROL B: the #define replacement-text class (sqlite os_win.c/os_unix.c,
 * 33 sites). `#define osX ((cast)expr)` inside a table is parsed as an ERROR
 * holding a CALL, and the next entry supplies the `{` that makes it look like a
 * definition. Must NOT become a function. */
static const void *aSyscall[] = {
  { "CloseHandle",       (SYSCALL)CloseHandle,       0 },
#define osCloseHandle ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)

  { "CreateFileW",       (SYSCALL)CreateFileW,       0 },
};

/* ---- CONTROL A: a macro invocation with a block, no declaration words before
 * it. Must NOT become a function. */
FOREACH(item) {
  handle(item);
}

/* ---- the jq mechanism (src/builtin.c:1989): the replacement text of a
 * function-like #define is itself call-shaped, and a BARE macro name stands as a
 * table entry — so the replacement-text `call_expression` swallows the rest of
 * the file, including this table's `};`. */
#define ENTRY(func, name, arity) { name, arity }
static const struct cfunction function_list[] = {
  ENTRY(f_negate, "_negate", 1),
#define BINOP(name) ENTRY(f_ ## name, "_" #name, 3),
BINOPS
#undef BINOP
  ENTRY(f_dump, "tojson", 1),
};

#undef LIBM_DD
#undef LIBM_DA

/* ---- the recovered definition: jq src/builtin.c:2067. */
static block gen_last_1(void) {
  block last_var = 0;
  return last_var;
}
