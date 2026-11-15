/* #992: a marker CALL's argument is a NAME, not an expression.
 *
 * Found on the WHOLE admitted .c population by this lane's D2 census
 * (`script/m14/c-emission-census.ts --cap=0`): 5,022/5,022 files parsed across 39
 * repos, 291 `exports` edges — of which 7 carried the marker `static_assert` and
 * every one of their SOURCES was the assertion's CONDITION:
 *
 *     redis/src/util.c:63        `UINTPTR_MAX == 0xffffffffffffffff || UINTPTR_MAX == …`
 *     redis/src/ebuckets.c:109-113  `offsetof(FirstSegHdr, head) == 0`
 *     redis/src/crccombine.c:120-122 `sizeof(uint64_t) == 8`
 *
 * The cause is structural, not a corpus accident: redis defines
 *
 *     #define static_assert(expr, lit) extern char __static_assert_failure[(expr) ? 1:-1]
 *
 * so the replacement list OPENS WITH `extern` and the #989 agreement rule —
 * correctly — makes the macro a linkage marker. The marker's INVOCATION then
 * reached the call branch of `exports`, which read the first ARGUMENT as the
 * exported name. An argument that is an expression can never be a declared name,
 * and `exports <expression> -> static_assert` asserts a module interface entry for
 * nothing.
 *
 * False edges rank above missing ones in this lane, so the argument path now
 * accepts only a BARE IDENTIFIER (the only spelling a declaration has in C). The
 * two positives are the controls that stop the guard from becoming "switch the
 * call branch off": a kernel-convention call whose argument IS a name still
 * publishes, and a userspace marker prefix on a declaration still publishes.
 */
#define static_assert(expr, lit) extern char __static_assert_failure[(expr) ? 1:-1]
#define EXPORT_SYMBOL(name, licence) extern char __exported_##name[]
#define PUBLIC_API extern

static_assert(sizeof(long) == 8, "64-bit only");
static_assert(1 + 1 == 2, "arithmetic");

EXPORT_SYMBOL(kernel_exported, GPL);
PUBLIC_API int true_export(void);

int kernel_exported(void) { return 1; }
int true_export(void) { return 2; }
