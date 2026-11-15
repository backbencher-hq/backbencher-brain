/* M49 W22 (F5 sqlite rotation finding, sqlite3-wasm.c L258-264): a
** macro-COMPOSED include argument (`#include INC__STRINGIFY(SQLITE_C)`)
** parses as a call_expression under the preproc_include `path` field — the
** preprocessor is textual (C-D2) and the composed path needs the build's -D
** set, so it is NOT a statically resolvable header name: no
** include_dependency edge may be fabricated for it. Literal includes (quoted
** and system) keep their edges.
*/
#ifndef SQLITE_C
# define SQLITE_C sqlite3.c /* yes, .c instead of .h. */
#endif
#define INC__STRINGIFY_(f) #f
#define INC__STRINGIFY(f) INC__STRINGIFY_(f)
#include INC__STRINGIFY(SQLITE_C)
#undef INC__STRINGIFY_
#undef INC__STRINGIFY
#include "real_header.h"
#include <stdio.h>

static int helper(void) { return 0; }
