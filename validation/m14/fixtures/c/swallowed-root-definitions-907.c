/* #907 round 2 (M60-C) — the SAME class, three further arrivals.
 *
 * This fixture is a real recovery shape, not a synthesised one: three verbatim
 * slices of jq at its HEAD, each of which presents a file-scope definition
 * header under an ERROR the grammar's preprocessor scanner created.
 *
 *   slice 1  jq src/jv.c      L673-700   root-level ERROR, plain declarator
 *                                        `jv jv_number(double x) {`
 *   slice 2  jq src/util.c    L600-640   root-level ERROR, pointer-wrapped
 *                                        `char* strptime(...) {`
 *   slice 3  jq src/jv_dtoa.c L1060-1100 wrapped static header
 *                                        `static double` / `ulp` / `(...)` `{`
 *
 * The round-1 fix required the ERROR to sit inside a `compound_statement`; all
 * three of these arrive at file scope or through a `pointer_declarator`, so they
 * were still lost (measured: script/m14/tmp/c907-slice-hunt.ts loses all three
 * at the pre-round-2 tree, recovers all three after).
 *
 * The discriminator is unchanged and is what `forbidSymbols` guards: a definition
 * iff the character after the declarator is `{`. A call, prototype, or initialiser
 * ends in `;`, `,`, `)`, or `=`, and must never be recovered as a symbol.
 */

/* ===== slice 1: jq src/jv.c L673-700 ===== */
jv jv_number(double x) {
  jv j = {
#ifdef USE_DECNUM
    JVP_FLAGS_NUMBER_NATIVE,
#else
    JV_KIND_NUMBER,
#endif
    0, 0, 0, {.number = x}
  };
  return j;
}

static void jvp_number_free(jv j) {
  assert(JVP_HAS_KIND(j, JV_KIND_NUMBER));
#ifdef USE_DECNUM
  if (JVP_HAS_FLAGS(j, JVP_FLAGS_NUMBER_LITERAL) && jvp_refcnt_dec(j.u.ptr)) {
    jvp_literal_number* n = jvp_literal_number_ptr(j);
    if (n->literal_data) {
      jv_mem_free(n->literal_data);
    }
    jv_mem_free(n);
  }
#endif
}

double jv_number_value(jv j) {
  assert(JVP_HAS_KIND(j, JV_KIND_NUMBER));
#ifdef USE_DECNUM
/* ===== slice 2: jq src/util.c L600-640 ===== */
//    tz = tzalloc(buf);
//    if (tz == NULL)
//        return 0;

    *bp = rp;
    tm->tm_isdst = 0;	/* XXX */
#ifdef TM_GMTOFF
    tm->TM_GMTOFF = tzgetgmtoff(tz, tm->tm_isdst);
#endif
#ifdef TM_ZONE
    // Can't use tzgetname() here because we are going to free()
    tm->TM_ZONE = NULL; /* XXX */
#endif
//    tzfree(tz);
    return 1;
}

char* strptime(const char *buf, const char *fmt, struct tm *tm)
{
    unsigned char c;
    const unsigned char *bp, *ep, *zname;
    int alt_format, i, split_year = 0, neg = 0, state = 0,
        day_offset = -1, week_offset = 0, offs, mandatory;
    const char *new_fmt;

    bp = (const unsigned char *)buf;

    while (bp != NULL && (c = *fmt++) != '\0') {
        /* Clear `alternate' modifier prior to new conversion. */
        alt_format = 0;
        i = 0;

        /* Eat up white-space. */
        if (isspace(c)) {
            while (isspace(*bp))
                bp++;
            continue;
        }

        if (c != '%')
            goto literal;
/* ===== slice 3: jq src/jv_dtoa.c L1060-1100 ===== */
#else
	do {
		y = *xa++ - *xb++ - borrow;
		borrow = (y & 0x10000) >> 16;
		*xc++ = y & 0xffff;
		}
		while(xb < xbe);
	while(xa < xae) {
		y = *xa++ - borrow;
		borrow = (y & 0x10000) >> 16;
		*xc++ = y & 0xffff;
		}
#endif
#endif
	while(!*--xc)
		wa--;
	c->wds = wa;
	return c;
	}

 static double
ulp
 (struct dtoa_context* C, U *x)
{
	Long L;
	U u;

	L = (word0(x) & Exp_mask) - (P-1)*Exp_msk1;
#ifndef Avoid_Underflow
#ifndef Sudden_Underflow
	if (L > 0) {
#endif
#endif
#ifdef IBM
		L |= Exp_msk1 >> 4;
#endif
		word0(&u) = L;
		word1(&u) = 0;
#ifndef Avoid_Underflow
#ifndef Sudden_Underflow
		}

/* ===== authored controls (NOT corpus slices) =====
 * These pin the two shapes the widened rule must refuse. Both are measured in
 * script/m14/tmp/c907-macro-probe.ts: the `#define` body lands as a raw
 * `preproc_arg` and the invocation as a `macro_type_specifier`, so neither can
 * reach the recovery — which is the point of asserting their absence here.
 */
#define C907_DEF(n) void n(void) { }
#define C907_DEF_OPEN(n) void n(void) {
C907_DEF(c907_macro_generated)
C907_DEF_OPEN(c907_macro_generated_open)
}
static int c907_control_caller(void) { return c907_never_defined(3); }
