/* #989: a member's name must not come out of an ERROR node.
 *
 * Found by the lane's clang oracle on the corpus this lane owns, which is the
 * first time `contains` has had an independent parser read THIS corpus:
 * `contains-vs-clang.ts --dir sqlite/src` reported 33 records / 421 members at
 * 98.34% agreement, with 7 MISSED members and 8 PHANTOMS -- and the two classes
 * were the same seven lines:
 *
 *     char *(SQLITE_CDECL*mprintf)(const char*,...);      sqlite3ext.h:112
 *
 * `SQLITE_CDECL` is a CALLING-CONVENTION macro, and C's parenthesis rule puts
 * the name inside the macro's argument, so the grammar cannot place the token
 * and recovery parks it in an ERROR BESIDE the real declarator:
 *
 *     field_declaration
 *       pointer_declarator
 *         function_declarator
 *           parenthesized_declarator
 *             pointer_declarator -> field_identifier "mprintf"     <- real
 *             ERROR "SQLITE_CDECL"
 *               field_identifier "SQLITE_CDECL"                   <- phantom
 *
 * The member walk used `namedChild(0)`, which descends into the ERROR and
 * returns the MACRO'S OWN NAME. So the phantom did not merely accompany the
 * member -- it took its place: 7 members named `SQLITE_CDECL` on
 * `sqlite3_api_routines`, and `mprintf`, `xsnprintf`, `test_control`,
 * `db_config`, `log`, `vtab_config`, `str_appendf` all MISSING. This is the
 * #928/#985 family verbatim (a member whose name no C declaration in the file
 * gives to any member), and #916-C had already fixed the SYMBOL path for the
 * identical shape -- the member path kept `namedChild(0)`.
 *
 * After: 421/421 = 100.00% agreement, 0 missed, and 1 phantom remaining which is
 * this lane's DECLARED conditional-arm superset (`#ifdef _WIN32 char *zMbcsName;`
 * in src/test_quota.c:132 -- clang on Linux takes the other arm, the payload
 * publishes both, which #957 ruled is the honest answer).
 */

/* --- the pinned shape: the name is real, the macro's own name is not --- */
struct CfxApi {
    char *(CFX_CDECL *mprintf)(const char *, ...);
    int (CFX_CDECL *test_control)(int, ...);
};

/* --- CONTROL: the ordinary function-pointer member, which the fix must not
       disturb. This is the four-shape battery #928/#947 already pins, and it is
       the control that tells a correct fix from an over-broad one. --- */
struct CfxPlain {
    int (*plain)(int);
    void (*fns[3])(int);
    int value;
    char *name;
};

/* --- CONTROL: a member with no macro anywhere near it. --- */
struct CfxOrdinary {
    int count;
    double ratio;
};

/* --- NEGATIVE-adjacent CONTROL, and the limit stated rather than implemented:
       #947's rule declines a macro-mediated function pointer because the only
       name in the parse is the macro's. That rule reads the DECLARATOR SHAPE;
       this fix reads whether the name came out of an ERROR. Both must hold, and
       the four CfxPlain shapes are what proves the first did not move. --- */