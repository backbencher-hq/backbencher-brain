/* c/call-target-refusals-996 — the fixture for D7 K1: the call-emission gate must
 * REFUSE targets that cannot be callees.
 *
 * CORRECTED BOUNDARY (arm-A measured, D7 #996 second round): the first K1 also refused
 * NON-IDENTIFIER spellings. The arm-A after-run proved that half WRONG — it withdrew 3 REAL
 * name-model resolutions (calls to `$`-containing identifiers whose declarations the analyzer
 * ITSELF publishes, e.g. Cython's generated `__Pyx_ImportType_$cyversion` in
 * `Cython/Utility/ImportExport.c`). So the guard is KEYWORD-ONLY and SUBJECT 2 below is a
 * POSITIVE CONTROL: the `$`-spelling target must KEEP publishing. The rule is:
 *   - a KEYWORD can never be a declared name (declaration extraction refused keywords since
 *     CGD22; corpus-wide `#define <keyword>` count = 0) → refusing it cannot withdraw a
 *     resolution, so the keyword half is safe and is kept;
 *   - a non-identifier spelling is NOT disqualified by the C grammar the way a keyword is:
 *     the analyzer's own symbol path publishes `$`-containing names in generated templates,
 *     so its calls are consistent with its name model and stay.
 *
 * ONE RECOVERY SHAPE produces the refused class:
 *
 *   1. A KEYWORD used as a callee, from macro-with-statement recovery. SuiteSparse's
 *      CHOLMOD files write
 *          DEBUG (if (stype == 0) CHOLMOD(dump_sparse) (F, "F ready", Common)) ;
 *      i.e. a debug macro invoked with an `if` STATEMENT as its argument. That is not
 *      valid C as an expression, so the grammar recovers and the analyzer published
 *      `calls ... -> if` (29 unresolved + 1 ambiguous at whole population).
 *
 *   2. [OLD SUBJECT — now a POSITIVE CONTROL] A NON-IDENTIFIER target from GENERATED
 *      sources. Cython's Utility/Exceptions.c is a template whose generated variables
 *      appear as
 *          code_object = $global_code_object_cache_find (c_line ? -c_line : py_line);
 *      and the analyzer publishes `calls ... -> $global_code_object_cache_find`
 *      (5 unresolved at whole population). The corrected K1 KEEPS this row: it is a
 *      spelling the analyzer's own name model accepts, and in ImportExport.c such
 *      `$`-calls resolve to same-file declarations.
 *
 * The lane's own C_KEYWORDS set already carries the comment "a C keyword can NEVER be a
 * declared name" for DECLARATION extraction; the call path never consulted it. Neither
 * target can name a C callee in valid C, so both are refusals, not unresolved facts.
 *
 * CONTROLS are load-bearing in both directions: a real function call, a real macro
 * invocation AND the `$`-spelling call in the SAME file must keep publishing, so a fix that
 * suppresses calls wholesale — or one that over-reaches past the keyword rule — fails here. The macro control is a FUNCTION-LIKE macro defined in
 * this file (#908's pinned contract: a macro invocation gets BOTH calls and uses).
 */

/* --- POSITIVE CONTROL 1: an ordinary function call must keep publishing. --- */
static int c996_probe(int x) {
  return x + 1;
}

int c996_positive_call(void) {
  return c996_probe(1);
}

/* --- POSITIVE CONTROL 2: a file-local FUNCTION-LIKE macro invocation keeps calls. --- */
#define C996_DEBUG(x) ((void)(x))

int c996_positive_macro(void) {
  C996_DEBUG(1);
  return 0;
}

/* --- SUBJECT 1: the keyword-callee recovery shape (SuiteSparse spelling). --- */
int c996_keyword_recovery(void) {
  C996_DEBUG(if (c996_probe(0)) c996_positive_call()) ;
  return 0;
}

/* --- SUBJECT 2: the generated non-identifier callee (Cython spelling). --- */
int c996_nonidentifier_recovery(void) {
  int code_object = $global_code_object_cache_find(1 ? -1 : 0) ;
  return code_object;
}
