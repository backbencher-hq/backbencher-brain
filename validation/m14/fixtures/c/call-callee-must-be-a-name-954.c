/* c/call-callee-must-be-a-name-954 — and a record of a fix that was reverted.
 *
 * The call-edge fidelity probe (`script/m14/tmp/c-audit/call-edge-fidelity.ts`)
 * compares every `calls` edge the analyzer publishes against the PARSE, per
 * (callee, line), in both directions. It was written to adjudicate the corpus
 * census's `sameSiteDuplicates` -- 1447 in redis, 129 in curl, 291 in libgit2, all
 * `calls/c_function_call` -- which had never been classified. Two results came out
 * of it, and the first one was a wrong turn worth writing down.
 *
 * THE CENSUS NUMBER IS CORRECT. A line is not a site: `x = f(1) + f(2)` is two real
 * calls to one callee on one line, and C-D14's ruling is one edge per OCCURRENCE.
 * Once the probe could compare like with like, that class went to ZERO unexplained
 * rows on all three corpora. It was never a defect and never needed a ruling.
 *
 * WHAT THE PROBE GOT WRONG, AND WHY IT MATTERS. Its first run reported ~4,000
 * "phantom" call edges whose callee is a file-local macro -- `UNUSED(interval)`
 * publishing `calls anetKeepAlive -> UNUSED` -- and the fix looked obvious. The lane
 * already refuses macro-named MEMBERS (#928) and macro-named ENUMERATORS (#931), so
 * a macro-named CALLEE looked like the same rule applied a third time, and the
 * suppression was implemented, measured, and committed to a draft.
 *
 * It contradicts a pinned contract. #908's ruling, in
 * `c/function-like-macro-not-a-binding-908` and derived from the M12 TRUTH, is
 * explicit: **"the truth counts a macro invocation as `calls (expr)` AND `uses
 * (expr)`"** -- and that fixture expects `calls c908_read -> YY_INITIAL_VALUE` BY
 * NAME. The edge is not an oversight. It is what the ground truth requires, and
 * deleting it would have removed a fact the oracle demands.
 *
 * The distinction the two pinned fixtures draw together is sharp, and it is not in
 * the analyzer's favour everywhere:
 *
 *   - a REAL function-like macro INVOCATION gets a `calls` edge (#908, truth);
 *   - a `#define` REPLACEMENT LIST that recovery reads as a call gets NEITHER,
 *     because a definition site is not an invocation (#912, pinned by
 *     `c/call-shaped-declarator-912`: the call-shaped text "must not become a `uses`
 *     of a symbol either").
 *
 * So the macro rule is about DEFINITION SITES, not about callees, and the analyzer
 * was already right on both counts. The probe's model was the defect: it treated the
 * literal parse as ground truth, so a documented divergence read as a bug. That is
 * the probe's fifth wrong number on this thread, and the reason this file leads with
 * the wrong turn rather than the right one.
 *
 * #954, WHICH STANDS: a callee that is not a NAME NODE is not a call.
 *
 *     #if PCRE2_CODE_UNIT_WIDTH == 8   -> calls pcre2_dfa_match -> "8"
 *
 * A number is not callable, and no fixture requires that edge. Every earlier guard
 * on that branch listed the shapes it RECOGNISED and let everything else fall
 * through to the callee's text, so a callee that was none of the known shapes became
 * a call target by default -- the wrong default for a field meant to hold a name.
 * The test is the node type rather than a pattern on the text, because P11 holds
 * this file to zero regex literals and this is the hottest path in the analyzer.
 * The controls are the shapes that must survive: a plain call, a function-pointer
 * MEMBER call, and a name that is both a macro and a real function.
 */

/* #953 REVERTED: these two edges are REQUIRED by the pinned #908 truth ruling.
 * They are here as CONTROLS, not as defects. Do not "fix" them. */
#define UNUSED(x) ((void)(x))
#define TWICE(x) ((x) + (x))

static int helper(int v) {
  UNUSED(v);
  return TWICE(v);
}

/* A name that is BOTH a macro and a real function. curl's lib/cf-socket.c has both
 * -- `static void alive_unit(int *x)` and an empty `#define alive_unit(x)` -- so the
 * invocation is a real call, and any rule keyed on the macro name alone would delete
 * it. */
static void alive_unit(int *x) {
  (void)x;
}
#define alive_unit(x)

static void keepalive(int *p) {
  alive_unit(p);
}

/* #954: a number is not a callee.
 *
 * The shape matters and the first version of this fixture did NOT reproduce it --
 * the gate's mutant SURVIVED, which is the correct outcome for an inert fixture. The
 * real input is libgit2's pcre2_dfa_match.c:3604-3606, verbatim in shape:
 *
 *     while (check_subject > subject &&
 *     #if PCRE2_CODE_UNIT_WIDTH == 8
 *           (*check_subject & 0xc0) == 0x80)
 *
 * A preprocessor DIRECTIVE in the middle of an expression costs the parser the
 * expression's structure, and it glues the `8` that ends the directive line to the
 * `(` that starts the next one: `call(callee: number_literal "8")`. The analyzer
 * faithfully reports the parse, and what it publishes is `calls pcre2_dfa_match ->
 * "8"`. A numeric literal is not callable, so the edge is noise whatever produced it
 * -- and refusing it is strictly better than publishing it, because a downstream
 * consumer cannot tell a damaged parse from a real call.
 *
 * The damaged-while form below is what reproduces the glue. A directive with an
 * ordinary body (`#if WIDTH == 8 / return 8;`) does NOT, which is exactly the
 * difference the surviving mutant exposed.
 */
#define WIDTH 8
static int damaged_while(int p) {
  int n = 0;
  while (p > 0 &&
#if WIDTH == 8
      (n & 0xc0) == 0x80)
#endif
    n--;
  return n;
}

/* #954 CONTROLS: genuine calls, in every shape that must survive. */
int real_call(int a);
int real_void_call(void);

static int genuine(void) {
  int n = real_call(1);
  real_void_call();
  return n;
}

struct dispatch {
  int (*handler)(int);
};

static int via_pointer(struct dispatch *d) {
  return d->handler(2);
}
