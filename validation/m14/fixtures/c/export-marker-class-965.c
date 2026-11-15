/* C3: `exports` is a MARKER CLASS, not a list of five names.

   The five-name list (`EXPORT_SYMBOL`, `EXPORT_SYMBOL_GPL`, `CURL_EXTERN`,
   `REDISMODULE_API`, `GIT_EXTERN`) was widened twice from one corpus and missed
   every other codebase's spelling. Measured on sqlite (359 C/H files): with the
   list, `exports` fired 0 times while the construct occurred 340 times in the
   exact node the prefix branch reads — `CMPP_EXPORT` 161, `JIM_EXPORT` 113,
   `JNIEXPORT` 31, `SQLITE_API` 17, `EXTERN` 14, `SQLITE_WASM_EXPORT` 3,
   `XCMPP_EXPORT` 1. The class rule reaches all of them, and refuses the
   attribute macros that share the position (`SQLITE_NOINLINE` 87,
   `CMPP_PRIVATE` 53, `PRIVATE` 22, `SQLITE_WSD` 12).

   THE RULE: in the marker position the grammar only builds for a macro standing
   where a storage class stands, the marker's own token names a visibility
   boundary — as an underscore-delimited part (`SQLITE_API`, `BENCHMARK_EXPORT`)
   or as a suffix (`JNIEXPORT`, `REDISMODULE_API`, `EXTERN`).

   Every case below is chosen to break one specific version of the rule:

     the first five      -- a spelling the five-name list does NOT contain, so
                            each FAILS without the class rule;
     SUPERSET            -- all five legacy names, so a rule that is not a
                            superset of the list fails here;
     the negatives       -- attributes and PRIVATE markers in the SAME node
                            position, which a rule that tests only position
                            would publish;
     the debris          -- lower-case identifiers the grammar lands on that
                            position under recovery (`virtual`, `typename`) and
                            which a rule that skips the SCREAMING test takes. */

/* --- A. spellings the list never contained (each is a corpus spelling) --- */
#define JIM_EXPORT extern
#define SQLITE_API
#define JNIEXPORT __attribute__((visibility("default")))
#define BENCHMARK_EXPORT __attribute__((visibility("default")))
#define FOO_LIB_API extern

JIM_EXPORT char *c3_jim_strdup(const char *s);
SQLITE_API int c3_sqlite_api(int n);
JNIEXPORT int c3_jni_entry(int n);
BENCHMARK_EXPORT int c3_benchmark_entry(int n);
FOO_LIB_API void c3_foo_entry(void);

/* --- B. SUPERSET: every name the old five-name list carried must still fire.
       A rule narrower than the list loses behaviour that shipped. --- */
#define EXPORT_SYMBOL(x, y) x
#define CURL_EXTERN extern
#define GIT_EXTERN(t) extern t
#define REDISMODULE_API

CURL_EXTERN int c3_curl_strequal(const char *a, const char *b);
GIT_EXTERN(int) c3_git_version(int *out);
REDISMODULE_API int c3_redis_alloc(int n);

/* --- C. NEGATIVES. All of these put a macro in the SAME marker position. A
       rule that tests only the position publishes every one of them, and
       `CMPP_PRIVATE`/`PRIVATE` are the exact reason PRIVATE is not in the word
       list: it is the same convention with the opposite meaning. --- */
#define SQLITE_NOINLINE
#define CSV_NOINLINE
#define SQLITE_INLINE
#define ALIGN128
#define FMT_CONSTEXPR
#define CMPP_PRIVATE static
#define PRIVATE static
#define SQLITE_WSD const

SQLITE_NOINLINE void c3_inline_helper(void) { }
CSV_NOINLINE void c3_csv_helper(void) { }
SQLITE_INLINE void c3_sqlite_inline_helper(void) { }
ALIGN128 union c3_aligned { int a; };
FMT_CONSTEXPR int c3_constexpr_helper(void) { return 0; }
CMPP_PRIVATE int c3_cmpp_private_state = 0;
PRIVATE int c3_private_state = 0;
static SQLITE_WSD struct c3_wsd_probe { int n; };

