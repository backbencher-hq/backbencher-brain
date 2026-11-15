/* c/call-edge-is-not-a-macro-953 -- a call edge must name a function, and a
 * function name is not a macro.
 *
 * The call-edge fidelity probe (`script/m14/tmp/c-audit/call-edge-fidelity.ts`)
 * compares every `calls` edge the analyzer publishes against the PARSE, per
 * (callee, line), in both directions. It exists because the corpus census reported
 * `sameSiteDuplicates` -- 1447 in redis, 129 in curl, 291 in libgit2, all
 * `calls/c_function_call` -- and that number had never been adjudicated. A line is
 * not a site: `x = f(1) + f(2)` is two real calls and C-D14's ruling is one edge per
 * OCCURRENCE, so two edges there are correct. The probe moved the question to ground
 * truth, and its first finding was that the census number was fine and the CALLEE
 * name was not.
 *
 * #953 A CALL WHOSE CALLEE IS A MACRO IS NOT A CALL.
 *
 *     UNUSED(interval);                    -> calls anetKeepAlive -> UNUSED
 *     EVENT_MASK_OFFSET(fd)                -> calls getEventMask  -> EVENT_MASK_OFFSET
 *
 * There is no such function: the preprocessor substitutes an expression, and the
 * analyzer's own position -- applied twice already, to macro-named members (#928)
 * and macro-named enumerators (#931) -- is that a macro use is a `uses` fact and not
 * a declaration. A `calls` edge asserts the opposite. This is the THIRD position the
 * same rule applies to, and its absence here is why the class survived the other two:
 * the call extractor was never given the macro inventory the other two extractors
 * were handed. Measured: 2016 sites over 120 redis files, 1345 over libgit2, 652
 * over curl -- about 4,000 phantom call edges, and the single largest relationship
 * class in the lane (`calls` is 32,730 of 56,649 edges on the census scope).
 *
 * The name can be BOTH, and then it is a call: C permits a macro and a function to
 * share a name in one translation unit, and curl's lib/cf-socket.c has both --
 * `static void alive_unit(int *x)` at line 180 and an EMPTY `#define alive_unit(x)`
 * at line 190, so `alive_unit(&optval)` at line 261 is a real call. Suppressing on
 * the macro name alone would delete real edges, so the rule is macro AND not a
 * declared function.
 *
 * #954 A CALLEE THAT IS NOT A NAME NODE IS NOT A CALL.
 *
 *     #if PCRE2_CODE_UNIT_WIDTH == 8     -> calls pcre2_dfa_match -> "8"
 *
 * A number is not callable. Every earlier guard on that branch listed the shapes it
 * RECOGNISED and let everything else fall through to the callee's text, so a callee
 * that was none of the known shapes became a call target by default -- the wrong
 * default for a field meant to hold a name. The test is the node type, not a pattern
 * on the text, because P11 holds this file to zero regex literals and this is the
 * hottest path in the analyzer.
 *
 * The CONTROLS are the other half: the macro's own symbol must still be minted, the
 * macro's READS must still be `uses` edges (the probe's "macro invocations" row is
 * 2,047 in redis and every one of them has no `calls` edge), and a genuine call must
 * survive -- including the `va_start` family, which are `<stdarg.h>` macros the
 * analyzer CANNOT see (C-D2, cross-file) and which are therefore the declared
 * residual rather than a defect.
 */

/* #953: a macro callee. No call edge may name it. */
#define UNUSED(x) ((void)(x))
#define TWICE(x) ((x) + (x))

static int helper(int v) {
  UNUSED(v);
  return TWICE(v);
}

/* #953 CONTROL: a name that is BOTH a macro and a real function keeps its edge. */
static void alive_unit(int *x) {
  (void)x;
}
#define alive_unit(x)

static void keepalive(int *p) {
  alive_unit(p);
}

/* #954: a directive line is not a call, and a number is not a callee. */
#define WIDTH 8
static int width_guard(void) {
#if WIDTH == 8
  return 8;
#else
  return 0;
#endif
}

/* #954 / #953 CONTROL: genuine calls, in every shape that must survive. */
int real_call(int a);
int real_void_call(void);

static int genuine(void) {
  int n = real_call(1);
  real_void_call();
  return n;
}

/* A function-pointer member call keeps its target, and is a real call. */
struct dispatch {
  int (*handler)(int);
};

static int via_pointer(struct dispatch *d) {
  return d->handler(2);
}
