/* c/overrides-conditional-redefinition-989 -- C's ONLY legal redefinition is a
 * conditional one, and it is an override.
 *
 * The C lane ruled `overrides` inapplicable on the prose "C-D1: no class
 * hierarchy". That is the exact reasoning the ontology gate exists to distrust:
 * `script/m14/ontology-coverage-gate.ts` was written because `overrides` was
 * missing from BASH for a whole wave on prose, the differential stayed green (the
 * oracle omitted the type too, and two implementations that both say nothing agree
 * perfectly), and only measuring the LANGUAGE found it. C has strictly MORE
 * redefinitions than bash -- bash redefines functions across a file, C redefines
 * them across preprocessor arms.
 *
 * There IS a difference from bash and it is the whole rule. C 6.9p5 makes an
 * unconditional second definition of an external identifier a CONSTRAINT
 * VIOLATION, so in legal C a redefinition exists only in two arms of one `#if` /
 * `#ifdef`. The test is therefore structural -- the two definitions must share an
 * enclosing conditional and sit in DIFFERENT arms of it -- and never evaluates a
 * condition, so it never needs to know whether a macro is defined (C-D2).
 *
 * Measured over 359 sqlite C/H files
 * (`script/m14/tmp/c-audit/c-ontology-verdicts.ts`): 50 mutually-exclusive
 * redefinition pairs in 23 files, of which `src/hwtime.h` carries five
 * definitions of `sqlite3Hwtime` (lines 24, 33, 41, 49, 57, 80) across one
 * `#if / #elif / #elif / #elif / #else` chain, `src/btmutex.c` two
 * (`sqlite3BtreeEnter`, `sqlite3BtreeEnterAll`), and `src/os.c`,
 * `src/expr.c`, `src/memdb.c`, `src/vdbemem.c` one each.
 *
 * THE CONTROLS BELOW ARE THE POINT. They are the readings that must NOT fire, and
 * every one of them is a real shape in the corpus:
 *
 *   - two definitions under DIFFERENT conditionals whose CONDITIONS contradict
 *     (sqlite `src/mutex_noop.c:52` under `#ifndef SQLITE_DEBUG`, `:188` under
 *     `#ifdef SQLITE_DEBUG`) -- exclusive, but only a preprocessor EVALUATOR can
 *     see it, which is C-D2;
 *   - the same under `src/threads.c` (the unix implementation vs the win32 one);
 *   - parse damage (sqlite `src/printf.c:76-90` is a Tcl script inside `#if 0`
 *     that recovery reads as a function named `c`).
 *
 * A fixture that only asserted the positive rows would pass a rule that published
 * every redefinition in the file.
 *
 * The second shape asserted here is the MACRO redefinition: `#undef X` then
 * `#define X <other>`. That one needs no arm test, and the reason is C's rule
 * rather than a convenience -- C 6.10.3p2 makes an unconditional macro
 * redefinition a constraint violation unless the replacement lists are identical,
 * so `#undef` first is the sanctioned way to change a macro, and the later
 * definition replaces the earlier one whenever both are reached. Measured: 57 pairs
 * in 13 files.
 */

#define REDEFINED_MACRO 1

#if defined(FIRST_ARM)
int c989_pick(int a) {
  return a + 1;
}

#elif defined(SECOND_ARM)
int c989_pick(int a) {
  return a + 2;
}

#else
int c989_pick(int a) {
  return a + 3;
}

#endif

#if defined(ARM_ONE)
int c989_ifdef_pick(void) {
  return 10;
}

#else
int c989_ifdef_pick(void) {
  return 20;
}

#endif

/* CONTROL: a PROTOTYPE and a definition are one entity, not an override. C 6.9p2
 * allows any number of declarations followed by exactly one definition, and the
 * analyzer merges the symbols. This is the most common shape in every corpus and a
 * rule that read it as an override would fire thousands of times. */
int c989_prototyped(int a);

int c989_prototyped(int a) {
  return a;
}

/* CONTROL: LOGICALLY exclusive, STRUCTURALLY not. Two different conditionals whose
 * conditions cannot both hold. See sqlite src/mutex_noop.c:52 / :188. Publishing
 * this needs a preprocessor evaluator (C-D2). */
#ifdef C989_DEBUG_BUILD

int c989_debug_build_pick(void) {
  return 1;
}

#endif

#ifndef C989_DEBUG_BUILD

int c989_debug_build_pick(void) {
  return 0;
}

#endif

/* CONTROL: one function defined once. Nothing to override. */
int c989_single(void) {
  return 7;
}

/* CONTROL: two functions of the SAME name in two arms that are NOT mutually
 * exclusive -- both inside the true region of one conditional. */
#if defined(C989_BOTH)
int c989_not_exclusive_a(void) { return 1; }
int c989_not_exclusive_b(void) { return 2; }
#endif

#undef REDEFINED_MACRO
#define REDEFINED_MACRO 2

/* CONTROL: `#define` twice with no `#undef` between is a constraint violation in C
 * (6.10.3p2) unless the replacement lists are identical, and it is not the
 * sanctioned redefinition. sqlite has 353 such pairs; the lane does not read them
 * as overrides and neither does this fixture. */
#define REDEFINED_TWICE 1
#define REDEFINED_TWICE 1

/* CONTROL: `#undef` with nothing after it removes the macro and defines nothing. */
#undef REDEFINED_MACRO