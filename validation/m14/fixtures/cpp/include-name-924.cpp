// M60/#924 — the include's NAME is the `path` node's own text, never a slice
// of the whole directive.
//
// The legacy extraction ran from the `include` keyword to the end of the
// preproc_include node, so EVERY trailing comment rode along and became part
// of the published module AND the include_dependency edge target:
// `#include <vector> // vector` published `vector // vector`. Measured on the
// two pinned cpp corpora (script/m14/tmp/c924-include-ab.ts, fmt +
// nlohmann-json, 71 files): 876 such names — 438 include sites — every one a
// string that is not a name and cannot resolve.
//
// The same block also reported `isSystemInclude` / `isSystem` as
// `includePath.startsWith("<")` — evaluated on the STRIPPED name, where
// `stripIncludeChars` has already deleted the `<` — so no cpp include was
// ever reported as a system one. Both are read from the raw path node now,
// which is what the C lane has always done.
//
// Lines are pinned: the literal includes are written on lines 25 and 26, and
// the M59.A7 (#825) rule takes the PATH node's line, so a multi-line include
// names the line the path is written on, not the directive's start. Line 27
// is a macro-COMPOSED argument: the preprocessor is textual (C-D2) and the
// expansion needs the build's -D set, so it is not a statically resolvable
// header name and may publish no module and no include_dependency edge — the
// C lane's contract, pinned by c/macro-composed-include.
#include <vector>  // vector
#include "local_header.h"    /* local */
#include MACRO_COMPOSED_HEADER

int helper() { return 0; }
