// fixture: c/swallowed-definitions-907  (#907)
//
// A real recovery shape, not a synthesised one. This is jq src/jv_print.c lines
// 219-396 (MIT-licensed; pinned corpus checkout) — the body of jv_dump_term, whose
// switch case at L254 pairs `} else {` (L262) with a closing brace that lives inside a
// later `#ifdef USE_DECNUM` (L276). The grammar's preprocessor scanner and the case body
// disagree about that nesting, so the `case` runs away to L394 and swallows the two
// file-scope definitions after it (`jv_dumpf` at 389, `jv_dump` at 393) into its body.
//
// Measured: with this slice alone the tree still glues them (cross-checked with
// script/m14/tmp/c907-prefix-bisect.ts, whose broad detector reports exactly two
// swallowed-body headers), and the analyzer at the fix commit emits NO symbol for
// either — they exist in the tree only as an ERROR holding a type node plus a
// function_declarator whose next non-space character is `{`.
//
// C has no nested functions, so a definition header inside a body can only be recovery
// glue for a FILE-SCOPE definition — which is what the analyzer now emits.

static void jv_dump_term(struct dtoa_context* C, jv x, int flags, int indent, FILE* F, jv* S) {
  char buf[JVP_DTOA_FMT_MAX_LEN];
  const char* color = 0;
  double refcnt = (flags & JV_PRINT_REFCOUNT) ? jv_get_refcnt(x) - 1 : -1;
  if ((flags & JV_PRINT_COLOR) && jv_get_kind(x) != JV_KIND_INVALID) {
    color = colors[(int)jv_get_kind(x) - 1];
    put_str(color, F, S, flags & JV_PRINT_ISATTY);
  }
  if (indent > MAX_PRINT_DEPTH) {
    put_str("<skipped: too deep>", F, S, flags & JV_PRINT_ISATTY);
  } else switch (jv_get_kind(x)) {
  default:
  case JV_KIND_INVALID:
    if (flags & JV_PRINT_INVALID) {
      jv msg = jv_invalid_get_msg(jv_copy(x));
      if (jv_get_kind(msg) == JV_KIND_STRING) {
        put_str("<invalid:", F, S, flags & JV_PRINT_ISATTY);
        jvp_dump_string(msg, flags | JV_PRINT_ASCII, F, S, flags & JV_PRINT_ISATTY);
        put_char('>', F, S, flags & JV_PRINT_ISATTY);
      } else {
        put_str("<invalid>", F, S, flags & JV_PRINT_ISATTY);
      }
    } else {
      assert(0 && "Invalid value");
    }
    break;
  case JV_KIND_NULL:
    put_str("null", F, S, flags & JV_PRINT_ISATTY);
    break;
  case JV_KIND_FALSE:
    put_str("false", F, S, flags & JV_PRINT_ISATTY);
    break;
  case JV_KIND_TRUE:
    put_str("true", F, S, flags & JV_PRINT_ISATTY);
    break;
  case JV_KIND_NUMBER: {
    if (jvp_number_is_nan(x)) {
      jv_dump_term(C, jv_null(), flags, indent, F, S);
    } else {
#ifdef USE_DECNUM
      const char * literal_data = jv_number_get_literal(x);
      if (literal_data) {
        put_str(literal_data, F, S, flags & JV_PRINT_ISATTY);
      } else {
#endif
        double d = jv_number_value(x);
        if (d != d) {
          // JSON doesn't have NaN, so we'll render it as "null"
          put_str("null", F, S, flags & JV_PRINT_ISATTY);
        } else {
          // Normalise infinities to something we can print in valid JSON
          if (d > DBL_MAX) d = DBL_MAX;
          if (d < -DBL_MAX) d = -DBL_MAX;
          put_str(jvp_dtoa_fmt(C, buf, d), F, S, flags & JV_PRINT_ISATTY);
        }
      }
#ifdef USE_DECNUM
    }
#endif
    break;
  }
  case JV_KIND_STRING:
    jvp_dump_string(x, flags & JV_PRINT_ASCII, F, S, flags & JV_PRINT_ISATTY);
    if (flags & JV_PRINT_REFCOUNT)
      put_refcnt(C, refcnt, F, S, flags & JV_PRINT_ISATTY);
    break;
  case JV_KIND_ARRAY: {
    if (jv_array_length(jv_copy(x)) == 0) {
      put_str("[]", F, S, flags & JV_PRINT_ISATTY);
      break;
    }
    put_char('[', F, S, flags & JV_PRINT_ISATTY);
    jv_array_foreach(x, i, elem) {
      if (i!=0) {
        if (color) put_str(color, F, S, flags & JV_PRINT_ISATTY);
        put_char(',', F, S, flags & JV_PRINT_ISATTY);
      }
      if (color) put_str(COLRESET, F, S, flags & JV_PRINT_ISATTY);
      if (flags & JV_PRINT_PRETTY) {
        put_char('\n', F, S, flags & JV_PRINT_ISATTY);
        put_indent(indent + 1, flags, F, S, flags & JV_PRINT_ISATTY);
      }
      jv_dump_term(C, elem, flags, indent + 1, F, S);
    }
    if (flags & JV_PRINT_PRETTY) {
      put_char('\n', F, S, flags & JV_PRINT_ISATTY);
      put_indent(indent, flags, F, S, flags & JV_PRINT_ISATTY);
    }
    if (color) put_str(color, F, S, flags & JV_PRINT_ISATTY);
    put_char(']', F, S, flags & JV_PRINT_ISATTY);
    if (flags & JV_PRINT_REFCOUNT)
      put_refcnt(C, refcnt, F, S, flags & JV_PRINT_ISATTY);
    break;
  }
  case JV_KIND_OBJECT: {
    if (jv_object_length(jv_copy(x)) == 0) {
      put_str("{}", F, S, flags & JV_PRINT_ISATTY);
      break;
    }
    put_char('{', F, S, flags & JV_PRINT_ISATTY);
    int first = 1;
    int i = 0;
    jv keyset = jv_null();
    while (1) {
      jv key, value;
      if (flags & JV_PRINT_SORTED) {
        if (first) {
          keyset = jv_keys(jv_copy(x));
          i = 0;
        } else {
          i++;
        }
        if (i >= jv_array_length(jv_copy(keyset))) {
          jv_free(keyset);
          break;
        }
        key = jv_array_get(jv_copy(keyset), i);
        value = jv_object_get(jv_copy(x), jv_copy(key));
      } else {
        if (first) {
          i = jv_object_iter(x);
        } else {
          i = jv_object_iter_next(x, i);
        }
        if (!jv_object_iter_valid(x, i)) break;
        key = jv_object_iter_key(x, i);
        value = jv_object_iter_value(x, i);
      }

      if (!first) {
        if (color) put_str(color, F, S, flags & JV_PRINT_ISATTY);
        put_char(',', F, S, flags & JV_PRINT_ISATTY);
      }
      if (color) put_str(COLRESET, F, S, flags & JV_PRINT_ISATTY);
      if (flags & JV_PRINT_PRETTY) {
        put_char('\n', F, S, flags & JV_PRINT_ISATTY);
        put_indent(indent + 1, flags, F, S, flags & JV_PRINT_ISATTY);
      }

      first = 0;
      if (color) put_str(FIELD_COLOR, F, S, flags & JV_PRINT_ISATTY);
      jvp_dump_string(key, flags & JV_PRINT_ASCII, F, S, flags & JV_PRINT_ISATTY);
      jv_free(key);
      if (color) put_str(COLRESET, F, S, flags & JV_PRINT_ISATTY);

      if (color) put_str(color, F, S, flags & JV_PRINT_ISATTY);
      put_char(':', F, S, flags & JV_PRINT_ISATTY);
      if (color) put_str(COLRESET, F, S, flags & JV_PRINT_ISATTY);
      if (flags & JV_PRINT_PRETTY) {
        put_char(' ', F, S, flags & JV_PRINT_ISATTY);
      }

      jv_dump_term(C, value, flags, indent + 1, F, S);
    }
    if (flags & JV_PRINT_PRETTY) {
      put_char('\n', F, S, flags & JV_PRINT_ISATTY);
      put_indent(indent, flags, F, S, flags & JV_PRINT_ISATTY);
    }
    if (color) put_str(color, F, S, flags & JV_PRINT_ISATTY);
    put_char('}', F, S, flags & JV_PRINT_ISATTY);
    if (flags & JV_PRINT_REFCOUNT)
      put_refcnt(C, refcnt, F, S, flags & JV_PRINT_ISATTY);
  }
  }
  jv_free(x);
  if (color) {
    put_str(COLRESET, F, S, flags & JV_PRINT_ISATTY);
  }
}

void jv_dumpf(jv x, FILE *f, int flags) {
  jv_dump_term(tsd_dtoa_context_get(), x, flags, 0, f, 0);
}

void jv_dump(jv x, int flags) {
  jv_dumpf(x, stdout, flags);
}

