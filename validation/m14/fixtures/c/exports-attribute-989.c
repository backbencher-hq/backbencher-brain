/* #989: `exports` from the ATTRIBUTE spelling of an export boundary, and the
   refusal of an attribute's internal syntax as a CALL.

   Before this, `exports` fired ZERO times on the C lane's own primary corpus
   (sqlite, 348 C-routed files), and the reason was not that C has no such
   construct. Measured with `script/m14/tmp/c-ontology/export-shapes.ts` over
   those 348 files, parsing them with the lane's own pinned wasm:

     59 nameable sites carry the attribute ON the declaration
     10 further sites sit inside an ERROR with no declaration (a declared limit)
     164 nameable sites use a MACRO this same file defines to an export attribute

   `real-c-analyzer.ts` read FIVE project-convention macro NAMES and nothing
   else, so all 223 of those sites produced no edge. A hardcoded name list cannot
   grow without a code change, and #963 already measured what that costs: three
   codebases spelling the same boundary with a macro the list did not hold, 1,519
   markers, and a relation that fired zero times.

   The edge keeps #963's shape exactly, because both halves of that shape are
   forced rather than chosen:
     SOURCE = the declared NAME. Never the marker's argument -- in the prefixed
       forms the argument is a RETURN TYPE, and `exports int -> MARKER` is a type
       as an exported name.
     TARGET = the marker AS WRITTEN. Never a synthesised constant -- the
       pre-#963 code targeted `KERNEL_EXPORT`, a name in no source file.

   THE CONTROLS ARE THE POINT. Each one is a shape that LOOKS like an export
   boundary and is not, and each would emit a false edge under a looser rule. A
   fixture that asserted only the six working cases would pass a rule that
   published `exports` for every attribute and every macro prefix in the file. */

#include <stddef.h>

/* ---- Form B: the marker is a MACRO THIS FILE DEFINES. This is the form real
       projects use (`#define SQLITE_API __declspec(dllexport)`,
       `#define BLAKE3_API __attribute__((visibility("default")))`), and it is
       NOT C-D2 macro expansion. Nothing is expanded here: the fact used is that
       the file's OWN replacement list is an export attribute, which is a fact
       about the file rather than about the build's -D set. ---- */
#define CMPP_EXPORT extern __declspec(dllexport)
#define WASM_EXPORT __attribute__((used, visibility("default")))

/* ---- CONTROL 1: an EMPTY definition is NOT a marker. sqlite's own
       `src/sqlite.h.in:75` is `#ifndef SQLITE_API / #define SQLITE_API /
       #endif` -- a user-overridable hook that says nothing about visibility.
       Treating an empty replacement list as a marker would publish an export
       boundary the file never states. ---- */
#define SQLITE_API

/* ---- CONTROL 2: the NEGATIVE attribute. `visibility("hidden")` is the same
       attribute with the opposite polarity, and an unbounded "does this mention
       visibility" test reads it as an export. ---- */
#define HIDDEN_API __attribute__((visibility("hidden")))

/* ---- CONTROL 3: an attribute keyword that is ALSO a real C function name.
       `__attribute__((malloc))` is a GCC attribute and `malloc` is libc, so a
       name-keyed test would refuse a genuine `p = malloc(n)` call. The rule is
       structural -- the call must sit INSIDE an attribute node -- so the two stay
       apart. ---- */
extern void *malloc(size_t n);
void *attr_not_an_export(void) {
    return malloc(16);
}

/* ---- the four WORKING Form A shapes, one per position C allows ---- */
__declspec(dllexport) int attr_leading(void);
int attr_gnu_trailing(void) __attribute__((visibility("default")));
__attribute__((visibility("default"))) int attr_gnu_prefix(void);
extern __declspec(dllexport) int attr_with_extern(void);

/* the same attribute on a DEFINITION, which is the shape sqlite writes 55 times
   for its loadable-extension entry points */