/* --- D. DEBRIS. The C++ corpora put these in the marker position under
       recovery (`c3-construct-probe.ts` measured `std` 322, `virtual` 125,
       `typename` 54, `template` 53, and sqlite's own `return` 22 / `else` 2 /
       `db` 2). A rule without the SCREAMING test takes every one. --- */
typedef int c3_virtual;
c3_virtual c3_lowercase_marker(int n);

/* --- E. THE FABRICATED SOURCES, VERBATIM.

       Widening the marker set published 3 `exports` edges on sqlite whose SOURCE
       names something no C declaration in the file gives to anything: a TYPE and
       two MARKERS. The texts below are COPIED from the corpus rather than
       re-typed, and that is the whole reason this section works: a tidy fixture
       passes the fix without testing it. My first attempt rewrote the shapes by
       hand, the fixture gate reported 38/38, and the mutants SURVIVED — the
       hand-written versions parsed cleanly enough to publish nothing either way.
       Same lesson as c/call-in-directive-condition-956, which had to be authored
       from the damaged shape for the same reason.

         E1  sqlite/src/../ext/wasm/libcmpp.c:7043
         E2  sqlite/src/main.c:138
         E3  sqlite/ext/jni/src/c/sqlite3-jni.c:6244-6246                --- */

/* E1: a macro that wraps a whole DEFINITION (#918's shape). The declarator chain
       holds the identifier `void` under an ERROR node, so the walk published
       `exports void -> CMPP__EXPORT` — a TYPE as the exported name, which is the
       defect #963's fixture forbids for `exports int -> GIT_EXTERN`. */
#define CMPP__EXPORT(ret, name) ret name
CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return sqlite3_realloc64(p, n);
}

CMPP__EXPORT(void *, cmpp_malloc)(size_t n){
#if 1
  return sqlite3_malloc64(n);
#else
  return 0;
#endif
}

/* E2: an exported FUNCTION POINTER with an initializer. The real declarator is
       `*sqlite3IoTrace`, not an exported symbol, and the walk reached the marker
       beside it through the same ERROR node. main.c:138. */
#define SQLITE_API
#define SQLITE_CDECL
SQLITE_API void (SQLITE_CDECL *sqlite3IoTrace)(const char*, ...) = 0;

/* E3: the declaration is cut at the line break. The declarator IS the bare marker
       `JNICALL`, an ALL-CAPS token the preprocessor substitutes before the
       compiler sees it, and the real name lives on the next line in a different
       node. sqlite3-jni.c:6244-6246. */
#define JNIEXPORT
#define JNICALL
JNIEXPORT void JNICALL
Java_org_sqlite_jni_capi_SQLTester_installCustomExtensions(JniArgsEnvClass){
  return;
}

/* --- E'. THE ROWS THAT MUST SURVIVE, and the reason this section cannot just be
       "refuse anything suspicious". The first version of the fix refused every
       `exports` edge whose source was not a symbol in the payload, which removed
       the three fabrications above AND seven REAL exported prototypes on
       libcmpp.c (`cmpp_sqlite3_str_finish`, `cmpp_tizer_init`, ...) — because the
       function-prototype extractor mints no symbol for a declaration carrying a
       marker prefix. Dropping a true edge to hide a missing symbol is the same
       fabrication wearing the other hat, so these rows are pinned as POSITIVE: the
       narrow gate must cost nothing here. --- */
#define CMPP_EXPORT extern
typedef struct cmpp cmpp;
typedef struct sqlite3_str sqlite3_str;
CMPP_EXPORT char * cmpp_sqlite3_str_finish(cmpp *pp, sqlite3_str *s, int * n);
CMPP_EXPORT unsigned char const * cmpp_tizer_errpos(cmpp_tizer const * tz);
CMPP_EXPORT int cmpp_outfv(cmpp *pp, char const *zFmt, va_list va);
