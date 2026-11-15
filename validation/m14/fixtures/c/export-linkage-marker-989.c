/* #989: `exports` for a marker that needs no NAME REGISTER.
 *
 * Before this, `exports` fired ZERO times in 359 sqlite files while the corpus
 * carried 274 export markers, because EXPORT_MACROS is a list of five other
 * projects' macro names. The register's own census falsifies it: counting every
 * macro that occupies the `macro_prefixed_type_specifier` slot, with no allowlist
 * at all, returns 24 distinct markers in that ONE repository -- six of them
 * export markers and four of them the exact opposite.
 *
 * So the rule is C's own rather than a list: a marker IS an export marker when
 * its definition grants EXTERNAL LINKAGE, and is NOT one when it grants internal
 * linkage. `#define X extern` is C's statement that the declaration belongs to
 * the module's interface; `#define X static` is the opposite statement, and
 * sqlite ships both in one file (ext/wasm/libcmpp.c: CMPP_EXPORT / CMPP_PRIVATE).
 * A rule that cannot say NO would publish 53 edges for private symbols.
 *
 * The SOURCE is the declared name and the TARGET is the marker as written --
 * #963's contract, unchanged. What is new is HOW THE MARKER IS RECOGNISED. */

/* --- positive: external linkage is export --- */
#define CFX_EXPORT extern
CFX_EXPORT int cfx_extern_linkage(int n);

/* --- positive: the GCC spelling of the same boundary.
       ext/wasm/api/sqlite3-wasm.c:236 spells it exactly this way:
         #define SQLITE_WASM_EXPORT __attribute__((used,visibility("default"))) --- */
#define CFX_ATTR_EXPORT __attribute__((used,visibility("default")))
CFX_ATTR_EXPORT int cfx_visibility_default(int n);

/* --- positive: `extern __declspec(dllexport)`, the two combined. libcmpp.c:106
       writes this arm, and 108 writes the dllimport one, so the pair is not
       hypothetical --- */
#define CFX_WIN_EXPORT extern __declspec(dllexport)
CFX_WIN_EXPORT int cfx_win_export(int n);

/* --- NEGATIVE, the substance of the ruling: internal linkage is NOT export.
       53 `CMPP_PRIVATE` sites in sqlite would be published by a rule that
       cannot refuse. --- */
#define CFX_PRIVATE static
CFX_PRIVATE int cfx_internal_linkage(int n);

/* --- NEGATIVE: `extern __declspec(dllimport)` is an IMPORT boundary. libcmpp.c:108
       writes this arm in the same #ifdef chain as the dllexport one above. --- */
#define CFX_IMPORT extern __declspec(dllimport)
CFX_IMPORT int cfx_dll_import(int n);

/* --- NEGATIVE: an empty marker decides nothing. `#define REDISMODULE_API` is
       empty and IS an export marker, `#define CMPP_PRIVATE` (the #else arm of
       libcmpp.c:5256) is empty and is NOT -- so emptiness carries no answer, and
       a marker whose body lives in another file (sqlite's own SQLITE_API, in
       src/sqlite.h.in) is C-D2 for the same reason. --- */
#define CFX_EMPTY
CFX_EMPTY int cfx_empty_marker(int n);

/* --- NEGATIVE: a marker on a LOCAL declaration is not part of any interface.
       The rule asks whether a BLOCK intervenes, and a compound_statement is one. --- */
void cfx_holder(void) {
    CFX_EXPORT int cfx_local_not_exported = 0;
    (void)cfx_local_not_exported;
}

/* --- CONTROL: an ordinary public file-scope declaration with no marker at all
       publishes no `exports` edge. This relation is about a DECLARED BOUNDARY,
       and "not static" is not one: 109 such declarations sit on this corpus and
       the analyzer publishes 0 edges for them, because the target would have to
       be invented (see the #963 note on fabricated targets). --- */
int cfx_plain_public(int n);