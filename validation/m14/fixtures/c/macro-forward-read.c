/* #901 (M60, F5 sqlite rotation): a define with NO value body used to be skipped
** entirely — the old comment called these "include guards ... file artifacts, not
** symbols", but the CODE tested the body, so EVERY value-less define was dropped.
** Two measured consequences, both pinned here:
**
** 1. SYMBOL: no declaration existed for the name, so nothing could resolve a read
**    of it. Real sites: ext/misc/basexx.c L48 defines SQLITE_EXTENSION_INIT1 with
**    an empty body (read at L40), and src/tclsqlite.c L43-45 defines SQLITE_TCLAPI
**    empty (read at L277+). Those were the c lane's only MISSING rows in an
**    otherwise 100%-coverage sweep.
**
** 2. FORWARD READ: even after minting the symbol, a read ABOVE its define stayed
**    silent, because the CGD26 declared-name pre-pass rejects anything with a
**    preproc_ ancestor — and a macro definition's NAME has preproc_def as its
**    direct parent, so the isMacroName branch was dead code. Functions and globals
**    resolved order-independently through declaredNames; macros alone were
**    order-dependent (measured: later()/gv2 forward refs emitted, a macro forward
**    ref did not). A macro read is a real read wherever it sits, exactly as the
**    oracle's declaredNames has always treated it.
**
** Order below is deliberate: M60_TRACE_FLAG is READ before its define.
*/
#ifndef M60_GUARD
# include "m60_header.h"
M60_TRACE_FLAG; /* forward read: the define sits BELOW this line */
#endif

/* The tclsqlite.c shape: the value-less macro as a declaration token between the
** return type and the function name (L277: static int SQLITE_TCLAPI
** incrblobClose2( — 14 such reads in that file, and the file's parse carries
** BOTH the function symbols and those uses edges). The signature must span lines
** here: with a one-line body (`...m60_one(void) { return 0; }`) the pinned
** grammar recovers the line as `declaration(M60_API) + function_definition`
** instead (measured: symbol and edge both vanish, while the same line split over
** a multi-line signature emits both) — that shape is registered separately as
** #907 rather than pinned here as if it were correct. */
#ifndef M60_API
# define M60_API
#endif

#undef M60_TRACE_FLAG
#define M60_TRACE_FLAG

static int M60_API m60_one(
  int x
)
{
  return x;
}

static int m60_two(void) { M60_TRACE_FLAG; return 1; }
