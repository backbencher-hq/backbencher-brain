/* #912 (M60-C): a definition HEADER that recovery leaves as a CALL.
 *
 * jq src/builtin.c:2067 — `static block gen_last_1(void) { … }` — never became a
 * symbol. The mechanism is lines 1969..2067 of that file, reproduced VERBATIM
 * below: the replacement text of a function-like `#define` is itself call-shaped
 * (`#define BINOP(name) CFUNC(f_ ## name, "_" #name, 3),`), and a BARE macro name
 * (`BINOPS`) stands as a table entry. The replacement-text call desynchronizes
 * recovery: its argument list swallows the rest of the table, the table's own
 * `};`, the `#undef` block and the next definition's header — which survives only
 * as an ERROR holding `static`, `block` and a `call_expression gen_last_1(void)`,
 * with the body as a sibling `compound_statement`.
 *
 * The arrival is admitted on the SAME two evidences the bare-identifier arrival
 * uses — the parameter list must end at the body's `{`, and a `#define`'s own
 * logical line is skipped — plus ONE that is this class's own: the damaged
 * region's tail must carry a reserved declaration word (`declarationSpecifierRunBefore`).
 * That is a DIFFERENT question from the bare arrival's `declarationHeaderBefore`
 * ("is there any identifier since the previous terminator"), and the difference is
 * measured, not cautious: the looser test admits the 33 `#define osCloseHandle
 * ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)` sites of sqlite os_win.c/os_unix.c
 * — a macro's replacement text published as a function — so CONTROL B below is the
 * arrive-and-refuse control for exactly that class (measured: an ERROR holding the
 * call, the next table entry supplying the `{`, and the directive's own words
 * supplying the "type" token).
 *
 * CONTROLS, each pinning one of the rule's edges:
 *   CONTROL A  an invocation with a block and NO declaration word before it —
 *              never a function. (In this file the surrounding recovery does not
 *              present it as an ERROR child, so it pins the OUTCOME; the arrival
 *              itself is exercised by CONTROL B and by the corpus A/B.)
 *   CONTROL B  the sqlite `#define` replacement-text class — arrive-and-refuse.
 *   CONTROL C  a clean `static block f(void)` definition — published by the
 *              ordinary route with no recovery metadata, and must not be claimed
 *              twice by the recovery.
 *   The SECOND desync block repeats the jq mechanism with different names, so a
 *   rule that only fires on the first table's exact text is visible here.
 */