__declspec(dllexport)
int attr_on_definition(int n) {
    return n + 1;
}

/* ---- the two WORKING Form B sites ---- */
CMPP_EXPORT void *cmpp_malloc(size_t n);
WASM_EXPORT void wasm_reset(void);

/* ---- neither of these is an export boundary: `attr_hidden` is CONTROL 2's
       macro in use, and `attr_unmarked` carries no marker at all ---- */
HIDDEN_API int attr_hidden(void);
int attr_unmarked(void);

/* ---- CONTROL 4: a `#define` whose replacement list merely CONTAINS a macro
       call is not an attribute, however much it reads like one ---- */
#define LOOKS_LIKE_EXPORT(x) __declspec
int attr_macro_body(void);

/* ---- CONTROL 5: an attribute inside a STRING is text. A C lexer cannot tell
       it from an attribute, and this fixture states that the analyzer does not
       read strings to manufacture one. ---- */
const char *attr_in_string = "__declspec(dllexport)";

/* ---- CONTROL 6, and the one #963's self-reference trap needs restating for:
       the exported NAME can never BE the marker. `exportedDeclarationName` walks
       the declarator chain and recovery can hand it the `macro_specifier`. ---- */
#define SELFREF_EXPORT
SELFREF_EXPORT SELFREF_EXPORT attr_selfref_decl(void);

/* ---- CONTROL 7, and it is the one that cost the most to get right. A macro
       redefined by MUTUALLY EXCLUSIVE platform arms is not a marker unless EVERY
       arm says so. libcmpp.c does exactly this:

         #if   defined(_WIN32)  #define PLATFORM_EXPORT extern __declspec(dllexport)
         #elif defined(_WIN64)  #define PLATFORM_EXPORT extern __declspec(dllimport)
         #else                  #define PLATFORM_EXPORT extern
         #endif

       Only one arm survives preprocessing, so all of them are legal C and which
       one is in effect depends on the build's platform macros -- which a per-file
       analyzer does not have (C-D2). Keyed on the FIRST definition the analyzer
       reads `extern` and refuses 161 real markers; keyed on "ANY definition" it
       publishes 161 edges that are FALSE for every non-Windows build. The
       boundary holds only where every spelling agrees, so that is the rule, and
       these two functions are the controls that keep it from being widened.

       ITERATION 2 CORRECTION, stated because this file was measurably wrong: the
       three arms below were written as UNGUARDED consecutive `#define`s, which is
       not the construct the paragraph above describes and not legal C either --
       C11 6.10.3 makes a redefinition with a different replacement list a
       diagnostic, and the preprocessor then keeps the LAST definition, not a
       platform-dependent one. Unguarded, the construct was also the SAME SHAPE as
       `c/exports-linkage-marker-989`'s C989_PLATFORM_API, which correctly pins
       that a platform-varied marker whose arms ALL grant external linkage DOES
       publish -- so the two fixtures demanded opposite behaviour for one shape and
       only one of them could pass. The guards are restored here to the mutually
       exclusive arms the paragraph always meant, and the dllimport arm -- the one
       that makes the arms DISAGREE, which is the whole point of CONTROL 7 -- is
       among them. Rule under test: a marker is an export marker iff EVERY arm
       opens with `extern` and NO arm names `dllimport`. ---- */
#ifdef PLATFORM_IS_WIN32
#define PLATFORM_EXPORT extern __declspec(dllexport)
#elif defined(PLATFORM_IS_WIN64)
#define PLATFORM_EXPORT extern __declspec(dllimport)
#else
#define PLATFORM_EXPORT extern
#endif
PLATFORM_EXPORT void *platform_marker(int n);

/* the control that must still FIRE: one arm, and it says export */
#define SINGLE_PLATFORM_EXPORT __declspec(dllexport)
SINGLE_PLATFORM_EXPORT void *single_platform_marker(int n);