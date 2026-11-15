/* c/exports-linkage-marker-989 -- the marker is read from the file's OWN
 * replacement list, not from a name list.
 *
 * #963 pinned `exports` to five macro NAMES: EXPORT_SYMBOL, EXPORT_SYMBOL_GPL,
 * CURL_EXTERN, REDISMODULE_API, GIT_EXTERN. A name list is the same defect every
 * time -- it is right about the codebases it was written from and silent about the
 * next one. Measured over 359 sqlite C/H files
 * (`script/m14/tmp/c-audit/c-ontology-verdicts.ts`): the corpus defines SEVEN
 * marker names and the five-name list matches NONE of them, which is why `exports`
 * fired 0 times on that corpus.
 *
 * Two of sqlite's seven are `extern` markers the analyzer had never heard of:
 *
 *   autosetup/jimsh0.c:723        #define JIM_EXPORT extern
 *   ext/wasm/libcmpp.c:104,111    #define CMPP_EXPORT extern
 *                                 #define CMPP_EXPORT extern __declspec(dllexport)
 *
 * 274 declarations across those two files. The structural half of the convention is
 * derivable with no list at all: a macro whose replacement list OPENS with the
 * linkage keyword `extern` contributes linkage and nothing else, so every
 * declaration it prefixes is externally linked, i.e. exported. That is what this
 * change reads -- from this file's own `preproc_def` nodes, same-file only (C-D2).
 *
 * THE REFUSALS ARE THE POINT, and each is a real corpus shape:
 *
 *   ext/wasm/libcmpp.c:5256   #define CMPP_PRIVATE static     52 declarations
 *                             that are INTERNAL linkage -- the OPPOSITE marker
 *   src/mutex_unix.c:39,41    #define ALIGN128                 an alignment
 *                             attribute on one branch, nothing on the other
 *   src/sqliteInt.h:1329,1335 #define SQLITE_WSD               thread-local
 *
 * All three are EMPTY replacement lists. An empty macro contributes no tokens, so
 * STRUCTURE cannot tell what it means -- only its NAME can, and the name is the
 * fixed list this change removes. 58 declarations ride the empty branch on this
 * corpus and at least 52 of them are not exports, so the empty branch is refused.
 * The genuine empty-marker case in this corpus is sqlite's own `SQLITE_API`
 * (`src/sqlite.h.in:75 # define SQLITE_API`), and it is unreachable per-file anyway:
 * `sqlite3.h` is GENERATED at build time, so no file in the corpus defines it.
 * Recorded, not published.
 *
 * The controls below are the five #963 conventions, which must keep working, and
 * the `#undef`-guarded marker, which is how a portable codebase varies the same
 * marker per platform.
 */

#define PUBLIC_API extern
#define PUBLIC_API_MS extern __declspec(dllexport)
#define PRIVATE_API static
#define ATTRIBUTE_ONLY
#define UNGUARDED_EXTERN extern

/* --- the structural rule fires: the replacement list opens with `extern` --- */
PUBLIC_API int c989_plain_export(int a);

PUBLIC_API int *c989_pointer_export(int *a);

PUBLIC_API_MS void c989_ms_export(void);

/* --- CONTROLS: the five #963 conventions must be untouched. A generalized
       rule that dropped the fixed list would regress every codebase #963 was
       written for, and the list is still needed for the markers defined in
       ANOTHER header (C-D2): the kernel macros live in a file this analyzer
       never reads. --- */
EXPORT_SYMBOL(kernel_exported_symbol, GPL);
CURL_EXTERN int c989_curl_extern(const char *s1, const char *s2);
GIT_EXTERN(int) c989_git_extern(int *out);
REDISMODULE_API int c989_redis_api(int n);

/* --- CONTROLS: markers defined to something that is NOT linkage --- */
PRIVATE_API int c989_private_api(int a);

ATTRIBUTE_ONLY int c989_attribute_only(int a);

/* --- CONTROLS: an ordinary declaration with no marker at all --- */
int c989_ordinary(int a);

int c989_plain_export(int a) { return a + 1; }
int *c989_pointer_export(int *a) { return a; }
void c989_ms_export(void) { }
int c989_curl_extern(const char *s1, const char *s2) { return s1 == s2; }
int c989_git_extern(int *out) { return *out; }
int c989_redis_api(int n) { return n; }
int c989_private_api(int a) { return a - 1; }
int c989_attribute_only(int a) { return a; }
int c989_ordinary(int a) { return a; }
void kernel_exported_symbol(int n) { (void)n; }

#define EXPORT_SYMBOL(x, y) x
#define CURL_EXTERN extern
#define GIT_EXTERN(t) extern t
#define REDISMODULE_API

/* --- CONTROLS: the platform-varied marker. `#ifdef` picks which replacement
       list the macro has, and BOTH branches are `extern`, so the rule fires
       whichever the build takes. This is the shape a portable codebase uses and
       it is why the set is keyed on the replacement list rather than on the
       name. --- */
#ifdef C989_MSVC
#define C989_PLATFORM_API extern __declspec(dllexport)
#else
#define C989_PLATFORM_API extern
#endif

C989_PLATFORM_API int c989_platform_export(int a);

int c989_platform_export(int a) { return a; }

/* --- CONTROL: a marker whose replacement list does NOT open with the keyword.
       `static` is a LINKAGE keyword too and this is exactly the refusal the
       empty-branch case is about in a form nobody has to guess at:
       `C989_NOT_LINKAGE static` is internal linkage and must publish nothing. --- */
#define C989_NOT_LINKAGE static
C989_NOT_LINKAGE int c989_not_linkage(int a);

int c989_not_linkage(int a) { return a; }