#define CFUNC(func, name, arity) \
  {.fptr = { .a ## arity = func }, name, arity}

#define LIBM_DD(name) \
  CFUNC(f_ ## name, #name, 1),
#define LIBM_DD_NO(name) LIBM_DD(name)
#define LIBM_DA(name, type) LIBM_DD(name)
#define LIBM_DA_NO(name, type) LIBM_DD(name)

#define LIBM_DDD(name) \
  CFUNC(f_ ## name, #name, 3),
#define LIBM_DDD_NO(name) LIBM_DDD(name)

#define LIBM_DDDD(name) \
  CFUNC(f_ ## name, #name, 4),
#define LIBM_DDDD_NO(name) LIBM_DDDD(name)

static const struct cfunction function_list[] = {
#include "libm.h"
  CFUNC(f_negate, "_negate", 1),
#define BINOP(name) CFUNC(f_ ## name, "_" #name, 3),
BINOPS
#undef BINOP
  CFUNC(f_dump, "tojson", 1),
  CFUNC(f_json_parse, "fromjson", 1),
  CFUNC(f_tonumber, "tonumber", 1),
  CFUNC(f_toboolean, "toboolean", 1),
  CFUNC(f_tostring, "tostring", 1),
  CFUNC(f_keys, "keys", 1),
  CFUNC(f_keys_unsorted, "keys_unsorted", 1),
  CFUNC(f_startswith, "startswith", 2),
  CFUNC(f_endswith, "endswith", 2),
  CFUNC(f_string_split, "split", 2),
  CFUNC(f_string_explode, "explode", 1),
  CFUNC(f_string_implode, "implode", 1),
  CFUNC(f_string_indexes, "_strindices", 2),
  CFUNC(f_string_trim, "trim", 1),
  CFUNC(f_string_ltrim, "ltrim", 1),
  CFUNC(f_string_rtrim, "rtrim", 1),
  CFUNC(f_setpath, "setpath", 3),
  CFUNC(f_getpath, "getpath", 2),
  CFUNC(f_delpaths, "delpaths", 2),
  CFUNC(f_has, "has", 2),
  CFUNC(f_contains, "contains", 2),
  CFUNC(f_length, "length", 1),
  CFUNC(f_utf8bytelength, "utf8bytelength", 1),
  CFUNC(f_type, "type", 1),
  CFUNC(f_isinfinite, "isinfinite", 1),
  CFUNC(f_isnan, "isnan", 1),
  CFUNC(f_isnormal, "isnormal", 1),
  CFUNC(f_infinite, "infinite", 1),
  CFUNC(f_nan, "nan", 1),
  CFUNC(f_sort, "sort", 1),
  CFUNC(f_sort_by_impl, "_sort_by_impl", 2),
  CFUNC(f_group_by_impl, "_group_by_impl", 2),
  CFUNC(f_unique, "unique", 1),
  CFUNC(f_unique_by_impl, "_unique_by_impl", 2),
  CFUNC(f_bsearch, "bsearch", 2),
  CFUNC(f_min, "min", 1),
  CFUNC(f_max, "max", 1),
  CFUNC(f_min_by_impl, "_min_by_impl", 2),
  CFUNC(f_max_by_impl, "_max_by_impl", 2),
  CFUNC(f_error, "error", 1),
  CFUNC(f_format, "format", 2),
  CFUNC(f_env, "env", 1),
  CFUNC(f_halt, "halt", 1),
  CFUNC(f_halt_error, "halt_error", 2),
  CFUNC(f_get_search_list, "get_search_list", 1),
  CFUNC(f_get_prog_origin, "get_prog_origin", 1),
  CFUNC(f_get_jq_origin, "get_jq_origin", 1),
  CFUNC(f_match, "_match_impl", 4),
  CFUNC(f_modulemeta, "modulemeta", 1),
  CFUNC(f_input, "input", 1),
  CFUNC(f_debug, "debug", 1),
  CFUNC(f_stderr, "stderr", 1),
  CFUNC(f_strptime, "strptime", 2),
  CFUNC(f_strftime, "strftime", 2),
  CFUNC(f_strflocaltime, "strflocaltime", 2),
  CFUNC(f_mktime, "mktime", 1),
  CFUNC(f_gmtime, "gmtime", 1),
  CFUNC(f_localtime, "localtime", 1),
  CFUNC(f_now, "now", 1),
  CFUNC(f_current_filename, "input_filename", 1),
  CFUNC(f_current_line, "input_line_number", 1),
  CFUNC(f_have_decnum, "have_decnum", 1),
  CFUNC(f_have_decnum, "have_literal_numbers", 1),
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

/* CONTROL A — a macro invocation with a block and no declaration word before it. */
FOREACH(item) {
  handle(item);
}

/* CONTROL C — a clean `static block f(void)` definition. */
static block gen_last_0(void) {
  return (block)0;
}

/* CONTROL B — `#define osX ((cast)expr)` inside a table (sqlite os_win.c, 33 sites). */
#define SYSCALL void *
#define WINAPI
static const void *aSyscall[] = {
  { "CloseHandle",       (SYSCALL)CloseHandle,       0 },
#define osCloseHandle ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)

  { "CreateFileW",       (SYSCALL)CreateFileW,       0 },
};

/* The same desync a second time, with different names: a rule that only fires on
 * the first table's exact text is visible here. */
#define CFUNC2(func, name, arity) \
  {.fptr = { .a ## arity = func }, name, arity}

static const struct cfunction second_list[] = {
#include "libm2.h"
  CFUNC2(f_negate, "_negate", 1),
#define BINOP2(name) CFUNC2(f_ ## name, "_" #name, 3),
BINOPS2
#undef BINOP2
  CFUNC2(f_dump, "tojson", 1),
};
#undef LIBM_DDDD_NO
#undef LIBM_DDD_NO
#undef LIBM_DD_NO
#undef LIBM_DA_NO
#undef LIBM_DDDD
#undef LIBM_DDD
#undef LIBM_DD
#undef LIBM_DA

/* CONTROL A, second spelling: an invocation with a block, no declaration words. */
FOREACH(item) {
  handle(item);
}
