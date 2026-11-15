/* #963: `exports` covers every real marker convention, and the edge's SOURCE is
   always the DECLARED NAME -- never the macro, never a type.

   Before #963 the relation fired zero times in 2,798 corpus files, for two
   independent reasons, both pinned here:

     1. The marker list held only kernel macros (EXPORT_SYMBOL &c). Three
        userspace codebases -- curl, libgit2, redis -- spell the same boundary as
        CURL_EXTERN / GIT_EXTERN / REDISMODULE_API, none of which were listed.

     2. The kernel spelling that WAS listed was the only shape handled: a CALL,
        `EXPORT_SYMBOL(my_fn, GPL)`. The userspace spelling is a PREFIX on an
        ordinary declaration, and reached no export branch at all.

   A third defect sat underneath both, visible in this file's expectations: the
   kernel edge targeted a synthesised constant "KERNEL_EXPORT" that appears in no
   source file anywhere. The real marker is EXPORT_SYMBOL. Pinning the macro as
   written removes a fabricated target of the same class #962 removed from
   `instantiates` (-> malloc).

   The trap the SOURCE rule must survive: in the prefixed forms the macro's
   ARGUMENT is a return type, not a name. `GIT_EXTERN(int)` would publish
   `exports int -> GIT_EXTERN` -- a TYPE as an exported name. So the name is read
   from the DECLARATOR, and the argument is used only for the kernel call form,
   where it genuinely is the name. */

#define EXPORT_SYMBOL(x, y) x
#define CURL_EXTERN extern
#define GIT_EXTERN(t) extern t
#define REDISMODULE_API

typedef struct curl_code {
    int code;
} CURLcode;

/* --- kernel call form: the name IS the macro's first argument --- */
int kernel_exported_symbol(int n) {
    return n + 1;
}
EXPORT_SYMBOL(kernel_exported_symbol, GPL);

/* --- userspace prefix over a primitive return type --- */
CURL_EXTERN int curl_strequal(const char *s1, const char *s2);

/* --- DECLARED LIMIT, not a working case. With a TYPEDEF return type the marker
       and the name are BOTH destroyed by the parse, so no structural rule can
       recover this edge and none is claimed:

         CURL_EXTERN CURLcode curl_mime_type(char *mime);
         ^ declaration
             type_identifier "CURL_EXTERN"   <- the marker, absorbed as a type
             identifier      "CURLcode"      <- the return type, as a declarator
             ;

       `macro_prefixed_type_specifier` -- the node that carries a macro prefix --
       only forms when a PRIMITIVE type follows the macro. With a typedef it does
       not form, so the declaration degrades to the two tokens above and the
       exported name `curl_mime_type` survives nowhere in the tree. Publishing an
       edge here would mean recovering the name from TEXT rather than structure,
       which is the guessing this lane exists to remove; so this case emits
       nothing. It is a grammar reach limit, recorded in
       docs/analyzers/real-c-analyzer.md, not an analyzer defect.

       The four markers below it DO form the node and DO emit. --- */
CURL_EXTERN CURLcode curl_mime_type(char *mime);

/* --- paren form, where the macro's ARGUMENT IS THE RETURN TYPE. The published
       name must still be the declarator's --- */
GIT_EXTERN(int) git_libgit2_version(int *out);

/* --- a macro that expands to NOTHING at all: the marker is a bare token with
       no argument to misread --- */
REDISMODULE_API int RedisModule_Alloc(int n);

/* --- the recovery trap: the marker is split from the declarator, so a walk that
       keeps going reaches the marker itself and would publish
       `exports CURL_EXTERN -> CURL_EXTERN`. No edge is the honest answer. --- */
CURL_EXTERN CURLcode curl_dbg_socket(int domain,
                                    int type);

int curl_strequal(const char *s1, const char *s2) {
    return s1 == s2;
}

CURLcode curl_mime_type(char *mime) {
    CURLcode c;
    c.code = 1;
    return c;
}

int curl_dbg_socket(int domain, int type) {
    return domain + type;
}