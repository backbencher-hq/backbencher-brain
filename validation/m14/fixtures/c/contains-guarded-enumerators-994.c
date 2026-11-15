/* #994: members declared inside a PREPROCESSOR ARM of an enumerator list are real enumerators.
 *
 * Found by the D4 jq differential draw: jq/src/jv_dtoa.c:1630-1643 declares
 *
 *     enum {
 *     #ifdef IEEE_Arith
 *         emax = 0x7fe - Bias - P + 1,
 *         emin = Emin - P + 1
 *     #else
 *         emin = Emin - P,
 *     #ifdef VAX
 *         emax = 0x7ff - Bias - P + 1
 *     #endif
 *     #endif
 *     };
 *
 * inside a function whose whole file the parser wraps in one ERROR. The analyzer's
 * enum loop read only DIRECT children of `enumerator_list`, so it saw just the
 * `preproc_ifdef` node and published NO member at all — and the differential read
 * 2 MISSING rows (`contains -> emax`, `contains -> emin`) against an oracle that
 * recursed into the arms.
 *
 * The rule is the STRUCT-field rule this analyzer already applies to conditional
 * members: a preprocessor arm is not a different construct, it is the same
 * declaration under a condition. Both arms are declarations the file contains, so
 * both are published (the two conditional declarations of one name are two
 * occurrences on their own lines, and the differential's match key dedupes by
 * target).
 *
 * The function wrapper is load-bearing in this fixture: the SAME text at file scope
 * parses the guarded region as an ERROR child of `enumerator_list` (a different
 * recovery), and that shape is not the corpus shape this pins. The unguarded member
 * BEFORE the arm is the control: a fix that replaced the loop instead of recursing
 * would lose it.
 */
static int gethex_params(void) {
    enum {
        unguarded_first = 1,
#ifdef IEEE_Arith
        emax = 0x7fe,
        emin = 0x7fd
#else
        emin = 2
#endif
    };
    return 0;
}
