/* verbatim jq src/builtin.c 1969..2075 */
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
  block last_var = gen_op_var_fresh(STOREV, "last");
  block is_empty_var = gen_op_var_fresh(STOREV, "is_empty");
  block init = BLOCK(gen_op_simple(DUP),
                     gen_const(jv_null()),
                     last_var,
                     gen_op_simple(DUP),
                     gen_const(jv_true()),
                     is_empty_var);
