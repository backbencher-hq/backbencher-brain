// PART_OF (R3, owner-ruled 2026-10-21) — the construct is C++'s OWN quoted `#include`, and no
// grammar change is taken: `preproc_include` is a named node type of the served build.
//
// THE CONTRACT'S TEST (src/ast/types.ts:148-160): a part "shares the library's single scope,
// imports nothing, and cannot be resolved as a separate module". A QUOTED include is exactly that —
// a fragment of THIS translation unit. An ANGLE include names ANOTHER MODULE's header (its own
// binding scope) and is `imports`, which the analyzer already emitted.
//
// THE BEHAVIOURAL HALF: the `part_of` edge exists only when the construct reaches the analyzer as a
// REAL `preproc_include` node. If the patch ever stops parsing, the directive becomes recovery text
// and BOTH the `part_of` and the `imports` rows disappear — so this fixture fails in both
// directions rather than passing on one hand-built row.
//
// ⇒ AND THIS FIXTURE PINS THE DIRECTION. The source is the including unit (file scope, `global`) and
// the target is the PART. The written specifier is on the A-angle of a path: the analyzer publishes
// the part's PATH (the including file's directory joined with the specifier), because a specifier is
// a path and no resolver can bind it — the fsharp lane's measured rule on the same construct.

#include "part-of-quoted-include.h"
#include <vector>

int partOfWidget(int n) { return n + 1; }
